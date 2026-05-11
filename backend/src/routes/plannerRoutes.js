import express from 'express';
import prisma from '../db.js';
import { getApiKey } from '../utils/spoonacular.js';
import { buildMealSlots } from '../utils/plannerUtils.js';

const router = express.Router();

router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activePlan = await prisma.mealPlan.findFirst({
      where: { userId: userId, endDate: { gte: today } },
      include: {
        entries: {
          include: { recipe: true },
          orderBy: [{ day: 'asc' }, { mealType: 'asc' }]
        }
      }
    });

    if (!activePlan) return res.status(404).json({ message: 'No active plan found' });

    // --- MAGIA: Ricalcolo Dinamico degli Ingredienti ---
    // 1. Peschiamo la dispensa aggiornata in questo preciso istante
    const pantry = await prisma.pantryItem.findMany({ 
      where: { userId }, include: { ingredient: true } 
    });
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());

    // 2. Aggiorniamo le liste di ogni singola ricetta prima di inviarle al frontend
    activePlan.entries.forEach(entry => {
      const recipe = entry.recipe;
      const allIng = [
        ...(recipe.nutritionalInfo?.usedIngredients || []),
        ...(recipe.nutritionalInfo?.missedIngredients || [])
      ];

      let newUsed = [];
      let newMissed = [];

      allIng.forEach(ingName => {
        const lowerIng = ingName.toLowerCase();
        // Se c'è in dispensa, va in "used", altrimenti in "missed"
        const isInPantry = pantryNames.some(p => lowerIng.includes(p) || p.includes(lowerIng));
        isInPantry ? newUsed.push(ingName) : newMissed.push(ingName);
      });

      // Sovrascriviamo l'oggetto in memoria che stiamo per spedire a React
      recipe.nutritionalInfo.usedIngredients = newUsed;
      recipe.nutritionalInfo.missedIngredients = newMissed;
    });
    // ---------------------------------------------------

    res.status(200).json(activePlan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active meal plan' });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });
    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId } });
    if (!goal) return res.status(400).json({ error: 'Profile incomplete' });
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId } });

    const pantry = await prisma.pantryItem.findMany({ where: { userId }, include: { ingredient: true } });
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());
    const pantryQuery = pantryNames.join(',');

    const apiKey = getApiKey();
    const mealSlots = buildMealSlots(goal);
    const breakfastTarget = mealSlots.find(s => s.mealType === 'BREAKFAST').targets;
    const lunchTarget = mealSlots.find(s => s.mealType === 'LUNCH').targets;
    
    const snacksSlots = mealSlots.filter(s => s.mealType === 'SNACK');
    const snackCount = snacksSlots.length;
    const snackTarget = snackCount > 0 ? snacksSlots[0].targets : null;

    // 1. IL MOTORE DI RICERCA (Heuristic Fetch)
    const fetchPool = async (type, count, targetCals) => {
      // Finestre di macro molto ampie: lasciamo che Spoonacular trovi i risultati,
      // la precisione al grammo la farà il nostro algoritmo di Tetris locale.
      const minCals = Math.max(50, targetCals - 400);
      const maxCals = targetCals + 400;

      let baseUrl = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=${count}&type=${type}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true&minCalories=${minCals}&maxCalories=${maxCals}`;

      if (dietaryProfile?.diets?.length) {
        baseUrl += `&diet=${dietaryProfile.diets.join(',')}`;
      }
      if (dietaryProfile?.intolerances?.length) {
        baseUrl += `&intolerances=${dietaryProfile.intolerances.join(',')}`;
      }
      if (dietaryProfile?.excludedIngredients?.length) {
        baseUrl += `&excludeIngredients=${dietaryProfile.excludedIngredients.join(',')}`;
      }
      if (dietaryProfile?.preferredCuisines?.length) {
        baseUrl += `&cuisine=${dietaryProfile.preferredCuisines.join(',')}`;
      }

      if (pantryQuery) {
        const strictUrl = `${baseUrl}&includeIngredients=${encodeURIComponent(pantryQuery)}&sort=max-used-ingredients`;
        
        const res = await fetch(strictUrl);
        const data = await res.json();
        
        // Se troviamo un buon bacino di ricette con questi ingredienti, lo usiamo
        if (data.results && data.results.length >= (type === 'breakfast' ? 7 : 14)) {
          return data.results;
        }
      }

      // FALLBACK: Se l'ingrediente estratto era troppo raro (es. "zafferano"),
      // peschiamo ricette generiche ma che rispettano le calorie, per non bloccare l'app.
      const res = await fetch(baseUrl);
      const data = await res.json();
      return data.results || [];
    };

    // Peschiamo un "bacino" di ricette da cui attingere
    const breakfastPool = await fetchPool('breakfast', 15, breakfastTarget.calories);
    const mainPool = await fetchPool('main course', 30, lunchTarget.calories);
    const snackPool = snackCount > 0 ? await fetchPool('snack', snackCount * 7 + 5, snackTarget.calories) : [];

    // Mettiamo un controllo di sicurezza solo per problemi di rete dell'API
    if (breakfastPool.length < 7 || mainPool.length < 14 || (snackCount > 0 && snackPool.length < snackCount * 7)) {
      return res.status(400).json({ error: 'Spoonacular API is busy or out of quota. Please try again in a few seconds!' });
    }

    const getPantryScore = (recipe) => {
      const allIng = [...(recipe.usedIngredients || []), ...(recipe.missedIngredients || []), ...(recipe.extendedIngredients || [])];
      const uniqueNames = Array.from(new Set(allIng.map(a => a.name.toLowerCase())));
      return uniqueNames.filter(ingName => pantryNames.some(p => ingName.includes(p) || p.includes(ingName))).length;
    };
    breakfastPool.sort((a, b) => getPantryScore(b) - getPantryScore(a));
    mainPool.sort((a, b) => getPantryScore(b) - getPantryScore(a));
    if (snackCount > 0) snackPool.sort((a, b) => getPantryScore(b) - getPantryScore(a));

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    await prisma.mealPlan.deleteMany({ where: { userId: userId, endDate: { gte: today } } });

    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 6);

    const mealPlan = await prisma.mealPlan.create({
      data: { userId, startDate: today, endDate, planType: 'WEEKLY' }
    });

    // Utility per leggere i macro in modo sicuro
    const getMacro = (recipe, name) => recipe?.nutrition?.nutrients?.find(n => n.name === name)?.amount || 0;

    let currentDate = new Date(today);
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    // 2. FASE DI INCASRTRO (TETRIS GIORNALIERO)
    for (let i = 0; i < days.length; i++) {
      
      let remCals = goal.dailyCalories;
      let remPro = goal.dailyProtein;
      let remCarbs = goal.dailyCarbs;
      let remFat = goal.dailyFat;

      // A. La Colazione (Rimane identica)
      const b = breakfastPool.splice(0, 1)[0];
      remCals -= getMacro(b, 'Calories');
      remPro -= getMacro(b, 'Protein');
      remCarbs -= getMacro(b, 'Carbohydrates');
      remFat -= getMacro(b, 'Fat');
      const dailyMeals = [{ type: 'BREAKFAST', slotIndex: 0, data: b }];

      // B. Il Pranzo
      mainPool.sort((x, y) => {
        const diffX = Math.abs(getMacro(x, 'Calories') - lunchTarget.calories) + (Math.abs(getMacro(x, 'Protein') - lunchTarget.protein) * 4) + (Math.abs(getMacro(x, 'Carbohydrates') - lunchTarget.carbs) * 4) + (Math.abs(getMacro(x, 'Fat') - lunchTarget.fat) * 9);
        const diffY = Math.abs(getMacro(y, 'Calories') - lunchTarget.calories) + (Math.abs(getMacro(y, 'Protein') - lunchTarget.protein) * 4) + (Math.abs(getMacro(y, 'Carbohydrates') - lunchTarget.carbs) * 4) + (Math.abs(getMacro(y, 'Fat') - lunchTarget.fat) * 9);
        return diffX - diffY;
      });
      const l = mainPool.shift();
      remCals -= getMacro(l, 'Calories');
      remPro -= getMacro(l, 'Protein');
      remCarbs -= getMacro(l, 'Carbohydrates');
      remFat -= getMacro(l, 'Fat');
      dailyMeals.push({ type: 'LUNCH', slotIndex: 0, data: l });

      // C. Gli Snack
      for (let sIndex = 0; sIndex < snackCount; sIndex++) {
        snackPool.sort((x, y) => {
          const diffX = Math.abs(getMacro(x, 'Calories') - snackTarget.calories) + (Math.abs(getMacro(x, 'Protein') - snackTarget.protein) * 4) + (Math.abs(getMacro(x, 'Carbohydrates') - snackTarget.carbs) * 4) + (Math.abs(getMacro(x, 'Fat') - snackTarget.fat) * 9);
          const diffY = Math.abs(getMacro(y, 'Calories') - snackTarget.calories) + (Math.abs(getMacro(y, 'Protein') - snackTarget.protein) * 4) + (Math.abs(getMacro(y, 'Carbohydrates') - snackTarget.carbs) * 4) + (Math.abs(getMacro(y, 'Fat') - snackTarget.fat) * 9);
          return diffX - diffY;
        });
        const s = snackPool.shift();
        remCals -= getMacro(s, 'Calories');
        remPro -= getMacro(s, 'Protein');
        remCarbs -= getMacro(s, 'Carbohydrates');
        remFat -= getMacro(s, 'Fat');
        dailyMeals.push({ type: 'SNACK', slotIndex: sIndex, data: s });
      }

      // D. La Cena: Ora sì, la cena DEVE assorbire tutto il rimanente esatto per chiudere la giornata.
      mainPool.sort((x, y) => {
        const diffX = Math.abs(getMacro(x, 'Calories') - remCals) + (Math.abs(getMacro(x, 'Protein') - remPro) * 4) + (Math.abs(getMacro(x, 'Carbohydrates') - remCarbs) * 4) + (Math.abs(getMacro(x, 'Fat') - remFat) * 9);
        const diffY = Math.abs(getMacro(y, 'Calories') - remCals) + (Math.abs(getMacro(y, 'Protein') - remPro) * 4) + (Math.abs(getMacro(y, 'Carbohydrates') - remCarbs) * 4) + (Math.abs(getMacro(y, 'Fat') - remFat) * 9);
        return diffX - diffY;
      });
      const d = mainPool.shift();
      dailyMeals.push({ type: 'DINNER', slotIndex: 0, data: d });

      // Salvataggio nel Database (Uguale a prima, ma con controllo Dispensa infallibile)
      for (let j = 0; j < dailyMeals.length; j++) {
        const mealData = dailyMeals[j];
        const recipeData = mealData.data;

        let used = [];
        let missed = [];
        const allIng = [...(recipeData.usedIngredients || []), ...(recipeData.missedIngredients || []), ...(recipeData.extendedIngredients || [])];
        const uniqueIng = Array.from(new Set(allIng.map(a => a.name))).map(n => allIng.find(a => a.name === n));
        
        uniqueIng.forEach(ing => {
          const ingName = ing.name.toLowerCase();
          pantryNames.some(p => ingName.includes(p) || p.includes(ingName)) ? used.push(ing.name) : missed.push(ing.name);
        });

        // FIX SALVATAGGIO: Uso corretto della variabile 'recipeData'
        const recipe = await prisma.recipe.upsert({
          where: { spoonacularId: recipeData.id },
          update: {
            instructions: recipeData.instructions,
            nutritionalInfo: { 
              usedIngredients: used, 
              missedIngredients: missed, 
              extendedIngredients: recipeData.extendedIngredients 
            }
          },
          create: {
            sourceType: 'SPOONACULAR',
            spoonacularId: recipeData.id,
            title: recipeData.title,
            imageUrl: recipeData.image,
            sourceUrl: recipeData.sourceUrl,
            instructions: recipeData.instructions,
            readyInMinutes: recipeData.readyInMinutes || 30,
            servings: recipeData.servings || 1,
            caloriesPerServing: getMacro(recipeData, 'Calories'),
            proteinGramsPerServing: getMacro(recipeData, 'Protein'),
            carbsGramsPerServing: getMacro(recipeData, 'Carbohydrates'),
            fatGramsPerServing: getMacro(recipeData, 'Fat'),
            nutritionalInfo: { 
              usedIngredients: used, 
              missedIngredients: missed, 
              extendedIngredients: recipeData.extendedIngredients 
            }
          }
        });

        await prisma.mealPlanEntry.create({
          data: {
            mealPlanId: mealPlan.id,
            day: new Date(currentDate),
            mealType: mealData.type,
            slotIndex: mealData.slotIndex,
            recipeId: recipe.id,
            isLocked: false 
          }
        });
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.status(201).json({ message: 'Smart Plan generated!', mealPlanId: mealPlan.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate plan' });
  }
});

// Swap 4.0: Ordinamento Matematico Locale (Zero Errori API)
router.put('/swap/:entryId', async (req, res) => {
  try {
    const { entryId } = req.params;
    const apiKey = getApiKey();

    const currentEntry = await prisma.mealPlanEntry.findUnique({ where: { id: entryId }, include: { mealPlan: true } });
    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId: currentEntry.mealPlan.userId } });
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId: currentEntry.mealPlan.userId } });
    
    const pantry = await prisma.pantryItem.findMany({ where: { userId: currentEntry.mealPlan.userId }, include: { ingredient: true } });
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());
    const pantryQuery = pantryNames.join(',');

    const dayEntries = await prisma.mealPlanEntry.findMany({ 
      where: { mealPlanId: currentEntry.mealPlanId, day: currentEntry.day, id: { not: entryId } }, include: { recipe: true } 
    });

    const usedCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
    const usedPro = dayEntries.reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
    const usedCarb = dayEntries.reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
    const usedFat = dayEntries.reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

    // Cosa ci manca per finire la giornata perfetta?
    const targetCals = Math.max(100, goal.dailyCalories - usedCals);
    const targetPro = Math.max(5, goal.dailyProtein - usedPro);
    const targetCarb = Math.max(5, goal.dailyCarbs - usedCarb);
    const targetFat = Math.max(5, goal.dailyFat - usedFat);

    const type = currentEntry.mealType === 'BREAKFAST' ? 'breakfast' : 'main course';

    // CHIEDIAMO 15 RICETTE SENZA FILTRI SEVERI. Preveniamo il crash dell'API.
    let url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=15&type=${type}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true`;
    
    if (dietaryProfile?.diets?.length) {
      url += `&diet=${dietaryProfile.diets.join(',')}`;
    }
    if (dietaryProfile?.intolerances?.length) {
      url += `&intolerances=${dietaryProfile.intolerances.join(',')}`;
    }
    if (dietaryProfile?.excludedIngredients?.length) {
      url += `&excludeIngredients=${dietaryProfile.excludedIngredients.join(',')}`;
    }
    if (dietaryProfile?.preferredCuisines?.length) {
      url += `&cuisine=${dietaryProfile.preferredCuisines.join(',')}`;
    }

    if (pantryQuery) {
      url += `&includeIngredients=${encodeURIComponent(pantryQuery)}&sort=max-used-ingredients`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.results || data.results.length === 0) return res.status(400).json({ error: 'Nessuna ricetta trovata.' });

    const getMacro = (r, name) => r.nutrition?.nutrients?.find(n => n.name === name)?.amount || 0;

    // LA MAGIA: Il nostro server Node.js ordina le 15 ricette mettendo in cima quella con l'errore matematico minore
    data.results.sort((a, b) => {
      const errA = Math.abs(getMacro(a, 'Calories') - targetCals) + Math.abs(getMacro(a, 'Protein') - targetPro)*4 + Math.abs(getMacro(a, 'Carbohydrates') - targetCarb)*4 + Math.abs(getMacro(a, 'Fat') - targetFat)*9;
      const errB = Math.abs(getMacro(b, 'Calories') - targetCals) + Math.abs(getMacro(b, 'Protein') - targetPro)*4 + Math.abs(getMacro(b, 'Carbohydrates') - targetCarb)*4 + Math.abs(getMacro(b, 'Fat') - targetFat)*9;
      return errA - errB;
    });

    const rd = data.results[0]; // Prendiamo la vincitrice assoluta

    // Calcolo Dispensa
    let used = [], missed = [];
    const allIng = [...(rd.usedIngredients || []), ...(rd.missedIngredients || []), ...(rd.extendedIngredients || [])];
    const uniqueIng = Array.from(new Set(allIng.map(a => a.name.toLowerCase()))).map(n => allIng.find(a => a.name.toLowerCase() === n));
    uniqueIng.forEach(ing => {
      pantryNames.some(p => ing.name.toLowerCase().includes(p) || p.includes(ing.name.toLowerCase())) ? used.push(ing.name) : missed.push(ing.name);
    });

    const newRecipe = await prisma.recipe.upsert({
      where: { spoonacularId: rd.id },
      update: { 
        instructions: rd.instructions, 
        nutritionalInfo: { 
          usedIngredients: used,            // <-- FIX: Aggiunto!
          missedIngredients: missed,        // <-- FIX: Aggiunto!
          extendedIngredients: rd.extendedIngredients 
        } 
      },
      create: {
        sourceType: 'SPOONACULAR', spoonacularId: rd.id, title: rd.title, imageUrl: rd.image,
        instructions: rd.instructions, readyInMinutes: rd.readyInMinutes || 30, servings: rd.servings || 1,
        caloriesPerServing: getMacro(rd, 'Calories'), proteinGramsPerServing: getMacro(rd, 'Protein'),
        carbsGramsPerServing: getMacro(rd, 'Carbohydrates'), fatGramsPerServing: getMacro(rd, 'Fat'),
        nutritionalInfo: { usedIngredients: used, missedIngredients: missed, extendedIngredients: rd.extendedIngredients }
      }
    });

    const updatedEntry = await prisma.mealPlanEntry.update({
      where: { id: entryId }, data: { recipeId: newRecipe.id, isLocked: false }, include: { recipe: true }
    });

    res.status(200).json(updatedEntry);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Swap failed' });
  }
});

// NUOVA ROTTA: Segna il pasto come "Mangiato" (isLocked)
router.patch('/entry/:entryId/toggle', async (req, res) => {
  try {
    const { entryId } = req.params;
    const { isLocked } = req.body;

    const updatedEntry = await prisma.mealPlanEntry.update({
      where: { id: entryId },
      data: { isLocked: isLocked }
    });

    res.status(200).json(updatedEntry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle status' });
  }
});

export default router;
