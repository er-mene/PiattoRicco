import express from 'express';
import prisma from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * Pantry Routes.
 * Exposes API endpoints for managing the user's personal pantry stock (CRUD operations).
 */

/**
 * GET /:userId
 * Retrieves all items in the user's pantry.
 * Results are ordered chronologically from most recent.
 */
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    
    const items = await prisma.pantryItem.findMany({
      where: { userId: userId },
      include: { ingredient: true }, // Ensure associated ingredient details are loaded
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(items);
  } catch (error) {
    console.error('Error fetching pantry:', error);
    res.status(500).json({ error: 'Failed to fetch pantry items' });
  }
});

/**
 * POST /
 * Adds a new ingredient to the user's pantry.
 * Creates the global ingredient record dynamically if it does not exist.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, quantity, unit } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (quantity !== null && quantity !== undefined && quantity !== '') {
      const parsedQuantity = parseFloat(quantity);
      if (isNaN(parsedQuantity) || parsedQuantity < 0) {
        return res.status(400).json({ error: 'Quantity must be a valid non-negative number' });
      }
    }

    const ingredientName = name.trim().toLowerCase();

    const ingredient = await prisma.ingredient.upsert({
      where: { name: ingredientName },
      update: {}, 
      create: { name: ingredientName } 
    });

    // Create pantry item, linking the user and the ingredient via Prisma relationships
    const newItem = await prisma.pantryItem.create({
      data: { 
        user: { connect: { id: userId } },
        ingredient: { connect: { id: ingredient.id } },
        quantity: (quantity === null || quantity === undefined || quantity === '') ? null : parseFloat(quantity),
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
/**
 * PUT /:id
 * Updates quantity and/or unit of measurement for an existing pantry item.
 * Allows clearing values by setting them explicitly to null.
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, unit } = req.body;
    
    // Security Check (IDOR prevention): verify the item exists and belongs to the authenticated user
    const item = await prisma.pantryItem.findUnique({ where: { id } });
    if (!item || item.userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    
    if (quantity !== null && quantity !== undefined && quantity !== '') {
      const parsedQuantity = parseFloat(quantity);
      if (isNaN(parsedQuantity) || parsedQuantity < 0) {
        return res.status(400).json({ error: 'Quantity must be a valid non-negative number' });
      }
    }

    const updatedItem = await prisma.pantryItem.update({
      where: { id: id },
      data: {
        // Enforce null validation to store empty inputs as NULL in the database
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
/**
 * DELETE /:id
 * Permanently removes an ingredient from the user's pantry.
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Security Check (IDOR prevention)
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
