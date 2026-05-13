import express from 'express';
import prisma from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// 1. Get all ingredients for a user
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    
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
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId; // Use trusted ID
    const { name, quantity, unit } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ingredientName = name.trim().toLowerCase();

    const ingredient = await prisma.ingredient.upsert({
      where: { name: ingredientName },
      update: {}, 
      create: { name: ingredientName } 
    });

// Sostituisci questo blocco in pantryRoutes.js
    const newItem = await prisma.pantryItem.create({
      data: { 
        // Usiamo la sintassi 'connect' per le relazioni al posto dei semplici ID
        user: { connect: { id: userId } },
        ingredient: { connect: { id: ingredient.id } },
        quantity: (quantity === null || quantity === undefined) ? null : parseFloat(quantity),
        unit: unit || null
      },
      include: {
        ingredient: true 
      }
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error adding ingredient:', error);
    res.status(500).json({ error: 'Failed to add ingredient' });
  }
});
// NUOVA ROTTA: Update quantity and unit
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, unit } = req.body;
    
    // IDOR Check
    const item = await prisma.pantryItem.findUnique({ where: { id } });
    if (!item || item.userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    
    const updatedItem = await prisma.pantryItem.update({
      where: { id: id },
      data: {
        // Accetta valori vuoti o nulli convertendoli in null per il database
        quantity: (quantity === null || quantity === '' || quantity === undefined) ? null : parseFloat(quantity),
        unit: unit || null
      },
      include: { ingredient: true }
    });
    res.status(200).json(updatedItem);
  } catch (error) {
    console.error('Error updating ingredient:', error);
    res.status(500).json({ error: 'Failed to update ingredient' });
  }
});
// 3. Delete an ingredient from pantry
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // IDOR Check
    const item = await prisma.pantryItem.findUnique({ where: { id } });
    if (!item || item.userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    
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
