import express from 'express';
import prisma from '../db.js';

const router = express.Router();

// 3. Save Nutritional Profile
router.post('/', async (req, res) => {
  // Riceviamo i dati dal frontend
  const { userId, dailyCalories, dailyProtein, dailyCarbs, dailyFat } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Upsert: Aggiorna se esiste, crea se non esiste
    const goal = await prisma.nutritionalGoal.upsert({
      where: { userId: userId },
      update: { dailyCalories, dailyProtein, dailyCarbs, dailyFat },
      create: { userId, dailyCalories, dailyProtein, dailyCarbs, dailyFat }
    });

    res.status(200).json({ message: 'Profile saved successfully', goal });
  } catch (error) {
    console.error('Error saving profile:', error.message);
    res.status(500).json({ error: 'Failed to save nutritional profile' });
  }
});

// 4. Get Nutritional Profile
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Cerca l'obiettivo nutrizionale nel database
    const goal = await prisma.nutritionalGoal.findUnique({
      where: { userId: userId }
    });

    if (!goal) {
      // Se non esiste ancora, restituiamo un 404 (React userà i valori base)
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.status(200).json(goal);
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(500).json({ error: 'Failed to fetch nutritional profile' });
  }
});

export default router;
