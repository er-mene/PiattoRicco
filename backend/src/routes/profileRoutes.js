import express from 'express';
import prisma from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const { dailyCalories, dailyProtein, dailyCarbs, dailyFat, excludedIngredients, preferredCuisines, diets } = req.body;

  // Valida gli input per prevenire valori non numerici (NaN) o insensati
  const calVal = Number(dailyCalories || 0);
  const proVal = Number(dailyProtein || 0);
  const carbVal = Number(dailyCarbs || 0);
  const fatVal = Number(dailyFat || 0);

  if (
    isNaN(calVal) || calVal < 0 || calVal > 10000 ||
    isNaN(proVal) || proVal < 0 || proVal > 1000 ||
    isNaN(carbVal) || carbVal < 0 || carbVal > 1000 ||
    isNaN(fatVal) || fatVal < 0 || fatVal > 1000
  ) {
    return res.status(400).json({ error: 'Nutritional goals must be valid non-negative numbers within reasonable biological ranges (Calories max 10000, macros max 1000g)' });
  }

  // Converte i target in numeri interi per evitare salvataggi di decimali nei campi Int di Postgres e perdite di precisione
  const parsedCalories = Math.round(calVal);
  const parsedProtein = Math.round(proVal);
  const parsedCarbs = Math.round(carbVal);
  const parsedFat = Math.round(fatVal);

  try {
    // Avvolge entrambe le operazioni (Obiettivi e Profilo) in un blocco transazionale per assicurare aggiornamenti atomici
    const [goal, dietaryProfile] = await prisma.$transaction([
      prisma.nutritionalGoal.upsert({
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
      }),
      prisma.dietaryProfile.upsert({
        where: { userId: userId },
        update: {
          excludedIngredients: excludedIngredients || [],
          preferredCuisines: preferredCuisines || [],
          diets: diets || []
        },
        create: {
          userId,
          excludedIngredients: excludedIngredients || [],
          preferredCuisines: preferredCuisines || [],
          diets: diets || []
        }
      })
    ]);

    res.status(200).json({ message: 'Profile saved successfully', goal, dietaryProfile });
  } catch (error) {
    console.error('Error saving profile:', error.message);
    res.status(500).json({ error: 'Failed to save nutritional profile' });
  }
});

/**
 * GET /:userId
 * Recupera il profilo nutrizionale completo (inclusi obiettivi calorici e intolleranze)
 * per un utente specifico. Implementa controlli IDOR per assicurare che gli utenti accedano solo ai propri dati.
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
      // Restituisce 404 se il profilo non è ancora stato configurato, permettendo al frontend di caricare i valori di default
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.status(200).json({
      ...goal,
      excludedIngredients: dietaryProfile?.excludedIngredients || [],
      preferredCuisines: dietaryProfile?.preferredCuisines || [],
      diets: dietaryProfile?.diets || []
    });
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(500).json({ error: 'Failed to fetch nutritional profile' });
  }
});

export default router;
