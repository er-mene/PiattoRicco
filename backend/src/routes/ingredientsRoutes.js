import express from 'express';
import { getApiKey } from '../utils/spoonacular.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// ROTTE DEGLI INGREDIENTI
// Gestisce le chiamate esterne relative agli ingredienti (es. Autocomplete).
// -----------------------------------------------------------------------------

/**
 * GET /autocomplete
 * Fornisce suggerimenti in tempo reale (autocomplete) mentre l'utente digita
 * il nome di un ingrediente nella dispensa. Interroga direttamente le API di Spoonacular.
 */
router.get('/autocomplete', requireAuth, async (req, res) => {
  try {
    const { query } = req.query;
    
    // Previene chiamate API inutili se la query è troppo corta
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const apiKey = getApiKey();

    // Richiede a Spoonacular i 5 migliori suggerimenti basati sulla query
    const spoonacularUrl = `https://api.spoonacular.com/food/ingredients/autocomplete?query=${query}&number=5&metaInformation=true&apiKey=${apiKey}`;
    
    // Effettua la richiesta HTTP esterna sfruttando la fetch nativa di Node.js
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
