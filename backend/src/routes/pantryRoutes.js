import express from 'express';
import prisma from '../db.js';

const router = express.Router();

// 1. Get all ingredients for a user
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const items = await prisma.pantryItem.findMany({
      where: { userId: userId },
      include: { ingredient: true }, // Importante: alleghiamo i dati dell'ingrediente!
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(items);
  } catch (error) {
    console.error('Error fetching pantry:', error);
    res.status(500).json({ error: 'Failed to fetch pantry items' });
  }
});

// 2. Add a new ingredient to pantry
router.post('/', async (req, res) => {
  try {
    const { userId, name, quantity, unit } = req.body;
    
    if (!userId || !name || !quantity || !unit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ingredientName = name.trim().toLowerCase();

    // A. Trova l'ingrediente nel DB generale, o crealo se non esiste
    const ingredient = await prisma.ingredient.upsert({
      where: { name: ingredientName },
      update: {}, // Se esiste, non cambiamo nulla
      create: { name: ingredientName } // Se non esiste, lo creiamo
    });

    // B. Aggiungi l'elemento alla dispensa dell'utente
    const newItem = await prisma.pantryItem.create({
      data: { 
        userId: userId, 
        ingredientId: ingredient.id,
        quantity: parseFloat(quantity),
        unit: unit
      },
      include: {
        ingredient: true // Restituiamo il pacchetto completo al frontend
      }
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error adding ingredient:', error);
    res.status(500).json({ error: 'Failed to add ingredient' });
  }
});

// 3. Delete an ingredient from pantry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.pantryItem.delete({
      where: { id: id }
    });
    res.status(200).json({ message: 'Ingredient deleted' });
  } catch (error) {
    console.error('Error deleting ingredient:', error);
    res.status(500).json({ error: 'Failed to delete ingredient' });
  }
});

export default router;
