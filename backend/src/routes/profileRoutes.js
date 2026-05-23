import express from 'express';
import prisma from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// ROTTE DEL PROFILO UTENTE E OBIETTIVI NUTRIZIONALI
// Questo file gestisce le operazioni di salvataggio e recupero dei parametri
// dietetici dell'utente (calorie, macronutrienti, allergie e intolleranze).
// -----------------------------------------------------------------------------

/**
 * POST /
 * Salva o aggiorna il profilo nutrizionale e le preferenze dietetiche dell'utente.
 * Utilizza l'operazione di upsert per creare un nuovo record se non esiste,
 * oppure aggiornarlo se è già presente. L'ID utente viene estratto in modo sicuro
 * dal token JWT per prevenire manomissioni.
 */
router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const { dailyCalories, dailyProtein, dailyCarbs, dailyFat, excludedIngredients } = req.body;

  // Convert targets to integers to prevent decimal storage in Postgres Int fields and eliminate precision drift
  const parsedCalories = Math.round(Number(dailyCalories || 0));
  const parsedProtein = Math.round(Number(dailyProtein || 0));
  const parsedCarbs = Math.round(Number(dailyCarbs || 0));
  const parsedFat = Math.round(Number(dailyFat || 0));

  try {
    const goal = await prisma.nutritionalGoal.upsert({
      where: { userId: userId },
      update: {
        dailyCalories: parsedCalories,
        dailyProtein: parsedProtein,
        dailyCarbs: parsedCarbs,
        dailyFat: parsedFat
      },
      create: {
        userId,
        dailyCalories: parsedCalories,
        dailyProtein: parsedProtein,
        dailyCarbs: parsedCarbs,
        dailyFat: parsedFat
      }
    });

    const dietaryProfile = await prisma.dietaryProfile.upsert({
      where: { userId: userId },
      update: { excludedIngredients: excludedIngredients || [] },
      create: { userId, excludedIngredients: excludedIngredients || [] }
    });

    res.status(200).json({ message: 'Profile saved successfully', goal, dietaryProfile });
  } catch (error) {
    console.error('Error saving profile:', error.message);
    res.status(500).json({ error: 'Failed to save nutritional profile' });
  }
});

/**
 * GET /:userId
 * Recupera il profilo nutrizionale completo (inclusi gli obiettivi calorici
 * e le intolleranze) di uno specifico utente. Implementa un controllo IDOR
 * per assicurare che un utente possa accedere solo ai propri dati.
 */
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Protezione IDOR: verifica che l'utente loggato stia richiedendo i propri dati
    if (userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: Cannot access other users data' });
    }
    
    // Recupera l'obiettivo nutrizionale dal database
    const goal = await prisma.nutritionalGoal.findUnique({
      where: { userId: userId }
    });

    const dietaryProfile = await prisma.dietaryProfile.findUnique({
      where: { userId: userId }
    });

    if (!goal) {
      // Restituisce 404 se il profilo non è ancora stato configurato
      // permettendo al frontend di mostrare i valori di default
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.status(200).json({
      ...goal,
      excludedIngredients: dietaryProfile?.excludedIngredients || []
    });
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(500).json({ error: 'Failed to fetch nutritional profile' });
  }
});

export default router;
