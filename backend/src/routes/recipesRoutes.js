import express from 'express';
import { spoonacularGet } from '../utils/spoonacular.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { ingredients } = req.query;

  if (!ingredients) {
    return res.status(400).json({ error: 'Please provide some ingredients' });
  }

  try {
    const recipes = await spoonacularGet('/recipes/findByIngredients', {
      ingredients,
      number: 10,
      ranking: 2,
    });

    res.json(recipes);
  } catch (error) {
    console.error('Error fetching recipes:', error.message);
    res.status(500).json({ error: 'Failed to fetch recipes from Spoonacular' });
  }
});

export default router;
