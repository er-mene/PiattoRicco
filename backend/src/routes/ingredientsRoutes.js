import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

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
 * il nome di un ingrediente nella dispensa. Utilizza Gemini AI per generare suggerimenti.
 */
router.get('/autocomplete', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    
    // Previene chiamate API inutili se la query è troppo corta
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const prompt = `Suggest exactly 5 common food ingredients whose name starts with or closely matches: "${query}".
Return ONLY a JSON array of objects with "name" and "id" fields. The "id" should be a unique integer.
Example: [{"name":"chicken breast","id":1},{"name":"chickpeas","id":2}]
Return ONLY the JSON array, no other text.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    // Parsing del JSON dalla risposta dell'AI, con gestione dei blocchi di codice markdown
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const suggestions = JSON.parse(cleanJson);

    res.status(200).json(suggestions);
  } catch (error) {
    console.error('Error in autocomplete:', error.message);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

export default router;
