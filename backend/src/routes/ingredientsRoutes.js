import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import prisma from '../db.js';

const router = express.Router();

const autocompleteLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 30, // Limit each IP to 30 autocomplete requests per minute to prevent keypress spam
  message: { error: 'Too many autocomplete requests. Please try again later.' }
});

// -----------------------------------------------------------------------------
// ROTTE DEGLI INGREDIENTI
// Gestisce le chiamate relative agli ingredienti (es. Autocomplete via AI).
// -----------------------------------------------------------------------------

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-lite",
  generationConfig: {
    maxOutputTokens: 256,
    temperature: 0.2,
  },
});

/**
 * GET /autocomplete
 * Fornisce suggerimenti in tempo reale (autocomplete) mentre l'utente digita
 * il nome di un ingrediente nella dispensa. Utilizza la cache del database e chiama Gemini AI
 * solo se ci sono meno di 5 suggerimenti salvati con lo stesso prefisso.
 */
router.get('/autocomplete', requireAuth, autocompleteLimiter, async (req, res) => {
  try {
    const { query } = req.query;
    
    // Previene chiamate API inutili se la query è troppo corta
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const normalizedQuery = query.trim().toLowerCase();

    // 1. Cerca se ci sono almeno 5 ingredienti con questo prefisso nel database
    let dbIngredients = await prisma.ingredient.findMany({
      where: {
        name: {
          startsWith: normalizedQuery,
          mode: 'insensitive'
        }
      },
      take: 5
    });

    // 2. Se ci sono meno di 5 elementi, chiama Gemini per suggerimenti aggiuntivi
    if (dbIngredients.length < 5) {
      const prompt = `Suggest exactly 5 common food ingredients whose name starts with or closely matches: "${query}".
Return ONLY a JSON array of objects with "name" and "id" fields. The "id" should be a unique integer.
Example: [{"name":"chicken breast","id":1},{"name":"chickpeas","id":2}]
Return ONLY the JSON array, no other text.`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      
      // Parsing del JSON dalla risposta dell'AI, con gestione dei blocchi di codice markdown
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const suggestions = JSON.parse(cleanJson);

      // 3. Salva i nuovi suggerimenti nel database tramite upsert per evitare duplicati
      for (const sugg of suggestions) {
        const name = sugg.name.trim().toLowerCase();
        if (!name) continue;
        await prisma.ingredient.upsert({
          where: { name },
          update: {},
          create: { name }
        });
      }

      // 4. Esegui nuovamente la query per ottenere tutti gli ingredienti con questo prefisso nel database
      dbIngredients = await prisma.ingredient.findMany({
        where: {
          name: {
            startsWith: normalizedQuery,
            mode: 'insensitive'
          }
        },
        take: 5
      });

      // Fallback: Se la corrispondenza con prefisso nel DB restituisce comunque meno di 5 elementi
      // (ad esempio se Gemini ha suggerito elementi che non iniziano esattamente con il prefisso),
      // assicurati di includere gli ingredienti appena suggeriti da Gemini caricandoli dal database.
      if (dbIngredients.length < 5) {
        const namesToFetch = suggestions.map(s => s.name.trim().toLowerCase());
        const fetched = await prisma.ingredient.findMany({
          where: {
            name: { in: namesToFetch }
          }
        });
        
        // Unisci e deduplica per id
        const mergedMap = new Map();
        dbIngredients.forEach(item => mergedMap.set(item.id, item));
        fetched.forEach(item => mergedMap.set(item.id, item));
        dbIngredients = Array.from(mergedMap.values()).slice(0, 5);
      }
    }

    // 5. Mappa i risultati nel formato atteso dal frontend
    const responseSuggestions = dbIngredients.map(item => ({
      id: item.id,
      name: item.name
    }));

    res.status(200).json(responseSuggestions);
  } catch (error) {
    console.error('Error in autocomplete:', error.message);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

export default router;
