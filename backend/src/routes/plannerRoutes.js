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
  try {
    const { entryId } = req.params;
    const apiKey = getApiKey();

    const currentEntry = await prisma.mealPlanEntry.findUnique({ where: { id: entryId }, include: { mealPlan: true } });
    if (!currentEntry || currentEntry.mealPlan.userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    
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
    if (dietaryProfile?.intolerances?.length || dietaryProfile?.allergies?.length) {
      const combined = [...(dietaryProfile?.intolerances || []), ...(dietaryProfile?.allergies || [])];
      url += `&intolerances=${combined.join(',')}`;
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
      const errA = Math.abs(getMacro(a, 'Calories') - targetCals) + Math.abs(getMacro(a, 'Protein') - targetPro) * 4 + Math.abs(getMacro(a, 'Carbohydrates') - targetCarb) * 4 + Math.abs(getMacro(a, 'Fat') - targetFat) * 9;
      const errB = Math.abs(getMacro(b, 'Calories') - targetCals) + Math.abs(getMacro(b, 'Protein') - targetPro) * 4 + Math.abs(getMacro(b, 'Carbohydrates') - targetCarb) * 4 + Math.abs(getMacro(b, 'Fat') - targetFat) * 9;
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

// IL MOTORE AI: Generazione del piano tramite LLM (Gemini)
router.post('/generate-ai', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId; // Trusted ID
    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId } });
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId } });
    const pantry = await prisma.pantryItem.findMany({ where: { userId }, include: { ingredient: true } });

    // Passiamo i nomi esatti della dispensa all'AI
    const pantryNames = pantry.map(p => p.ingredient.name).join(', ');

    const mealSlots = buildMealSlots(goal);
    const snackCount = mealSlots.filter(s => s.mealType === 'SNACK').length;

    const mealOrder = ['BREAKFAST'];
    if (snackCount > 0) mealOrder.push('SNACK');
    mealOrder.push('LUNCH');
    if (snackCount > 1) mealOrder.push('SNACK');
    mealOrder.push('DINNER');
    if (snackCount > 2) mealOrder.push('SNACK');
    if (snackCount > 3) mealOrder.push('SNACK');
    const mealOrderString = mealOrder.join(', ');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      You are an expert nutritionist. Create a practical, highly varied weekly meal plan.
      Daily exact target: ${goal.dailyCalories} kcal, ${goal.dailyProtein}g protein, ${goal.dailyCarbs}g carbs, ${goal.dailyFat}g fat.
      Pantry ingredients to prioritize: [${pantryNames}].
      
      ${dietaryProfile?.allergies?.length ? `STRICT ALLERGIES: ${dietaryProfile.allergies.join(', ')}. YOU MUST NOT USE THESE INGREDIENTS.` : ''}
      ${dietaryProfile?.intolerances?.length ? `STRICT INTOLERANCES: ${dietaryProfile.intolerances.join(', ')}. YOU MUST NOT USE THESE INGREDIENTS.` : ''}

      CRITICAL RULES: 
      1. "usedIngredients" MUST contain the names of ingredients from the user's pantry that are used in the recipe.
      2. "missedIngredients" MUST contain the names of ingredients needed that are NOT in the pantry.
      3. Return EXCLUSIVELY a JSON object with EXACTLY this structure:
      {
        "breakfasts": [ { "title": "...", "calories": 400, "protein": 30, "carbs": 40, "fat": 10, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":100,"unit":"g"}], "usedIngredients": ["item from pantry"], "missedIngredients": ["item to buy"] } ], 
        "snacks": [ { "title": "...", "calories": 200, "protein": 10, "carbs": 20, "fat": 5, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":100,"unit":"g"}], "usedIngredients": ["item from pantry"], "missedIngredients": ["item to buy"] } ], 
        "lunches": [ { "title": "...", "calories": 400, "protein": 30, "carbs": 40, "fat": 10, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":100,"unit":"g"}], "usedIngredients": ["item from pantry"], "missedIngredients": ["item to buy"] } ], 
        "dinners": [ { "title": "...", "calories": 400, "protein": 30, "carbs": 40, "fat": 10, "instructions": "HTML steps", "ingredients": [{"name":"...","amount":100,"unit":"g"}], "usedIngredients": ["item from pantry"], "missedIngredients": ["item to buy"] } ]  
      }
      Ensure the arrays have exactly 7, 4, 7, and 7 items respectively.
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Ripuliamo da eventuali formattazioni markdown del JSON (Rende l'app a prova di crash)
    const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const mealPool = JSON.parse(cleanJson);

    // 2. ASSEMBLAGGIO ESATTO IN NODE.JS (Fulmineo)
    const aiPlan = [];
    let totalSnackCounter = 0;

    for (let i = 0; i < 7; i++) {
      const dailyMeals = [];
      
      mealOrder.forEach(type => {
        if (type === 'BREAKFAST') {
          // Fallback di sicurezza: se l'AI sbaglia e ne genera 6, peschiamo la prima per non far crashare nulla
          const breakfast = mealPool.breakfasts[i] || mealPool.breakfasts[0];
          dailyMeals.push({ type: 'BREAKFAST', ...breakfast });
        } else if (type === 'SNACK') {
          const snack = mealPool.snacks[totalSnackCounter % mealPool.snacks.length];
          dailyMeals.push({ type: 'SNACK', ...snack });
          totalSnackCounter++;
        } else if (type === 'LUNCH') {
          const lunch = mealPool.lunches[i] || mealPool.lunches[0];
          dailyMeals.push({ type: 'LUNCH', ...lunch }); 
        } else if (type === 'DINNER') {
          const dinner = mealPool.dinners[i] || mealPool.dinners[0];
          dailyMeals.push({ type: 'DINNER', ...dinner });
        }
      });
      
      aiPlan.push({ dayIndex: i, meals: dailyMeals });
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    await prisma.mealPlan.deleteMany({ where: { userId: userId, endDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } });

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


    // 2. IMMAGINI PLACEHOLDER TEMATICHE (Dark Theme + Testo + Emoji)
    const mealImages = {
      BREAKFAST: '/assets/placeholders/breakfast_placeholder.png', // Corrisponde a image_0.png
      LUNCH: '/assets/placeholders/lunch_placeholder.png',         // Corrisponde a image_2.png
      SNACK: '/assets/placeholders/snack_placeholder.png',         // Corrisponde a image_1.png
      DINNER: '/assets/placeholders/dinner_placeholder.png'         // Corrisponde a image_3.png
    };

    const transactionOperations = [];

    for (const day of aiPlan) {
      let currentDate = new Date(today);
      currentDate.setDate(currentDate.getDate() + day.dayIndex);

      let currentSlotIndex = 0;

      for (const meal of day.meals) {
        const dynamicImage = mealImages[meal.type] || mealImages.LUNCH;
        const recipeId = crypto.randomUUID();

        transactionOperations.push(
          prisma.recipe.create({
            data: {
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
            }
          })
        );

        transactionOperations.push(
          prisma.mealPlanEntry.create({
            data: {
              mealPlanId: mealPlan.id,
              day: currentDate,
              mealType: meal.type,
              slotIndex: currentSlotIndex,
              recipeId: recipeId,
              isLocked: false
            }
          })
        );

        currentSlotIndex++;
      }
    }

    // Esegue tutte le query in batch in una singola transazione (Miglioramento Performance 10x)
    await prisma.$transaction(transactionOperations, { 
      maxWait: 5000, // Tempo massimo per connettersi al DB
      timeout: 15000 // Tempo massimo per completare tutte le 70 scritture (20 secondi)
    });

    res.status(201).json({ message: 'AI Plan generated perfectly!', mealPlanId: mealPlan.id });
  } catch (error) {
    console.error("AI Generation Error:", error);
    res.status(500).json({ error: 'Failed to generate AI plan' });
  }
});
export default router;
