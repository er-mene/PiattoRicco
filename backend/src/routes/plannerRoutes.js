import express from 'express';
import prisma from '../db.js';
import crypto from 'crypto';
import { buildMealSlots } from '../utils/plannerUtils.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const plannerGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // Finestra di 1 ora
  max: 5, // Limita ogni IP a 5 richieste all'ora
  message: { error: 'Troppi piani generati. Riprova tra un\'ora.' }
});

const plannerSwapLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Finestra di 15 minuti
  max: 15, // Limita ogni IP a 15 richieste di swap per 15 minuti
  message: { error: 'Troppe sostituzioni di ricette. Riprova più tardi.' }
});

/**
 * GET /history/:userId
 * Recupera lo storico dei pasti consumati dall'utente.
 * Restituisce solo i pasti contrassegnati come mangiati (isLocked = true), ordinati dal più recente.
 */
router.get('/history/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const historyEntries = await prisma.mealPlanEntry.findMany({
      where: {
        mealPlan: { userId: userId },
        isLocked: true // Filtra esplicitamente solo i pasti completati/mangiati
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
 * Recupera il piano alimentare attivo per la settimana in corso.
 * Aggiorna dinamicamente lo stato degli ingredienti (disponibili/mancanti) incrociandoli con l'inventario attuale della dispensa prima di rispondere.
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

    // Recupera la dispensa attuale dell'utente per calcolare in tempo reale gli ingredienti usati o mancanti
    const pantry = await prisma.pantryItem.findMany({
      where: { userId }, include: { ingredient: true }
    });
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());

    // Confronta le ricette con gli oggetti in dispensa per separare gli ingredienti in "used" e "missed"
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
        // Categorizza in base alla sovrapposizione della stringa (match flessibile)
        const isInPantry = pantryNames.some(p => lowerIng.includes(p) || p.includes(lowerIng));
        isInPantry ? newUsed.push(ingName) : newMissed.push(ingName);
      });

      // Sovrascrive dinamicamente le proprietà dell'oggetto in memoria che verrà inviato al client
      recipe.nutritionalInfo.usedIngredients = newUsed;
      recipe.nutritionalInfo.missedIngredients = newMissed;
    });

    res.status(200).json(activePlan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active meal plan' });
  }
});

/**
 * POST /generate-single
 * Genera istantaneamente una ricetta indipendente che soddisfa una specifica frazione del target calorico giornaliero.
 * Questa ricetta NON viene salvata nel database né attaccata al piano settimanale.
 */
