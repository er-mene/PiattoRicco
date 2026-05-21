import express from 'express';
import prisma from '../db.js';
import crypto from 'crypto';
import { getApiKey } from '../utils/spoonacular.js';
import { buildMealSlots } from '../utils/plannerUtils.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// ROTTE DEL PLANNER E DELLA CRONOLOGIA PASTI
// Questo file gestisce tutte le operazioni relative alla pianificazione settimanale
// dei pasti, la generazione tramite API (Spoonacular) e tramite Intelligenza
// Artificiale (Gemini), oltre allo storico dei pasti consumati.
// -----------------------------------------------------------------------------

/**
 * GET /history/:userId
 * Recupera lo storico dei pasti consumati dall'utente.
 * Ritorna solo i pasti contrassegnati come consumati (isLocked = true),
 * ordinati cronologicamente dal più recente al più vecchio.
 */
router.get('/history/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const historyEntries = await prisma.mealPlanEntry.findMany({
      where: {
        mealPlan: { userId: userId },
        isLocked: true // Filtra esclusivamente i pasti consumati
      },
      include: { recipe: true },
      orderBy: [
        { day: 'desc' },
        { slotIndex: 'asc' }
      ]
    });

    res.json(historyEntries);
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * GET /:userId
 * Recupera il piano alimentare attivo dell'utente per la settimana corrente.
 * Ricalcola dinamicamente gli ingredienti mancanti/usati in base alla dispensa attuale
 * prima di inviare i dati al frontend.
 */
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

    // Ricalcolo Dinamico degli Ingredienti
    // Ottiene la dispensa aggiornata dell'utente in tempo reale
    const pantry = await prisma.pantryItem.findMany({
      where: { userId }, include: { ingredient: true }
    });
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());

    // Aggiorna le liste di ingredienti 'usati' e 'mancanti' di ogni singola ricetta
    // confrontandoli con lo stato attuale della dispensa.
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
        // Verifica la presenza in dispensa e smista l'ingrediente nella lista corretta
        const isInPantry = pantryNames.some(p => lowerIng.includes(p) || p.includes(lowerIng));
        isInPantry ? newUsed.push(ingName) : newMissed.push(ingName);
      });

      // Sovrascrive l'oggetto in memoria da inviare al client
      recipe.nutritionalInfo.usedIngredients = newUsed;
      recipe.nutritionalInfo.missedIngredients = newMissed;
    });

    res.status(200).json(activePlan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active meal plan' });
  }
});

