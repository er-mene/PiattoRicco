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

/**
 * Ingredients Routes.
 * Handles queries related to food ingredients (e.g. autocomplete suggestions).
 */

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
 * Provides real-time autocompletion suggestions as the user types an ingredient.
 * Uses database-backed caching, querying Gemini AI only if fewer than 5 matching
 * ingredients are cached with the given prefix.
 */
router.get('/autocomplete', requireAuth, autocompleteLimiter, async (req, res) => {
  try {
    const { query } = req.query;
    
    // Prevent unnecessary API calls if query prefix is too short
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const normalizedQuery = query.trim().toLowerCase();

    // 1. Check if we already have at least 5 ingredients in the local DB cache
    let dbIngredients = await prisma.ingredient.findMany({
      where: {
        name: {
          startsWith: normalizedQuery,
          mode: 'insensitive'
        }
      },
      take: 5
    });

    // 2. If fewer than 5 matching cached items, fetch suggestions from Gemini AI
    if (dbIngredients.length < 5) {
      const prompt = `Suggest exactly 5 common food ingredients whose name starts with or closely matches: "${query}".
Return ONLY a JSON array of objects with "name" and "id" fields. The "id" should be a unique integer.
Example: [{"name":"chicken breast","id":1},{"name":"chickpeas","id":2}]
Return ONLY the JSON array, no other text.`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      
      // Parse the JSON response from AI, stripping potential markdown blocks if present
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const suggestions = JSON.parse(cleanJson);

      // 3. Persist the new suggestions to the DB using upsert to prevent duplication
      for (const sugg of suggestions) {
        const name = sugg.name.trim().toLowerCase();
        if (!name) continue;
        await prisma.ingredient.upsert({
          where: { name },
          update: {},
          create: { name }
        });
      }

      // 4. Query the DB again to retrieve the newly populated cached ingredients
      dbIngredients = await prisma.ingredient.findMany({
        where: {
          name: {
            startsWith: normalizedQuery,
            mode: 'insensitive'
          }
        },
        take: 5
      });

      // Fallback: If prefix matching returns fewer than 5 items (e.g. Gemini returns items that
      // do not strictly match the startsWith prefix), include all suggestions directly from DB.
      if (dbIngredients.length < 5) {
        const namesToFetch = suggestions.map(s => s.name.trim().toLowerCase());
        const fetched = await prisma.ingredient.findMany({
          where: {
            name: { in: namesToFetch }
          }
        });
        
        // Merge and deduplicate by ID
        const mergedMap = new Map();
        dbIngredients.forEach(item => mergedMap.set(item.id, item));
        fetched.forEach(item => mergedMap.set(item.id, item));
        dbIngredients = Array.from(mergedMap.values()).slice(0, 5);
      }
    }

    // 5. Map DB results to the structure expected by the frontend
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
