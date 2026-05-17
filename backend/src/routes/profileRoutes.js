import express from 'express';
import prisma from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// 3. Save Nutritional Profile
router.post('/', requireAuth, async (req, res) => {
  // Ignoriamo l'ID passato dal frontend e usiamo quello del JWT
  const userId = req.user.userId;
  const { dailyCalories, dailyProtein, dailyCarbs, dailyFat, allergies, intolerances } = req.body;

  try {
    // Upsert: Aggiorna se esiste, crea se non esiste
    const goal = await prisma.nutritionalGoal.upsert({
      where: { userId: userId },
      update: { dailyCalories, dailyProtein, dailyCarbs, dailyFat },
      create: { userId, dailyCalories, dailyProtein, dailyCarbs, dailyFat }
    });

    const dietaryProfile = await prisma.dietaryProfile.upsert({
      where: { userId: userId },
      update: { allergies: allergies || [], intolerances: intolerances || [] },
      create: { userId, allergies: allergies || [], intolerances: intolerances || [] }
    });

    res.status(200).json({ message: 'Profile saved successfully', goal, dietaryProfile });
  } catch (error) {
    console.error('Error saving profile:', error.message);
    res.status(500).json({ error: 'Failed to save nutritional profile' });
  }
});

// 4. Get Nutritional Profile
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // IDOR Protection: assicuriamoci che stia chiedendo il proprio profilo
    if (userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: Cannot access other users data' });
    }
    
    // Cerca l'obiettivo nutrizionale nel database
    const goal = await prisma.nutritionalGoal.findUnique({
      where: { userId: userId }
    });

    const dietaryProfile = await prisma.dietaryProfile.findUnique({
      where: { userId: userId }
    });

    if (!goal) {
      // Se non esiste ancora, restituiamo un 404 (React userà i valori base)
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.status(200).json({
      ...goal,
      allergies: dietaryProfile?.allergies || [],
      intolerances: dietaryProfile?.intolerances || []
    });
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(500).json({ error: 'Failed to fetch nutritional profile' });
  }
});

export default router;