/**
 * POST /generate
 * Genera un nuovo piano alimentare settimanale utilizzando l'API di Spoonacular.
 * Il processo si divide in due fasi principali:
 * 1. Fetching euristico: Richiede all'API un pool ampio di ricette per colazione, pranzo, cena e snack,
 *    basandosi in modo lasco sulle calorie target e applicando filtri severi per intolleranze/diete.
 * 2. Assegnazione dinamica (Knapsack/Tetris): Combina le ricette estratte minimizzando l'errore
 *    rispetto agli obiettivi di macronutrienti giornalieri dell'utente.
 */
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
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

    // Funzione ausiliaria per richiedere un lotto di ricette a Spoonacular
    const fetchPool = async (type, count, targetCals) => {
      // Finestra calorica ristretta per ottenere ricette vicine al target.
      // Macro constraints aggiuntivi per filtrare ricette in linea con obiettivi nutrizionali.
      const minCals = Math.max(50, targetCals - 200);
      const maxCals = targetCals + 200;
      const minPro = Math.max(2, Math.round(targetCals * 0.10 / 4));
      const maxPro = Math.round(targetCals * 0.50 / 4);
      const minCarb = Math.max(2, Math.round(targetCals * 0.05 / 4));
      const maxCarb = Math.round(targetCals * 0.65 / 4);
      const minFat = Math.max(2, Math.round(targetCals * 0.10 / 9));
      const maxFat = Math.round(targetCals * 0.55 / 9);

      let baseUrl = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=${count}&type=${type}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true&minCalories=${minCals}&maxCalories=${maxCals}&minProtein=${minPro}&maxProtein=${maxPro}&minCarbs=${minCarb}&maxCarbs=${maxCarb}&minFat=${minFat}&maxFat=${maxFat}`;

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

        // Ritorna le ricette filtrate per dispensa se soddisfano la soglia numerica minima
        if (data.results && data.results.length >= (type === 'breakfast' ? 7 : 14)) {
          return data.results;
        }
      }

      // Fallback: se i filtri della dispensa erano troppo restrittivi o restituivano pochi risultati,
      // ignora la dispensa e cerca ricette generiche per garantire la continuità del servizio.
      const res = await fetch(baseUrl);
      const data = await res.json();
      return data.results || [];
    };

    // Estrae i bacini di ricette per i vari tipi di pasto
    const breakfastPool = await fetchPool('breakfast', 15, breakfastTarget.calories);
    const mainPool = await fetchPool('main course', 30, lunchTarget.calories);
    const snackPool = snackCount > 0 ? await fetchPool('snack', snackCount * 7 + 5, snackTarget.calories) : [];

    // Controllo di sicurezza: interrompe la generazione se le API di Spoonacular non restituiscono abbastanza dati
    // (es. limite API raggiunto o errori di rete)
    if (breakfastPool.length < 7 || mainPool.length < 14 || (snackCount > 0 && snackPool.length < snackCount * 7)) {
      return res.status(400).json({ error: 'Spoonacular API is busy or out of quota. Please try again in a few seconds!' });
    }

    const getPantryScore = (recipe) => {
      const allIng = [...(recipe.usedIngredients || []), ...(recipe.missedIngredients || []), ...(recipe.extendedIngredients || [])];
      const uniqueNames = Array.from(new Set(allIng.map(a => a.name.toLowerCase())));
      return uniqueNames.filter(ingName => pantryNames.some(p => ingName.includes(p) || p.includes(ingName))).length;
    };

    // Utility per l'estrazione sicura dei macronutrienti dalla struttura dati di Spoonacular
    const getMacro = (recipe, name) => recipe?.nutrition?.nutrients?.find(n => n.name === name)?.amount || 0;

    // Ordina colazione e snack per errore macro contro il target dello slot (minore = meglio),
    // usando pantryScore come tiebreaker. I pasti principali usano solo pantryScore
    // perché la combinazione ottimale verrà trovata tramite brute-force.
    // Filtra le ricette prive di dati nutrizionali (calorie = 0) per evitare che macro fittizi
    // corrompano i target residui durante l'assegnazione giornaliera
    const withNutrition = (r) => getMacro(r, 'Calories') > 0;

    const sortByPantryAndMacros = (pool, target) => pool
      .filter(withNutrition)
      .map(r => ({
        ...r,
        pantryScore: getPantryScore(r),
        macroError: Math.abs(getMacro(r, 'Calories') - target.calories) +
          Math.abs(getMacro(r, 'Protein') - target.protein) * 4 +
          Math.abs(getMacro(r, 'Carbohydrates') - target.carbs) * 4 +
          Math.abs(getMacro(r, 'Fat') - target.fat) * 9
      }))
      .sort((a, b) => a.macroError - b.macroError || b.pantryScore - a.pantryScore);

    const scoredBreakfast = sortByPantryAndMacros(breakfastPool, breakfastTarget);
    const scoredMain = mainPool.filter(withNutrition).map(r => ({ ...r, pantryScore: getPantryScore(r) })).sort((a, b) => b.pantryScore - a.pantryScore);
    const scoredSnack = snackCount > 0 ? sortByPantryAndMacros(snackPool, snackTarget) : [];

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    // Pulisce eventuali piani futuri esistenti per evitare sovrapposizioni
    await prisma.mealPlan.deleteMany({ where: { userId: userId, endDate: { gte: today } } });

    // Rimuove ricette orfane (non collegate a nessun piano) per ottimizzare lo spazio nel database
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

    let currentDate = new Date(today);
    const days = [0, 1, 2, 3, 4, 5, 6];

    // Algoritmo di Assegnazione Giornaliera
    // Per ogni giorno della settimana, calcola il fabbisogno residuo e vi incastra le ricette ottimali
    for (let i = 0; i < days.length; i++) {

      let remCals = goal.dailyCalories;
      let remPro = goal.dailyProtein;
      let remCarbs = goal.dailyCarbs;
      let remFat = goal.dailyFat;

      let dailyMeals = [];

      // Assegna la colazione
      const b = scoredBreakfast.shift() || scoredBreakfast[0];
      if (b) {
        remCals -= getMacro(b, 'Calories');
        remPro -= getMacro(b, 'Protein');
        remCarbs -= getMacro(b, 'Carbohydrates');
        remFat -= getMacro(b, 'Fat');
        dailyMeals.push({ type: 'BREAKFAST', slotIndex: 10, data: b });
      }

      // Distribuisce eventuali snack nell'arco della giornata
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

      // Ricerca della combinazione ottimale per Pranzo + Cena
      // Confronta le coppie di ricette disponibili e seleziona quella che minimizza 
      // lo scostamento dai macronutrienti target giornalieri
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

          // Calcolo dell'errore (distanza) dai macro target. I macro sono ponderati in base alle calorie per grammo.
          const error = Math.abs(combinedCals - remCals) +
            Math.abs(combinedPro - remPro) * 4 +
            Math.abs(combinedCarbs - remCarbs) * 4 +
            Math.abs(combinedFat - remFat) * 9;

          // Accetta solo combinazioni entro una devianza massima di 100 kcal
          // e con macros che non eccedano il target residuo oltre il 50% (previene coppie con macro sbilanciati)
          if (Math.abs(combinedCals - remCals) <= 100 &&
              combinedPro <= remPro * 1.5 + 15 &&
              combinedCarbs <= remCarbs * 1.5 + 20 &&
              combinedFat <= remFat * 1.5 + 10) {
            if (error < minError) {
              minError = error;
              bestPair = { indexL: x, indexD: y, l: l_cand, d: d_cand };
            }
          }

          // Salva anche la combinazione migliore in assoluto in caso nessuna rientri nel limite di 100 kcal
          if (error < minErrorFallback) {
            minErrorFallback = error;
            bestPairFallback = { indexL: x, indexD: y, l: l_cand, d: d_cand };
          }
        }
      }

      const selectedPair = bestPair || bestPairFallback;

      // Rimuove le ricette selezionate dal pool per evitare ripetizioni
      const maxIndex = Math.max(selectedPair.indexL, selectedPair.indexD);
      const minIndex = Math.min(selectedPair.indexL, selectedPair.indexD);

      scoredMain.splice(maxIndex, 1);
      scoredMain.splice(minIndex, 1);

      dailyMeals.push({ type: 'LUNCH', slotIndex: 30, data: selectedPair.l });
      dailyMeals.push({ type: 'DINNER', slotIndex: 50, data: selectedPair.d });

      // Salvataggio nel database delle ricette selezionate per il giorno corrente
      for (let j = 0; j < dailyMeals.length; j++) {
        const mealData = dailyMeals[j];
        const recipeData = mealData.data;

        let used = [];
        let missed = [];
        const allIng = [...(recipeData.usedIngredients || []), ...(recipeData.missedIngredients || []), ...(recipeData.extendedIngredients || [])];
        const uniqueIng = Array.from(new Set(allIng.map(a => a.name))).map(n => allIng.find(a => a.name === n));

        // Divisione degli ingredienti in usati (presenti in dispensa) o mancanti
        uniqueIng.forEach(ing => {
          const ingName = ing.name.toLowerCase();
          pantryNames.some(p => ingName.includes(p) || p.includes(ingName)) ? used.push(ing.name) : missed.push(ing.name);
        });

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
            caloriesPerServing: Math.round(getMacro(recipeData, 'Calories')),
            proteinGramsPerServing: Math.round(getMacro(recipeData, 'Protein')),
            carbsGramsPerServing: Math.round(getMacro(recipeData, 'Carbohydrates')),
            fatGramsPerServing: Math.round(getMacro(recipeData, 'Fat')),
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

/**
 * PUT /swap/:entryId
 * Gestisce la sostituzione di una ricetta esistente nel piano settimanale.
 * Utilizza algoritmi di fallback progressivi sulle API di Spoonacular per garantire
 * sempre un risultato valido, anche con filtri di intolleranze molto rigidi.
 * Ordina matematicamente i risultati per minimizzare l'errore calorico rispetto ai macronutrienti target.
 */
router.put('/swap/:entryId', requireAuth, async (req, res) => {
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

    // Calcola i macronutrienti target rimanenti per raggiungere l'obiettivo giornaliero
    const targetCals = Math.max(100, goal.dailyCalories - usedCals);
    const targetPro = Math.max(5, goal.dailyProtein - usedPro);
    const targetCarb = Math.max(5, goal.dailyCarbs - usedCarb);
    const targetFat = Math.max(5, goal.dailyFat - usedFat);

    let type = 'main course';
    if (currentEntry.mealType === 'BREAKFAST') type = 'breakfast';
    if (currentEntry.mealType === 'SNACK') type = 'snack';

    // Offset randomico per assicurare varietà nei risultati in caso di swap multipli consecutivi
    const offset = Math.floor(Math.random() * 30); 

    // URL base per l'API di Spoonacular. Vincoli calorici e macro per ottenere ricette vicine al target residuo
    const swapMinCals = Math.max(50, targetCals - 200);
    const swapMaxCals = targetCals + 200;
    const swapMinPro = Math.max(2, Math.round(targetPro * 0.5));
    const swapMaxPro = Math.round(targetPro * 1.5);
    const swapMinCarb = Math.max(2, Math.round(targetCarb * 0.5));
    const swapMaxCarb = Math.round(targetCarb * 1.5);
    const swapMinFat = Math.max(2, Math.round(targetFat * 0.5));
    const swapMaxFat = Math.round(targetFat * 1.5);
    let url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=15&offset=${offset}&type=${type}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true&minCalories=${swapMinCals}&maxCalories=${swapMaxCals}&minProtein=${swapMinPro}&maxProtein=${swapMaxPro}&minCarbs=${swapMinCarb}&maxCarbs=${swapMaxCarb}&minFat=${swapMinFat}&maxFat=${swapMaxFat}`;

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

    // Gestione della Dispensa: Spoonacular utilizza un rigoroso operatore logico AND per 'includeIngredients'.
    // Per evitare zero risultati quando la dispensa è grande, viene estratto casualmente un solo ingrediente 
    // prioritario su cui forzare la ricerca, ampliando così il bacino dei risultati.
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
      if (offset > 0) {
        url = url.replace(`offset=${offset}`, `offset=0`);
        response = await fetch(url);
        data = await response.json();
      }
      
      // Fallback 1: Rimuove il vincolo stringente sulla dispensa
      if (!data.results || data.results.length === 0) {
        if (url.includes('&includeIngredients=')) {
          url = url.replace(/&includeIngredients=[^&]*/, '');
          response = await fetch(url);
          data = await response.json();
        }
      }

      // Fallback 2: Rimuove i filtri su dieta e cucina. Conserva strettamente le allergie/intolleranze.
      if (!data.results || data.results.length === 0) {
        url = url.replace(/&diet=[^&]*/, '').replace(/&cuisine=[^&]*/, '');
        response = await fetch(url);
        data = await response.json();
      }

      // Fallback 3 (Ultima spiaggia): Qualora l'API non restituisca risultati, ignora anche le 
      // intolleranze per evitare il crash irreversibile della funzionalità di swap. 
      // L'utente potrà leggere i dettagli della ricetta per sicurezza.
      if (!data.results || data.results.length === 0) {
        url = url.replace(/&intolerances=[^&]*/, '').replace(/&excludeIngredients=[^&]*/, '');
        response = await fetch(url);
        data = await response.json();
      }

      if (!data.results || data.results.length === 0) {
        console.log("Still no results. Returning 400");
        return res.status(400).json({ error: 'Nessuna ricetta alternativa trovata, i filtri di intolleranza sono troppo stringenti.' });
      }
    }

    console.log("Spoonacular returned", data.results.length, "results");

    // Filtra la ricetta correntemente assegnata e quelle senza dati nutrizionali
    const getMacro = (r, name) => r.nutrition?.nutrients?.find(n => n.name === name)?.amount || 0;
    const validResults = data.results.filter(r => r.id !== currentEntry.recipe.spoonacularId && getMacro(r, 'Calories') > 0);
    if (validResults.length === 0) {
      console.log("No valid alternative results after filtering");
      return res.status(400).json({ error: 'Nessuna ricetta alternativa trovata.' });
    }

    // Algoritmo di Ordinamento Matematico Locale: 
    // Calcola il distacco di ogni potenziale ricetta dai macronutrienti target e porta in testa la più vicina.
    validResults.sort((a, b) => {
      const errA = Math.abs(getMacro(a, 'Calories') - targetCals) + Math.abs(getMacro(a, 'Protein') - targetPro) * 4 + Math.abs(getMacro(a, 'Carbohydrates') - targetCarb) * 4 + Math.abs(getMacro(a, 'Fat') - targetFat) * 9;
      const errB = Math.abs(getMacro(b, 'Calories') - targetCals) + Math.abs(getMacro(b, 'Protein') - targetPro) * 4 + Math.abs(getMacro(b, 'Carbohydrates') - targetCarb) * 4 + Math.abs(getMacro(b, 'Fat') - targetFat) * 9;
      return errA - errB;
    });

    const rd = validResults[0]; // Seleziona il risultato matematicamente più efficiente

    // Verifica la disponibilità degli ingredienti in base alla dispensa corrente
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
          usedIngredients: used,
          missedIngredients: missed,
          extendedIngredients: rd.extendedIngredients
        }
      },
      create: {
        sourceType: 'SPOONACULAR', spoonacularId: rd.id, title: rd.title, imageUrl: rd.image,
        instructions: rd.instructions, readyInMinutes: rd.readyInMinutes || 30, servings: rd.servings || 1,
        caloriesPerServing: Math.round(getMacro(rd, 'Calories')), proteinGramsPerServing: Math.round(getMacro(rd, 'Protein')),
        carbsGramsPerServing: Math.round(getMacro(rd, 'Carbohydrates')), fatGramsPerServing: Math.round(getMacro(rd, 'Fat')),
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

/**
 * PATCH /entry/:entryId/toggle
 * Segna un pasto come consumato o meno (toggle di 'isLocked').
 * Utilizzato per aggiornare lo storico dei pasti.
 */
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

/**
 * POST /generate-ai
 * Genera un piano alimentare tramite Intelligenza Artificiale (LLM Gemini).
 * Crea una dieta creativa, personalizzata ed esplorativa sfruttando il contesto
 * della dispensa dell'utente e trasmettendo il progresso in tempo reale via Server-Sent Events (SSE).
 */
router.post('/generate-ai', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Configurazione Server-Sent Events (SSE) per streaming live dei progressi
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

    // Ignora gli errori pendenti nel chunk stream aggregato per evitare crash di sistema
    streamingResult.response.catch(() => { });

    let fullResponse = '';
    for await (const chunk of streamingResult.stream) {
      fullResponse += chunk.text();
      // Mantiene viva la connessione HTTP per prevenire timeout di routing 
      // (tipici su Vercel/Render) durante l'attesa di LLM lenti.
      if (!res.destroyed) {
        res.write(':\\n\\n');
      }
    }

    sendEvent('status', { message: 'Processing AI response...' });

    const cleanJson = fullResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const mealPool = JSON.parse(cleanJson);

    // Compilazione del piano settimanale strutturato a partire dal JSON parsato
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

      // Calibrazione: se l'AI ha sforato il target calorico (> 50 kcal), scala proporzionalmente
      const dayTotal = dailyMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
      if (dayTotal > goal.dailyCalories + 50) {
        const scale = goal.dailyCalories / dayTotal;
        dailyMeals.forEach(m => {
          m.calories = Math.round((m.calories || 0) * scale);
          m.protein = Math.round((m.protein || 0) * scale);
          m.carbs = Math.round((m.carbs || 0) * scale);
          m.fat = Math.round((m.fat || 0) * scale);
        });
        const finalSum = dailyMeals.reduce((s, m) => s + m.calories, 0);
        const diff = goal.dailyCalories - finalSum;
        if (Math.abs(diff) > 0 && Math.abs(diff) < 10) {
          const largest = dailyMeals.reduce((a, b) => (a.calories > b.calories ? a : b));
          largest.calories += diff;
        }
      }

      aiPlan.push({ dayIndex: i, meals: dailyMeals });
    }

    // Computazione lato server degli ingredienti usati/mancanti confrontati con la dispensa
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
          caloriesPerServing: Math.round(meal.calories),
          proteinGramsPerServing: Math.round(meal.protein),
          carbsGramsPerServing: Math.round(meal.carbs),
          fatGramsPerServing: Math.round(meal.fat),
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

    // Operazioni Massive (Bulk Upsert) sul Database
    // Vengono eseguite due grandi query per bypassare il timeout rigoroso (15 secondi) di Prisma Accelerate
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
        // Nessuna azione richiesta, stream SSE già disconnesso dal client
      }
    }
  }
});
export default router;
