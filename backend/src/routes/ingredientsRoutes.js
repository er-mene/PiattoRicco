import express from 'express';
import { getApiKey } from '../utils/spoonacular.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Autocomplete Ingredients via Spoonacular
router.get('/autocomplete', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    
    // Se l'utente ha scritto meno di 2 lettere, non facciamo la chiamata
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const apiKey = getApiKey();

    // Chiamiamo Spoonacular per avere i 5 migliori suggerimenti
    const spoonacularUrl = `https://api.spoonacular.com/food/ingredients/autocomplete?query=${query}&number=5&metaInformation=true&apiKey=${apiKey}`;
    
    // Node.js v18+ ha fetch nativo, possiamo usarlo nel backend!
    const response = await fetch(spoonacularUrl);
    if (!response.ok) {
      throw new Error(`Spoonacular API responded with status ${response.status}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Error in autocomplete:', error.message);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

export default router;
