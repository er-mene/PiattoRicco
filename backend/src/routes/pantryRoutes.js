import express from 'express';
import prisma from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /:userId
 * Recupera tutti gli elementi presenti nella dispensa dell'utente.
 * I risultati sono ordinati cronologicamente, dal più recente al più vecchio.
 */
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const items = await prisma.pantryItem.findMany({
      where: { userId: userId },
      include: { ingredient: true }, // Assicura che i dettagli dell'ingrediente associato vengano caricati
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
 * Aggiunge un nuovo ingrediente alla dispensa dell'utente.
 * Crea il record globale dell'ingrediente in modo dinamico se non esiste già.
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

    // Crea l'elemento nella dispensa, collegando l'utente e l'ingrediente tramite relazioni Prisma
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
 * Aggiorna la quantità e/o l'unità di misura per un elemento esistente in dispensa.
 * Permette di cancellare i valori impostandoli esplicitamente a null.
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, unit } = req.body;

    // Controllo di Sicurezza (prevenzione IDOR): verifica che l'elemento esista e appartenga all'utente autenticato
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
        // Applica validazione NULL per salvare gli input vuoti come NULL nel database
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
 * Rimuove definitivamente un ingrediente dalla dispensa dell'utente.
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Controllo di Sicurezza (prevenzione IDOR)
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