router.post('/generate-single', requireAuth, plannerSwapLimiter, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { mealType, isStrictPantryMode } = req.body || {};

    if (!['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'].includes(mealType)) {
      return res.status(400).json({ error: 'Invalid mealType' });
    }

    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId } });
    if (!goal) {
      return res.status(400).json({ error: 'Profile incomplete. Please set your nutritional goals first.' });
    }
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId } });
    const pantry = await prisma.pantryItem.findMany({ where: { userId }, include: { ingredient: true } });

    const pantryNames = pantry.map(p => p.ingredient.name).join(', ');
    const pantryNamesLower = pantry.map(p => p.ingredient.name.toLowerCase());

    // Frazioni fisse di distribuzione calorica giornaliera per tipo di pasto
    const mealFractions = {
      BREAKFAST: 0.25,
      LUNCH: 0.40,
      DINNER: 0.35,
      SNACK: 0.10
    };

    const fraction = mealFractions[mealType] || 0.3;

    const targetCals = Math.max(100, Math.round(goal.dailyCalories * fraction));
    const targetPro = Math.max(5, Math.round(goal.dailyProtein * fraction));
    const targetCarb = Math.max(5, Math.round(goal.dailyCarbs * fraction));
    const targetFat = Math.max(5, Math.round(goal.dailyFat * fraction));

    let mealTypeLabel = 'lunch or dinner main course';
    if (mealType === 'BREAKFAST') mealTypeLabel = 'breakfast';
    if (mealType === 'SNACK') mealTypeLabel = 'snack';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        temperature: 1.0,
      },
    });

    const prompt = `
      You are an expert nutritionist. Generate exactly ONE ${mealTypeLabel} recipe.
      ${isStrictPantryMode ? "CRITICAL RULE: YOU MUST ONLY USE THE INGREDIENTS EXACTLY AS LISTED IN THIS PANTRY: [" + pantryNames + "]. IMPORTANT: You do NOT have to use all the ingredients in the pantry for a single recipe! Select a logical, cohesive subset of the pantry items that go well together to make a normal, appetizing meal. EXCEPTION: You MAY freely use these EXACT basic staples ONLY (salt, pepper, olive oil, water, garlic, onion, common spices) even if not listed. DO NOT add any other ingredients. DO NOT invent or justify new staples (e.g. no cornmeal, no flour, no butter unless explicitly listed). If an ingredient is not in the PANTRY list and is not one of the explicitly allowed staples, YOU ABSOLUTELY MUST NOT USE IT. NO EXCEPTIONS." : "Pantry ingredients to prioritize: [" + pantryNames + "]."}
      
      CRITICAL INSTRUCTION FOR VARIETY: To ensure a completely unique recipe every time, here is a random seed: ${Math.random()}. Please think outside the box and generate a highly creative and different recipe than usual!

      Nutritional targets for this meal:
      - Calories: ${targetCals} kcal (MUST be within ±30 kcal)
      - Protein: ${targetPro}g (MUST be within ±5g)
      - Carbs: ${targetCarb}g (MUST be within ±5g)
      - Fat: ${targetFat}g (MUST be within ±5g)

      ${dietaryProfile?.excludedIngredients?.length ? `EXCLUDED INGREDIENTS (strict allergies, intolerances and dislikes): ${dietaryProfile.excludedIngredients.join(', ')}. YOU MUST NOT USE ANY OF THESE.` : ''}
      ${dietaryProfile?.diets?.length ? `DIETS TO FOLLOW: ${dietaryProfile.diets.join(', ')}.` : ''}
      ${dietaryProfile?.preferredCuisines?.length ? `PREFERRED CUISINES: ${dietaryProfile.preferredCuisines.join(', ')}.` : ''}

      Return ONLY a JSON object with this exact structure (use real values, NO conversational text):
      {
        "title": "Recipe Name",
        "calories": ${targetCals},
        "protein": ${targetPro},
        "carbs": ${targetCarb},
        "fat": ${targetFat},
        "instructions": "<ol><li>Step 1</li><li>Step 2</li></ol>",
        "ingredients": [{"name": "ingredient", "amount": 100, "unit": "g"}],
        "tags": ["Tag1", "Tag2"]
      }
      The "tags" field must contain an array of 2-4 descriptive, short string labels in English representing the cuisine culture and dietary style (e.g. ["Italian", "Vegan", "High-Protein", "Mexican", "Vegetarian", "Gluten-Free", "Low-Carb", etc.]). CRITICAL RULE: DO NOT include redundant meal-type tags (such as "Breakfast", "Lunch", "Dinner", "Snack", or generic labels like "Meal") in this array.
      Return ONLY the valid JSON object, properly escaping quotes.
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let recipeData;
    try {
      recipeData = JSON.parse(cleanJson);
    } catch (e) {
      console.error("JSON parse error:", text);
      return res.status(500).json({ error: 'AI returned invalid data format' });
    }

    // Verifica lo stato degli ingredienti rispetto all'inventario attuale della dispensa
    let used = [], missed = [];
    (recipeData.ingredients || []).forEach(ing => {
      const ingName = ing.name.toLowerCase();
      pantryNamesLower.some(p => ingName.includes(p) || p.includes(ingName)) ? used.push(ing.name) : missed.push(ing.name);
    });

    const mealImages = {
      BREAKFAST: '/assets/placeholders/breakfast_placeholder.png',
      LUNCH: '/assets/placeholders/lunch_placeholder.png',
      SNACK: '/assets/placeholders/snack_placeholder.png',
      DINNER: '/assets/placeholders/dinner_placeholder.png'
    };

    const finalRecipe = {
      id: crypto.randomUUID(), // UUID temporaneo necessario per il rendering lato client
      title: recipeData.title,
      instructions: recipeData.instructions,
      readyInMinutes: 30,
      servings: 1,
      caloriesPerServing: Math.round(recipeData.calories),
      proteinGramsPerServing: Math.round(recipeData.protein),
      carbsGramsPerServing: Math.round(recipeData.carbs),
      fatGramsPerServing: Math.round(recipeData.fat),
      nutritionalInfo: {
        usedIngredients: used,
        missedIngredients: missed,
        ingredientsList: recipeData.ingredients || [],
        tags: recipeData.tags || []
      }
    };

    res.status(200).json({ recipe: finalRecipe });

  } catch (error) {
    console.error("Quick Recipe Error:", error);
    res.status(500).json({ error: 'Failed to generate single recipe' });
  }
});

/**
 * POST /generate
 * Genera un piano alimentare completo di 7 giorni su misura per il profilo nutrizionale e la dispensa dell'utente.
 * Invia in streaming in tempo reale le fasi della generazione al frontend tramite Server-Sent Events (SSE).
 */
router.post('/generate', requireAuth, plannerGenerateLimiter, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { isStrictPantryMode } = req.body || {};

    // Configura gli header per i Server-Sent Events (SSE) per permettere lo streaming in tempo reale del progresso
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
    if (!goal) {
      sendEvent('error', { message: 'Profile incomplete. Please set your nutritional goals first.' });
      res.end();
      return;
    }
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId } });
    const pantry = await prisma.pantryItem.findMany({ where: { userId }, include: { ingredient: true } });

    const pantryNames = pantry.map(p => p.ingredient.name).join(', ');
    const pantryNamesLower = pantry.map(p => p.ingredient.name.toLowerCase());

    const mealSlots = buildMealSlots(goal);
    const dailySnackCount = mealSlots.filter(s => s.mealType === 'SNACK').length;
    const totalWeeklySnacks = dailySnackCount * 7;

    const breakfastSlot = mealSlots.find(s => s.mealType === 'BREAKFAST');
    const lunchSlot = mealSlots.find(s => s.mealType === 'LUNCH');
    const dinnerSlot = mealSlots.find(s => s.mealType === 'DINNER');
    const snackSlot = mealSlots.find(s => s.mealType === 'SNACK');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
    });

    const prompt = `
      You are an expert nutritionist. Create a practical${isStrictPantryMode ? '' : ', highly varied'} weekly meal plan.
      Daily exact target: ${goal.dailyCalories} kcal, ${goal.dailyProtein}g protein, ${goal.dailyCarbs}g carbs, ${goal.dailyFat}g fat.
      ${isStrictPantryMode ? `CRITICAL RULE: YOU MUST ONLY USE THE INGREDIENTS EXACTLY AS LISTED IN THIS PANTRY: [${pantryNames}]. 
      IMPORTANT: You do NOT have to use all the ingredients in the pantry for a single recipe! For each recipe, select a logical, cohesive subset of the pantry items that go well together.
      EXCEPTION: You MAY freely use these EXACT basic staples ONLY (salt, pepper, olive oil, water, garlic, onion, common spices) even if not listed. DO NOT invent or justify new staples (e.g. no cornmeal, no flour, no butter unless explicitly listed). If an ingredient is not in the PANTRY list and is not one of the explicitly allowed staples, YOU ABSOLUTELY MUST NOT USE IT. NO EXCEPTIONS.
      Try your best to generate as many different recipes as possible using only these ingredients. You MUST still rigorously respect the daily calorie and macro targets. If and ONLY if you absolutely cannot create enough variety, it is acceptable to repeat recipes. The priority is to hit macros using ONLY pantry ingredients and staples.` : `Pantry ingredients: [${pantryNames}]. CRITICAL INSTRUCTION: You MUST heavily build your recipes around these pantry ingredients first! Start from what is available in the pantry, and then add ANY other ingredients needed to make the meals complex, tasty, and highly varied.`}
      
      ${dietaryProfile?.excludedIngredients?.length ? `EXCLUDED INGREDIENTS (strict allergies, intolerances and dislikes): ${dietaryProfile.excludedIngredients.join(', ')}. YOU MUST NOT USE ANY OF THESE IN ANY MEAL.` : ''}
      ${dietaryProfile?.diets?.length ? `DIETS TO FOLLOW: ${dietaryProfile.diets.join(', ')}.` : ''}
      ${dietaryProfile?.preferredCuisines?.length ? `PREFERRED CUISINES: ${dietaryProfile.preferredCuisines.join(', ')}.` : ''}

      IMPORTANT: The numbers in the JSON structure below are purely for demonstrating the expected format. Do NOT copy them. Instead, YOU MUST calculate and provide realistic, TRUE nutritional values based on the ACTUAL ingredients of each specific recipe. The recipes should aim for approximately (±15% variance allowed to ensure variety and realism) these per-meal targets:
      - BREAKFAST target: ${breakfastSlot.targets.calories} kcal, ${breakfastSlot.targets.protein}g pro, ${breakfastSlot.targets.carbs}g carb, ${breakfastSlot.targets.fat}g fat.
      - LUNCH target: ${lunchSlot.targets.calories} kcal, ${lunchSlot.targets.protein}g pro, ${lunchSlot.targets.carbs}g carb, ${lunchSlot.targets.fat}g fat.
      - DINNER target: ${dinnerSlot.targets.calories} kcal, ${dinnerSlot.targets.protein}g pro, ${dinnerSlot.targets.carbs}g carb, ${dinnerSlot.targets.fat}g fat.
      ${snackSlot ? `- SNACK target (per snack): ${snackSlot.targets.calories} kcal, ${snackSlot.targets.protein}g pro, ${snackSlot.targets.carbs}g carb, ${snackSlot.targets.fat}g fat.` : ''}

      Return EXCLUSIVELY a JSON object with EXACTLY this structure (use realistic values instead of the dummy 0s):
      {
        "breakfasts": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "<ol><li>...</li></ol>", "ingredients": [{"name":"...","amount":0,"unit":"g"}], "tags": ["Tag1", "Tag2"] } ],
        ${dailySnackCount > 0 ? `"snacks": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "<ol><li>...</li></ol>", "ingredients": [{"name":"...","amount":0,"unit":"g"}], "tags": ["Tag1", "Tag2"] } ],` : ''}
        "lunches": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "<ol><li>...</li></ol>", "ingredients": [{"name":"...","amount":0,"unit":"g"}], "tags": ["Tag1", "Tag2"] } ],
        "dinners": [ { "title": "...", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "instructions": "<ol><li>...</li></ol>", "ingredients": [{"name":"...","amount":0,"unit":"g"}], "tags": ["Tag1", "Tag2"] } ]
      }
      Each recipe in the lists must include a "tags" field containing an array of 2-4 descriptive, short string labels in English representing the cuisine culture and dietary style (e.g. ["Italian", "Vegan", "High-Protein", "Mexican", "Vegetarian", "Gluten-Free", "Low-Carb", etc.]). CRITICAL RULE: DO NOT include redundant meal-type tags (such as "Breakfast", "Lunch", "Dinner", "Snack", or generic labels like "Meal") in this array.
      Ensure the arrays have exactly 7, ${totalWeeklySnacks > 0 ? totalWeeklySnacks + ', 7, and 7' : '7, and 7'} items respectively.

      RECIPE INSTRUCTIONS FORMATTING RULES:
      - The "instructions" field for each recipe MUST be a string containing a clean HTML ordered list (<ol> with <li> tags for each step).
      - Make the steps clear, descriptive, and structured, using HTML <strong> tags to highlight key ingredients, temperatures, times, or essential techniques (e.g. "<strong>medium heat</strong>", "<strong>5 minutes</strong>", "<strong>olive oil</strong>").
      - Keep instructions concise, token-efficient, and direct to limit Gemini API token consumption. Avoid unnecessary fluff, long conversational preambles, or forcing a high minimum number of steps. Focus on brief but rich, actionable steps.
      - Ensure all HTML tags are correctly opened and closed.

      CRITICAL JSON FORMATTING RULES:
      1. ABSOLUTELY NO CONVERSATIONAL TEXT, NO INTRODUCTIONS.
      2. RETURN EXACTLY AND ONLY THE RAW VALID JSON OBJECT.
      3. MUST properly escape ALL inner double quotes within strings (e.g., use \\" instead of "). Prefer single quotes inside instructions or titles to avoid breaking the JSON.
    `;

    sendEvent('status', { message: 'AI is generating your meal plan...' });

    const streamingResult = await model.generateContentStream(prompt);

    // Gestisce silenziosamente eventuali errori nel flusso di generazione in background per evitare il crash del server
    streamingResult.response.catch(() => { });

    let fullResponse = '';
    for await (const chunk of streamingResult.stream) {
      fullResponse += chunk.text();
      // Mantiene viva la connessione (keep-alive) per prevenire timeout dal routing o dall'API gateway durante risposte lente
      if (!res.destroyed) {
        res.write(':\\\\n\\\\n');
      }
    }

    sendEvent('status', { message: 'Processing AI response...' });

    const cleanJson = fullResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("AI did not return a valid JSON object.");
    }
    const mealPool = JSON.parse(jsonMatch[0]);

    // Estrae e formatta il JSON aggregato per costruire il piano settimanale strutturato
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

      // Calibrazione: Scala proporzionalmente calorie e macro se l'AI si è discostata leggermente dal target giornaliero
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

    // Calcola l'intersezione degli ingredienti usati/mancanti sul server prima della scrittura nel DB
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

    const activePlans = await prisma.mealPlan.findMany({
      where: { userId, endDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      include: { entries: true }
    });

    const mealImages = {
      BREAKFAST: '/assets/placeholders/breakfast_placeholder.png',
      LUNCH: '/assets/placeholders/lunch_placeholder.png',
      SNACK: '/assets/placeholders/snack_placeholder.png',
      DINNER: '/assets/placeholders/dinner_placeholder.png'
    };

    // Avvolge la pulizia del DB e l'inserimento del piano in una transazione Prisma interattiva per garantire l'atomicità
    const mealPlan = await prisma.$transaction(async (tx) => {
      // 1. Contrassegna i piani alimentari attivi come scaduti (terminati ieri)
      for (const plan of activePlans) {
        const hasLocked = plan.entries.some(e => e.isLocked);
        if (hasLocked) {
          const yesterday = new Date(today);
          yesterday.setDate(today.getDate() - 1);

          await tx.mealPlan.update({
            where: { id: plan.id },
            data: { endDate: yesterday }
          });

          await tx.mealPlanEntry.deleteMany({
            where: { mealPlanId: plan.id, isLocked: false }
          });
        } else {
          await tx.mealPlan.delete({ where: { id: plan.id } });
        }
      }

      // 2. Garbage collection: elimina le ricette orfane che non sono più referenziate da nessun piano alimentare
      await tx.recipe.deleteMany({
        where: {
          mealPlanEntries: { none: {} }
        }
      });

      // 3. Crea il nuovo contenitore (record) per il piano alimentare di 7 giorni
      const endDate = new Date(today);
      endDate.setDate(today.getDate() + 6);

      const newPlan = await tx.mealPlan.create({
        data: { userId, startDate: today, endDate }
      });

      // 4. Trasforma le ricette del modello AI in entità relazionali per il database
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
            title: meal.title,
            instructions: meal.instructions,
            caloriesPerServing: Math.round(meal.calories),
            proteinGramsPerServing: Math.round(meal.protein),
            carbsGramsPerServing: Math.round(meal.carbs),
            fatGramsPerServing: Math.round(meal.fat),
            nutritionalInfo: {
              usedIngredients: meal.usedIngredients || [],
              missedIngredients: meal.missedIngredients || [],
              ingredientsList: meal.ingredients || [],
              tags: meal.tags || []
            }
          });

          entriesData.push({
            mealPlanId: newPlan.id,
            day: currentDate,
            mealType: meal.type,
            slotIndex: currentSlotIndex,
            recipeId: recipeId,
            isLocked: false
          });

          currentSlotIndex++;
        }
      }

      // 5. Inserimento massivo (bulk insert) delle ricette e dei relativi slot di associazione
      await tx.recipe.createMany({ data: recipesData });
      await tx.mealPlanEntry.createMany({ data: entriesData });

      return newPlan;
    });

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
        // Il client SSE ha già chiuso la connessione; nessuna azione richiesta
      }
    }
  }
});

/**
 * PUT /swap/:entryId
 * Sostituisce uno specifico pasto programmato con una nuova ricetta generata dall'AI (Gemini).
 * Personalizza la sostituzione per centrare esattamente i target calorici e macro rimanenti per quella specifica giornata.
 */
router.put('/swap/:entryId', requireAuth, plannerSwapLimiter, async (req, res) => {
  try {
    const { entryId } = req.params;

    const currentEntry = await prisma.mealPlanEntry.findUnique({ where: { id: entryId }, include: { mealPlan: true, recipe: true } });
    if (!currentEntry || currentEntry.mealPlan.userId !== req.user.userId) {
      console.log("Error: Forbidden or Entry not found");
      return res.status(403).json({ error: 'Forbidden' });
    }


    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId: currentEntry.mealPlan.userId } });
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId: currentEntry.mealPlan.userId } });

    const pantry = await prisma.pantryItem.findMany({ where: { userId: currentEntry.mealPlan.userId }, include: { ingredient: true } });
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());

    const dayEntries = await prisma.mealPlanEntry.findMany({
      where: { mealPlanId: currentEntry.mealPlanId, day: currentEntry.day, id: { not: entryId } }, include: { recipe: true }
    });

    const usedCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
    const usedPro = dayEntries.reduce((sum, e) => sum + (e.recipe.proteinGramsPerServing || 0), 0);
    const usedCarb = dayEntries.reduce((sum, e) => sum + (e.recipe.carbsGramsPerServing || 0), 0);
    const usedFat = dayEntries.reduce((sum, e) => sum + (e.recipe.fatGramsPerServing || 0), 0);

    // Calcola gli obiettivi calorici e macronutrizionali rimanenti per la giornata
    const targetCals = Math.max(100, goal.dailyCalories - usedCals);
    const targetPro = Math.max(5, goal.dailyProtein - usedPro);
    const targetCarb = Math.max(5, goal.dailyCarbs - usedCarb);
    const targetFat = Math.max(5, goal.dailyFat - usedFat);

    let mealTypeLabel = 'lunch or dinner main course';
    if (currentEntry.mealType === 'BREAKFAST') mealTypeLabel = 'breakfast';
    if (currentEntry.mealType === 'SNACK') mealTypeLabel = 'snack';

    const pantryList = pantry.map(p => p.ingredient.name).join(', ');

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        temperature: 1.0, // Alta temperatura per massimizzare la varietà e creatività nelle ricette sostituite
      },
    });

    const prompt = `You are an expert nutritionist. Generate exactly ONE ${mealTypeLabel} recipe.
