const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); 
app.use(express.json());

app.get('/api/recipes', async (req, res) => {
    const { ingredients } = req.query;

    if (!ingredients) {
        return res.status(400).json({ error: 'Please provide some ingredients' });
    }

    try {
        
        const spoonacularUrl = `https://api.spoonacular.com/recipes/findByIngredients`;
        const response = await axios.get(spoonacularUrl, {
            params: {
                ingredients: ingredients,
                number: 10, // Number of recipes to return
                ranking: 2, // 1 = maximize used ingredients, 2 = minimize missing ingredients
                apiKey: process.env.SPOONACULAR_API_KEY
            }
        });

        
        res.json(response.data);

    } catch (error) {
        console.error('Error fetching recipes:', error.message);
        res.status(500).json({ error: 'Failed to fetch recipes from Spoonacular' });
    }
});


app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});