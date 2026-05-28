import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import prisma from '../db.js';

const router = express.Router();

const autocompleteLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // Finestra di 1 minuto
  max: 30, // Limita ogni IP a 30 richieste di autocompletamento al minuto per prevenire lo spam da digitazione
  message: { error: 'Too many autocomplete requests. Please try again later.' }
});

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
 * Fornisce suggerimenti di autocompletamento in tempo reale mentre l'utente digita un ingrediente.
 * Usa il database come cache locale e interroga l'AI (Gemini) solo se i risultati
 * corrispondenti memorizzati sono inferiori a 5 per un determinato prefisso.
 */
router.get('/autocomplete', requireAuth, autocompleteLimiter, async (req, res) => {
  try {
    const { query } = req.query;

    // Previene chiamate API inutili se il prefisso digitato è troppo breve
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const normalizedQuery = query.trim().toLowerCase();

    // 1. Controlla se possediamo già almeno 5 ingredienti corrispondenti memorizzati nella cache locale (database)
    let dbIngredients = await prisma.ingredient.findMany({
      where: {
        name: {
          startsWith: normalizedQuery,
          mode: 'insensitive'
        }
      },
      take: 5
    });

    // 2. Se abbiamo meno di 5 corrispondenze nella cache, recupera nuovi suggerimenti interrogando l'AI (Gemini)
    if (dbIngredients.length < 5) {
      const prompt = `Suggest exactly 5 common food ingredients whose name starts with or closely matches: "${query}".
Return ONLY a JSON array of objects with "name" and "id" fields. The "id" should be a unique integer.
Example: [{"name":"chicken breast","id":1},{"name":"chickpeas","id":2}]
Return ONLY the JSON array, no other text.`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      // Analizza la risposta JSON dell'AI, rimuovendo eventuali blocchi di markdown o testo aggiuntivo
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const suggestions = JSON.parse(cleanJson);

      // 3. Salva i nuovi suggerimenti nel database utilizzando "upsert" per prevenire duplicati
      for (const sugg of suggestions) {
        const name = sugg.name.trim().toLowerCase();
        if (!name) continue;
        await prisma.ingredient.upsert({
          where: { name },
          update: {},
          create: { name }
        });
      }

      // 4. Interroga di nuovo il database per estrarre la cache aggiornata con i nuovi ingredienti appena aggiunti
      dbIngredients = await prisma.ingredient.findMany({
        where: {
          name: {
            startsWith: normalizedQuery,
            mode: 'insensitive'
          }
        },
        take: 5
      });

      // Meccanismo di Fallback: Se la ricerca rigida per prefisso (startsWith) restituisce meno di 5 elementi
      // (es. l'AI suggerisce varianti che contengono la parola ma non iniziano con essa), include tutti i suggerimenti estratti direttamente.
      if (dbIngredients.length < 5) {
        const namesToFetch = suggestions.map(s => s.name.trim().toLowerCase());
        const fetched = await prisma.ingredient.findMany({
          where: {
            name: { in: namesToFetch }
          }
        });

        // Unisce gli array e rimuove i duplicati basandosi sull'ID univoco
        const mergedMap = new Map();
        dbIngredients.forEach(item => mergedMap.set(item.id, item));
        fetched.forEach(item => mergedMap.set(item.id, item));
        dbIngredients = Array.from(mergedMap.values()).slice(0, 5);
      }
    }

    // 5. Mappa i risultati del database nella struttura snella (id, name) prevista dal frontend
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
