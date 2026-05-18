import express from 'express';
import prisma from '../db.js';
import crypto from 'crypto';
import { getApiKey } from '../utils/spoonacular.js';
import { buildMealSlots } from '../utils/plannerUtils.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activePlan = await prisma.mealPlan.findFirst({
      where: { userId: userId, endDate: { gte: today } },
      include: {
        entries: {
          include: { recipe: true },
          orderBy: [{ day: 'asc' }, { slotIndex: 'asc' }]
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

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId; // Trusted ID
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
      if (dietaryProfile?.intolerances?.length || dietaryProfile?.allergies?.length) {
        const combined = [...(dietaryProfile?.intolerances || []), ...(dietaryProfile?.allergies || [])];
        baseUrl += `&intolerances=${combined.join(',')}`;
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

    const addScore = (pool) => pool.map(r => ({ ...r, pantryScore: getPantryScore(r) })).sort((a, b) => b.pantryScore - a.pantryScore);
    const scoredBreakfast = addScore(breakfastPool);
    const scoredMain = addScore(mainPool);
    const scoredSnack = snackCount > 0 ? addScore(snackPool) : [];

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    await prisma.mealPlan.deleteMany({ where: { userId: userId, endDate: { gte: today } } });

    // DB BLOAT FIX: Clean up orphaned recipes that have no meal plan entries left
    await prisma.recipe.deleteMany({
      where: {
        mealPlanEntries: {
          none: {}
        }
      }
    });

    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 6);

    const mealPlan = await prisma.mealPlan.create({
      data: { userId, startDate: today, endDate, planType: 'WEEKLY' }
    });

    // Utility per leggere i macro in modo sicuro
    const getMacro = (recipe, name) => recipe?.nutrition?.nutrients?.find(n => n.name === name)?.amount || 0;

    let currentDate = new Date(today);
    const days = [0, 1, 2, 3, 4, 5, 6];
    let mealPlanEntriesData = [];

    // 2. FASE DI INCASRTRO (TETRIS GIORNALIERO)
    for (let i = 0; i < days.length; i++) {

      let remCals = goal.dailyCalories;
      let remPro = goal.dailyProtein;
      let remCarbs = goal.dailyCarbs;
      let remFat = goal.dailyFat;

      let dailyMeals = [];

      // A. La Colazione
      const b = scoredBreakfast.shift() || scoredBreakfast[0];
      if (b) {
        remCals -= getMacro(b, 'Calories');
        remPro -= getMacro(b, 'Protein');
        remCarbs -= getMacro(b, 'Carbohydrates');
        remFat -= getMacro(b, 'Fat');
        dailyMeals.push({ type: 'BREAKFAST', slotIndex: 10, data: b });
      }

      // B. Gli Snack (Distribuiti tra mattina e pomeriggio)
      for (let sIndex = 0; sIndex < snackCount; sIndex++) {
        const s = scoredSnack.shift() || scoredSnack[0];
        if (s) {
          remCals -= getMacro(s, 'Calories');
          remPro -= getMacro(s, 'Protein');
          remCarbs -= getMacro(s, 'Carbohydrates');
          remFat -= getMacro(s, 'Fat');

          const snackSlot = (sIndex % 2 === 0 ? 20 : 40) + Math.floor(sIndex / 2);
          dailyMeals.push({ type: 'SNACK', slotIndex: snackSlot, data: s });
        }
      }

      // C. SCELTA PRANZO/CENA
      let bestPair = null;
      let minError = Infinity;
      let bestPairFallback = null;
      let minErrorFallback = Infinity;

      for (let x = 0; x < Math.min(10, scoredMain.length); x++) {
        for (let y = x + 1; y < Math.min(15, scoredMain.length); y++) {
          const l_cand = scoredMain[x];
          const d_cand = scoredMain[y];

          const combinedCals = getMacro(l_cand, 'Calories') + getMacro(d_cand, 'Calories');
          const combinedPro = getMacro(l_cand, 'Protein') + getMacro(d_cand, 'Protein');
          const combinedCarbs = getMacro(l_cand, 'Carbohydrates') + getMacro(d_cand, 'Carbohydrates');
          const combinedFat = getMacro(l_cand, 'Fat') + getMacro(d_cand, 'Fat');

          // Errore sui macro: penalizziamo le deviazioni.
          const error = Math.abs(combinedCals - remCals) +
            Math.abs(combinedPro - remPro) * 4 +
            Math.abs(combinedCarbs - remCarbs) * 4 +
            Math.abs(combinedFat - remFat) * 9;

          // Se soddisfa il vincolo rigoroso delle 100 kcal
          if (Math.abs(combinedCals - remCals) <= 100) {
            if (error < minError) {
              minError = error;
              bestPair = { indexL: x, indexD: y, l: l_cand, d: d_cand };
            }
          }

          // Tracciamo anche il miglior fallback generale
          if (error < minErrorFallback) {
            minErrorFallback = error;
            bestPairFallback = { indexL: x, indexD: y, l: l_cand, d: d_cand };
          }
        }
      }

      const selectedPair = bestPair || bestPairFallback;

      // Rimuoviamo gli elementi dal pool (rimuoviamo prima quello con indice maggiore per non sfalsare)
      const maxIndex = Math.max(selectedPair.indexL, selectedPair.indexD);
      const minIndex = Math.min(selectedPair.indexL, selectedPair.indexD);

      scoredMain.splice(maxIndex, 1);
      scoredMain.splice(minIndex, 1);

      // Aggiungiamo pranzo e cena
      dailyMeals.push({ type: 'LUNCH', slotIndex: 30, data: selectedPair.l });
      dailyMeals.push({ type: 'DINNER', slotIndex: 50, data: selectedPair.d });

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
router.put('/swap/:entryId', requireAuth, async (req, res) => {
  console.log("=== STARTING SWAP FOR ENTRY:", req.params.entryId, "===");
  try {
    const { entryId } = req.params;
    const apiKey = getApiKey();

    const currentEntry = await prisma.mealPlanEntry.findUnique({ where: { id: entryId }, include: { mealPlan: true, recipe: true } });
    if (!currentEntry || currentEntry.mealPlan.userId !== req.user.userId) {
      console.log("Error: Forbidden or Entry not found");
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    console.log("Found current entry, Recipe Source:", currentEntry.recipe.sourceType);

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

    let type = 'main course';
    if (currentEntry.mealType === 'BREAKFAST') type = 'breakfast';
    if (currentEntry.mealType === 'SNACK') type = 'snack';

    const offset = Math.floor(Math.random() * 30); // Random offset to ensure variety on multiple swaps

    // CHIEDIAMO 15 RICETTE SENZA FILTRI SEVERI. Preveniamo il crash dell'API.
    let url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=15&offset=${offset}&type=${type}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true`;

    if (dietaryProfile?.diets?.length) {
      url += `&diet=${dietaryProfile.diets.join(',')}`;
    }
    const validSpoonacularIntolerances = ['dairy', 'egg', 'gluten', 'grain', 'peanut', 'seafood', 'sesame', 'shellfish', 'soy', 'sulfite', 'tree nut', 'wheat'];
    let finalIntolerances = [];
    let finalExclude = [...(dietaryProfile?.excludedIngredients || [])];

    if (dietaryProfile?.intolerances?.length || dietaryProfile?.allergies?.length) {
      const combined = [...(dietaryProfile?.intolerances || []), ...(dietaryProfile?.allergies || [])];
      combined.forEach(item => {
        if (validSpoonacularIntolerances.includes(item.toLowerCase().trim())) {
          finalIntolerances.push(item.trim());
        } else {
          finalExclude.push(item.trim());
        }
      });
    }

    if (finalIntolerances.length > 0) {
      url += `&intolerances=${finalIntolerances.join(',')}`;
    }
    if (finalExclude.length > 0) {
      url += `&excludeIngredients=${finalExclude.join(',')}`;
    }
    if (dietaryProfile?.preferredCuisines?.length) {
      url += `&cuisine=${dietaryProfile.preferredCuisines.join(',')}`;
    }

    // Spoonacular's `includeIngredients` uses a strict AND condition. 
    // If we pass the whole pantry, it searches for a recipe containing EVERY SINGLE item!
    // To prevent 0 results, we pick 1 random pantry item to prioritize.
    if (pantryNames.length > 0) {
      const randomIngredient = pantryNames[Math.floor(Math.random() * pantryNames.length)];
      url += `&includeIngredients=${encodeURIComponent(randomIngredient)}`;
    }

    console.log("Fetching Spoonacular URL:", url.replace(apiKey, 'HIDDEN_API_KEY'));
    let response = await fetch(url);
    let data = await response.json();

    if (data.status === 'failure' || data.code === 402 || data.code === 401) {
      console.log("Spoonacular API Error:", data.message);
      return res.status(400).json({ error: `Errore Spoonacular: ${data.message}` });
    }

    if (!data.results || data.results.length === 0) {
      console.log("No results with offset", offset, "falling back to 0");
      if (offset > 0) {
        url = url.replace(`offset=${offset}`, `offset=0`);
        response = await fetch(url);
        data = await response.json();
      }
      
      if (!data.results || data.results.length === 0) {
        console.log("Still no results. Trying without pantry ingredient...");
        // Togliamo l'ingrediente della dispensa per ampliare la ricerca
        if (url.includes('&includeIngredients=')) {
          url = url.replace(/&includeIngredients=[^&]*/, '');
          response = await fetch(url);
          data = await response.json();
        }
      }

      if (!data.results || data.results.length === 0) {
        console.log("Still no results. Trying without diet/cuisine filters...");
        // Togliamo dieta e cuisine (ma MANTENIAMO allergie/intolleranze per sicurezza!)
        url = url.replace(/&diet=[^&]*/, '').replace(/&cuisine=[^&]*/, '');
        console.log("Fallback 3 URL:", url.replace(apiKey, 'HIDDEN_API_KEY'));
        response = await fetch(url);
        data = await response.json();
      }

      if (!data.results || data.results.length === 0) {
        console.log("Still no results. AS A LAST RESORT, dropping intolerances/allergies.");
        // Se Spoonacular non ha letteralmente NIENTE, togliamo le intolleranze altrimenti il bottone è rotto.
        // L'utente potrà verificare la ricetta manualmente.
        url = url.replace(/&intolerances=[^&]*/, '').replace(/&excludeIngredients=[^&]*/, '');
        console.log("Fallback 4 URL:", url.replace(apiKey, 'HIDDEN_API_KEY'));
        response = await fetch(url);
        data = await response.json();
      }

      if (!data.results || data.results.length === 0) {
        console.log("Still no results. Returning 400");
        return res.status(400).json({ error: 'Nessuna ricetta alternativa trovata, i filtri di intolleranza sono troppo stringenti.' });
      }
    }

    console.log("Spoonacular returned", data.results.length, "results");

    // Rimuoviamo la ricetta attuale per evitare di scambiarla con se stessa
    const validResults = data.results.filter(r => r.id !== currentEntry.recipe.spoonacularId);
    if (validResults.length === 0) {
      console.log("No valid alternative results after filtering");
      return res.status(400).json({ error: 'Nessuna ricetta alternativa trovata.' });
    }

    const getMacro = (r, name) => r.nutrition?.nutrients?.find(n => n.name === name)?.amount || 0;

    // LA MAGIA: Il nostro server Node.js ordina le ricette mettendo in cima quella con l'errore matematico minore
    validResults.sort((a, b) => {
      const errA = Math.abs(getMacro(a, 'Calories') - targetCals) + Math.abs(getMacro(a, 'Protein') - targetPro) * 4 + Math.abs(getMacro(a, 'Carbohydrates') - targetCarb) * 4 + Math.abs(getMacro(a, 'Fat') - targetFat) * 9;
      const errB = Math.abs(getMacro(b, 'Calories') - targetCals) + Math.abs(getMacro(b, 'Protein') - targetPro) * 4 + Math.abs(getMacro(b, 'Carbohydrates') - targetCarb) * 4 + Math.abs(getMacro(b, 'Fat') - targetFat) * 9;
      return errA - errB;
    });

    const rd = validResults[0]; // Prendiamo la vincitrice assoluta

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
router.patch('/entry/:entryId/toggle', requireAuth, async (req, res) => {
  try {
    const { entryId } = req.params;
    const { isLocked } = req.body;

    const currentEntry = await prisma.mealPlanEntry.findUnique({ where: { id: entryId }, include: { mealPlan: true } });
    if (!currentEntry || currentEntry.mealPlan.userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const updatedEntry = await prisma.mealPlanEntry.update({
      where: { id: entryId },
      data: { isLocked: isLocked }
    });

    res.status(200).json(updatedEntry);
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle status' });
  }
});

// IL MOTORE AI: Generazione del piano tramite LLM (Gemini) con streaming
router.post('/generate-ai', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // SSE headers for streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (type, data) => {
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    sendEvent('status', { message: 'Loading your preferences...' });

    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId } });
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId } });
    const pantry = await prisma.pantryItem.findMany({ where: { userId }, include: { ingredient: true } });

    const pantryNames = pantry.map(p => p.ingredient.name).join(', ');
    const pantryNamesLower = pantry.map(p => p.ingredient.name.toLowerCase());

    const mealSlots = buildMealSlots(goal);
    const dailySnackCount = mealSlots.filter(s => s.mealType === 'SNACK').length;
    const totalWeeklySnacks = dailySnackCount * 7;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      // Removed responseMimeType: "application/json" as it is unstable with generateContentStream
    });

    const prompt = `
      You are an expert nutritionist. Create a practical, highly varied weekly meal plan.
      Daily exact target: ${goal.dailyCalories} kcal, ${goal.dailyProtein}g protein, ${goal.dailyCarbs}g carbs, ${goal.dailyFat}g fat.
      Pantry ingredients to prioritize: [${pantryNames}].
      
      ${dietaryProfile?.allergies?.length ? `STRICT ALLERGIES: ${dietaryProfile.allergies.join(', ')}. YOU MUST NOT USE THESE INGREDIENTS.` : ''}
      ${dietaryProfile?.intolerances?.length ? `STRICT INTOLERANCES: ${dietaryProfile.intolerances.join(', ')}. YOU MUST NOT USE THESE INGREDIENTS.` : ''}

      IMPORTANT: The numbers in the JSON structure below are purely for demonstrating the expected format. Do NOT copy them. You MUST calculate and provide realistic, varied nutritional values for each individual meal based on its actual ingredients. Ensure the sum of the meals for each day matches the exact daily target.

      Return EXCLUSIVELY a JSON object with EXACTLY this structure (use realistic values instead of the dummy 0s):
      {
        "breakfasts": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":0,"unit":"g"}] } ],
        ${dailySnackCount > 0 ? `"snacks": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":0,"unit":"g"}] } ],` : ''}
        "lunches": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":0,"unit":"g"}] } ],
        "dinners": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":0,"unit":"g"}] } ]
      }
      Ensure the arrays have exactly 7, ${totalWeeklySnacks > 0 ? totalWeeklySnacks + ', 7, and 7' : '7, and 7'} items respectively.
    `;

    sendEvent('status', { message: 'AI is generating your meal plan...' });

    const streamingResult = await model.generateContentStream(prompt);

    // FIX: Catch unhandled promise rejections on the aggregate response object to prevent Node from crashing
    streamingResult.response.catch(() => { });

    let fullResponse = '';
    for await (const chunk of streamingResult.stream) {
      fullResponse += chunk.text();
      // Keep the connection alive to prevent Vercel/Render 504 timeouts during long generations
      if (!res.destroyed) {
        res.write(':\\n\\n');
      }
    }

    sendEvent('status', { message: 'Processing AI response...' });

    const cleanJson = fullResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const mealPool = JSON.parse(cleanJson);

    // Assemble weekly plan
    const aiPlan = [];
    let totalSnackCounter = 0;

    for (let i = 0; i < 7; i++) {
      const dailyMeals = [];

      mealSlots.forEach(slot => {
        if (slot.mealType === 'BREAKFAST') {
          const breakfast = mealPool.breakfasts[i] || mealPool.breakfasts[0];
          dailyMeals.push({ type: 'BREAKFAST', ...breakfast });
        } else if (slot.mealType === 'SNACK') {
          const snack = mealPool.snacks[totalSnackCounter % mealPool.snacks.length];
          dailyMeals.push({ type: 'SNACK', ...snack });
          totalSnackCounter++;
        } else if (slot.mealType === 'LUNCH') {
          const lunch = mealPool.lunches[i] || mealPool.lunches[0];
          dailyMeals.push({ type: 'LUNCH', ...lunch });
        } else if (slot.mealType === 'DINNER') {
          const dinner = mealPool.dinners[i] || mealPool.dinners[0];
          dailyMeals.push({ type: 'DINNER', ...dinner });
        }
      });

      aiPlan.push({ dayIndex: i, meals: dailyMeals });
    }

    // Compute usedIngredients/missedIngredients server-side from pantry
    for (const day of aiPlan) {
      for (const meal of day.meals) {
        const used = [];
        const missed = [];
        (meal.ingredients || []).forEach(ing => {
          const name = ing.name.toLowerCase();
          const inPantry = pantryNamesLower.some(p => name.includes(p) || p.includes(name));
          inPantry ? used.push(ing.name) : missed.push(ing.name);
        });
        meal.usedIngredients = used;
        meal.missedIngredients = missed;
      }
    }

    sendEvent('status', { message: 'Building your weekly plan...' });

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    await prisma.mealPlan.deleteMany({ where: { userId, endDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } });

    await prisma.recipe.deleteMany({
      where: {
        mealPlanEntries: { none: {} }
      }
    });

    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 6);

    const mealPlan = await prisma.mealPlan.create({
      data: { userId, startDate: today, endDate, planType: 'WEEKLY' }
    });

    const mealImages = {
      BREAKFAST: '/assets/placeholders/breakfast_placeholder.png',
      LUNCH: '/assets/placeholders/lunch_placeholder.png',
      SNACK: '/assets/placeholders/snack_placeholder.png',
      DINNER: '/assets/placeholders/dinner_placeholder.png'
    };

    sendEvent('status', { message: 'Saving to database...' });

    const recipesData = [];
    const entriesData = [];

    for (const day of aiPlan) {
      let currentDate = new Date(today);
      currentDate.setDate(currentDate.getDate() + day.dayIndex);

      let currentSlotIndex = 0;

      for (const meal of day.meals) {
        const dynamicImage = mealImages[meal.type] || mealImages.LUNCH;
        const recipeId = crypto.randomUUID();

        recipesData.push({
          id: recipeId,
          sourceType: 'AI_GENERATED',
          spoonacularId: Math.floor(Math.random() * 1000000),
          title: meal.title,
          imageUrl: dynamicImage,
          instructions: meal.instructions,
          caloriesPerServing: meal.calories,
          proteinGramsPerServing: meal.protein,
          carbsGramsPerServing: meal.carbs,
          fatGramsPerServing: meal.fat,
          nutritionalInfo: {
            usedIngredients: meal.usedIngredients || [],
            missedIngredients: meal.missedIngredients || [],
            ingredientsList: meal.ingredients || []
          }
        });

        entriesData.push({
          mealPlanId: mealPlan.id,
          day: currentDate,
          mealType: meal.type,
          slotIndex: currentSlotIndex,
          recipeId: recipeId,
          isLocked: false
        });

        currentSlotIndex++;
      }
    }

    // Eseguiamo due sole query massimizzate per inserire tutto, bypassando i limiti di timeout di Accelerate
    await prisma.recipe.createMany({ data: recipesData });
    await prisma.mealPlanEntry.createMany({ data: entriesData });

    sendEvent('complete', { message: 'AI Plan generated perfectly!', mealPlanId: mealPlan.id });
    res.end();
  } catch (error) {
    console.error("AI Generation Error:", error);
    const errorMsg = error.message || 'Failed to generate AI plan';
    if (!res.headersSent) {
      res.status(500).json({ error: errorMsg });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: errorMsg })}\n\n`);
        res.end();
      } catch (e) {
        // Connection already closed
      }
    }
  }
});
export default router;