It MUST NOT be "${currentEntry.recipe.title}" or similar to it. Create something completely different.

Nutritional targets for this meal:
- Calories: ${targetCals} kcal (MUST be within ±50 kcal)
- Protein: ${targetPro}g (MUST be within ±10g)
- Carbs: ${targetCarb}g (MUST be within ±15g)
- Fat: ${targetFat}g (MUST be within ±8g)

${pantryList ? `Pantry ingredients to prioritize: [${pantryList}].` : ''}
${dietaryProfile?.excludedIngredients?.length ? `EXCLUDED INGREDIENTS (strict allergies, intolerances and dislikes): ${dietaryProfile.excludedIngredients.join(', ')}. YOU MUST NOT USE ANY OF THESE.` : ''}
${dietaryProfile?.diets?.length ? `DIETS TO FOLLOW: ${dietaryProfile.diets.join(', ')}.` : ''}
${dietaryProfile?.preferredCuisines?.length ? `PREFERRED CUISINES: ${dietaryProfile.preferredCuisines.join(', ')}.` : ''}

Return ONLY a JSON object with this exact structure:
{
  "title": "Recipe Name",
  "calories": ${targetCals},
  "protein": ${targetPro},
  "carbs": ${targetCarb},
  "fat": ${targetFat},
  "instructions": "<ol><li>Step 1</li><li>Step 2</li></ol>",
  "ingredients": [{"name": "ingredient", "amount": 100, "unit": "g"}],
  "tags": ["Tag1", "Tag2"]
}
The "tags" field must contain an array of 2-4 descriptive, short string labels in English representing the cuisine culture and dietary style (e.g. ["Italian", "Vegan", "High-Protein", "Mexican", "Vegetarian", "Gluten-Free", "Low-Carb", etc.]). CRITICAL RULE: DO NOT include redundant meal-type tags (such as "Breakfast", "Lunch", "Dinner", "Snack", or generic labels like "Meal") in this array.
Return ONLY the JSON object, no other text.`;

    console.log("Asking Gemini for swap recipe, meal type:", mealTypeLabel);

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const recipeData = JSON.parse(cleanJson);

    // Verifica lo stato degli ingredienti confrontandoli con l'inventario attuale della dispensa
    let used = [], missed = [];
    (recipeData.ingredients || []).forEach(ing => {
      const ingName = ing.name.toLowerCase();
      pantryNames.some(p => ingName.includes(p) || p.includes(ingName)) ? used.push(ing.name) : missed.push(ing.name);
    });

    const mealImages = {
      BREAKFAST: '/assets/placeholders/breakfast_placeholder.png',
      LUNCH: '/assets/placeholders/lunch_placeholder.png',
      SNACK: '/assets/placeholders/snack_placeholder.png',
      DINNER: '/assets/placeholders/dinner_placeholder.png'
    };

    // Esegue lo swap (sostituzione) atomicamente all'interno di una transazione del database
    const updatedEntry = await prisma.$transaction(async (tx) => {
      const newRecipe = await tx.recipe.create({
        data: {
          title: recipeData.title,
          instructions: recipeData.instructions,
          readyInMinutes: 30,
          servings: 1,
          caloriesPerServing: Math.round(recipeData.calories),
          proteinGramsPerServing: Math.round(recipeData.protein),
          carbsGramsPerServing: Math.round(recipeData.carbs),
          fatGramsPerServing: Math.round(recipeData.fat),
          nutritionalInfo: {
            usedIngredients: used,
            missedIngredients: missed,
            ingredientsList: recipeData.ingredients || [],
            tags: recipeData.tags || []
          }
        }
      });

      return await tx.mealPlanEntry.update({
        where: { id: entryId },
        data: { recipeId: newRecipe.id, isLocked: false },
        include: { recipe: true }
      });
    });

    res.status(200).json(updatedEntry);
  } catch (error) {
    console.error("Swap Error:", error);
    res.status(500).json({ error: 'Swap failed' });
  }
});

/**
 * PATCH /entry/:entryId/toggle
 * Attiva o disattiva lo stato di blocco di un pasto (contrassegnandolo come consumato/completato).
 * Questa azione aggiorna di conseguenza lo storico dei pasti dell'utente.
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

export default router;
