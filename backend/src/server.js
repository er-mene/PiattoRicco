import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

const isAccelerateUrl =
  databaseUrl.startsWith('prisma://') || databaseUrl.startsWith('prisma+postgres://');

const prisma = isAccelerateUrl
  ? new PrismaClient({ accelerateUrl: databaseUrl })
  : new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com';
const SNACK_THRESHOLD = 2000;
const SNACK_INTERVAL = 500;
const DEFAULT_RECIPES_PER_SLOT = 10;
const MEAL_BASE_SHARES = {
  BREAKFAST: 0.25,
  LUNCH: 0.4,
  DINNER: 0.35,
};
const MAIN_MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'];

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

function getApiKey() {
  const apiKey = process.env.SPOONACULAR_API_KEY;

  if (!apiKey) {
    throw new Error('SPOONACULAR_API_KEY is not configured');
  }

  return apiKey;
}

async function spoonacularGet(path, params = {}) {
  const url = new URL(`${SPOONACULAR_BASE_URL}${path}`);
  const apiKey = getApiKey();

  for (const [key, value] of Object.entries({ ...params, apiKey })) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    url.searchParams.append(key, String(value));
  }

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Spoonacular ${response.status}: ${errorText}`);
  }

  return response.json();
}

function parseDateInput(rawDate) {
  if (!rawDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  if (typeof rawDate === 'string') {
    const dateOnlyMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  const parsedDate = new Date(rawDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  parsedDate.setHours(0, 0, 0, 0);
  return parsedDate;
}

function shiftDate(baseDate, dayOffset) {
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + dayOffset);
  return nextDate;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function nutrientAmount(nutrition, nutrientName) {
  return (
    nutrition?.nutrients?.find((nutrient) => nutrient.name === nutrientName)?.amount ?? 0
  );
}

function buildMacroRange(target, tolerancePct) {
  const tolerance = target * (tolerancePct / 100);
  return {
    min: Math.max(0, Math.round(target - tolerance)),
    max: Math.max(0, Math.round(target + tolerance)),
  };
}

function buildMealSlots(nutritionalGoal) {
  const snackCount =
    nutritionalGoal.dailyCalories > SNACK_THRESHOLD
      ? Math.floor((nutritionalGoal.dailyCalories - SNACK_THRESHOLD) / SNACK_INTERVAL) + 1
      : 0;

  const snackShare = snackCount > 0 ? 0.1 : 0;
  const mainMealMultiplier = 1 - snackShare;
  const mealSlots = MAIN_MEAL_TYPES.map((mealType) => ({
    label: mealType,
    mealType,
    slotIndex: 0,
    spoonacularType: mealType === 'BREAKFAST' ? 'breakfast' : 'main course',
    shares: {
      calories: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
      protein: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
      carbs: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
      fat: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
    },
  }));

  if (snackCount > 0) {
    const perSnackShare = snackShare / snackCount;

    for (let index = 0; index < snackCount; index += 1) {
      mealSlots.push({
        label: `SNACK_${index + 1}`,
        mealType: 'SNACK',
        slotIndex: index,
        spoonacularType: 'snack',
        shares: {
          calories: perSnackShare,
          protein: perSnackShare,
          carbs: perSnackShare,
          fat: perSnackShare,
        },
      });
    }
  }

  return mealSlots.map((slot) => ({
    ...slot,
    targets: {
      calories: Math.round(nutritionalGoal.dailyCalories * slot.shares.calories),
      protein: Math.round(nutritionalGoal.dailyProtein * slot.shares.protein),
      carbs: Math.round(nutritionalGoal.dailyCarbs * slot.shares.carbs),
      fat: Math.round(nutritionalGoal.dailyFat * slot.shares.fat),
    },
  }));
}

function buildPantryContext(pantryItems) {
  const ingredientNames = [];
  const seen = new Set();
  const priorityMap = new Map();
  const now = new Date();

  pantryItems.forEach((item, index) => {
    const name = item.ingredient?.name;

    if (!name) {
      return;
    }

    const normalizedName = normalizeText(name);

    if (!seen.has(normalizedName)) {
      seen.add(normalizedName);
      ingredientNames.push(name);
    }

    let freshnessWeight = pantryItems.length - index;

    if (item.expirationDate) {
      const expiresAt = new Date(item.expirationDate);
      const daysUntilExpiration = Math.floor(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      freshnessWeight += Math.max(0, 14 - daysUntilExpiration);
    }

    priorityMap.set(
      normalizedName,
      Math.max(priorityMap.get(normalizedName) ?? 0, freshnessWeight),
    );
  });

  return { ingredientNames, priorityMap };
}

function buildPlannerParams(
  slot,
  nutritionalGoal,
  dietaryProfile,
  pantryContext,
  usePantryOnly,
  options = {},
) {
  const {
    calorieToleranceMultiplier = 1,
    macroToleranceMultiplier = 1,
    includeMacroFilters = true,
  } = options;
  const calorieRange = buildMacroRange(
    slot.targets.calories,
    nutritionalGoal.calorieTolerancePct * calorieToleranceMultiplier,
  );
  const macroTolerancePct = nutritionalGoal.macroTolerancePct * macroToleranceMultiplier;
  const proteinRange = buildMacroRange(slot.targets.protein, macroTolerancePct);
  const carbsRange = buildMacroRange(slot.targets.carbs, macroTolerancePct);
  const fatRange = buildMacroRange(slot.targets.fat, macroTolerancePct);

  const params = {
    number: DEFAULT_RECIPES_PER_SLOT,
    type: slot.spoonacularType,
    instructionsRequired: true,
    addRecipeInformation: true,
    addRecipeNutrition: true,
  };

  if (includeMacroFilters) {
    params.minCalories = calorieRange.min;
    params.maxCalories = calorieRange.max;
    params.minProtein = proteinRange.min;
    params.maxProtein = proteinRange.max;
    params.minCarbs = carbsRange.min;
    params.maxCarbs = carbsRange.max;
    params.minFat = fatRange.min;
    params.maxFat = fatRange.max;
  }

  if (dietaryProfile?.diets?.length) {
    params.diet = dietaryProfile.diets.join(',');
  }

  if (dietaryProfile?.intolerances?.length) {
    params.intolerances = dietaryProfile.intolerances.join(',');
  }

  if (dietaryProfile?.excludedIngredients?.length) {
    params.excludeIngredients = dietaryProfile.excludedIngredients.join(',');
  }

  if (dietaryProfile?.preferredCuisines?.length) {
    params.cuisine = dietaryProfile.preferredCuisines.join(',');
  }

  if (usePantryOnly && pantryContext.ingredientNames.length > 0) {
    params.includeIngredients = pantryContext.ingredientNames.join(',');
    params.fillIngredients = true;
    params.ignorePantry = false;
    params.sort = 'max-used-ingredients';
    params.sortDirection = 'desc';
  }

  return params;
}

function buildPlannerAttempts(slot, nutritionalGoal, dietaryProfile, pantryContext, usePantryOnly) {
  return [
    buildPlannerParams(slot, nutritionalGoal, dietaryProfile, pantryContext, usePantryOnly),
    buildPlannerParams(slot, nutritionalGoal, dietaryProfile, pantryContext, usePantryOnly, {
      calorieToleranceMultiplier: 1.75,
      macroToleranceMultiplier: 2,
    }),
    buildPlannerParams(slot, nutritionalGoal, dietaryProfile, pantryContext, usePantryOnly, {
      includeMacroFilters: false,
    }),
  ];
}

function scoreRecipe(recipe, slotTargets, pantryContext, usePantryOnly) {
  const calorieScore = Math.abs(nutrientAmount(recipe.nutrition, 'Calories') - slotTargets.calories);
  const proteinScore = Math.abs(nutrientAmount(recipe.nutrition, 'Protein') - slotTargets.protein);
  const carbsScore = Math.abs(
    nutrientAmount(recipe.nutrition, 'Carbohydrates') - slotTargets.carbs,
  );
  const fatScore = Math.abs(nutrientAmount(recipe.nutrition, 'Fat') - slotTargets.fat);

  let totalScore = calorieScore + proteinScore * 0.3 + carbsScore * 0.3 + fatScore * 0.3;

  if (usePantryOnly) {
    const pantryMatchScore = (recipe.extendedIngredients ?? []).reduce((score, ingredient) => {
      const ingredientName = normalizeText(ingredient.name || ingredient.original || '');
      return score + (pantryContext.priorityMap.get(ingredientName) ?? 0);
    }, 0);

    totalScore -= pantryMatchScore * 5;
  }

  return totalScore;
}

function buildRecipeRecord(recipe) {
  return {
    spoonacularId: recipe.id,
    sourceType: 'SPOONACULAR',
    title: recipe.title,
    summary: recipe.summary ?? null,
    instructions: recipe.analyzedInstructions?.length
      ? recipe.analyzedInstructions
      : recipe.instructions ?? null,
    imageUrl: recipe.image ?? null,
    sourceUrl: recipe.sourceUrl ?? recipe.spoonacularSourceUrl ?? null,
    readyInMinutes: recipe.readyInMinutes ?? null,
    servings: recipe.servings ?? null,
    caloriesPerServing: nutrientAmount(recipe.nutrition, 'Calories'),
    proteinGramsPerServing: nutrientAmount(recipe.nutrition, 'Protein'),
    carbsGramsPerServing: nutrientAmount(recipe.nutrition, 'Carbohydrates'),
    fatGramsPerServing: nutrientAmount(recipe.nutrition, 'Fat'),
    fiberGramsPerServing: nutrientAmount(recipe.nutrition, 'Fiber'),
    sugarGramsPerServing: nutrientAmount(recipe.nutrition, 'Sugar'),
    sodiumMgPerServing: nutrientAmount(recipe.nutrition, 'Sodium'),
    nutritionalInfo: recipe.nutrition ?? null,
    tags: Array.isArray(recipe.occasions) ? recipe.occasions : [],
    diets: Array.isArray(recipe.diets) ? recipe.diets : [],
    cuisines: Array.isArray(recipe.cuisines) ? recipe.cuisines : [],
    dishTypes: Array.isArray(recipe.dishTypes) ? recipe.dishTypes : [],
  };
}

function selectRecipesForWeek(recipes) {
  return Array.from({ length: 7 }, (_, dayIndex) => recipes[dayIndex % recipes.length]);
}

app.get('/api/recipes', async (req, res) => {
  const { ingredients } = req.query;

  if (!ingredients) {
    return res.status(400).json({ error: 'Please provide some ingredients' });
  }

  try {
    const recipes = await spoonacularGet('/recipes/findByIngredients', {
      ingredients,
      number: 10,
      ranking: 2,
    });

    res.json(recipes);
  } catch (error) {
    console.error('Error fetching recipes:', error.message);
    res.status(500).json({ error: 'Failed to fetch recipes from Spoonacular' });
  }
});

app.post('/api/weekly-plan', async (req, res) => {
  const { userId, startDate, usePantryOnly = false } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const planStart = parseDateInput(startDate);

  if (!planStart) {
    return res.status(400).json({ error: 'startDate is invalid' });
  }

  const planEnd = shiftDate(planStart, 6);

  try {
    getApiKey();

    const [nutritionalGoal, dietaryProfile, pantryItems] = await Promise.all([
      prisma.nutritionalGoal.findUnique({ where: { userId } }),
      prisma.dietaryProfile.findUnique({ where: { userId } }),
      usePantryOnly
        ? prisma.pantryItem.findMany({
            where: { userId },
            include: { ingredient: true },
            orderBy: [{ expirationDate: 'asc' }, { createdAt: 'asc' }],
          })
        : Promise.resolve([]),
    ]);

    if (!nutritionalGoal) {
      return res.status(404).json({ error: 'No nutritional goals found for user' });
    }

    if (usePantryOnly && pantryItems.length === 0) {
      return res.status(400).json({ error: 'No items in pantry for meal planning' });
    }

    const pantryContext = buildPantryContext(pantryItems);
    const mealSlots = buildMealSlots(nutritionalGoal);
    const plannedEntries = [];
    const missingSlots = [];

    for (const slot of mealSlots) {
      try {
        let recipes = [];

        for (const params of buildPlannerAttempts(
          slot,
          nutritionalGoal,
          dietaryProfile,
          pantryContext,
          usePantryOnly,
        )) {
          const searchResult = await spoonacularGet('/recipes/complexSearch', params);
          recipes = Array.isArray(searchResult.results) ? searchResult.results : [];

          if (recipes.length > 0) {
            break;
          }
        }

        if (recipes.length === 0) {
          missingSlots.push(slot.label);
          continue;
        }

        const scoredRecipes = recipes
          .map((recipe) => ({
            recipe,
            score: scoreRecipe(recipe, slot.targets, pantryContext, usePantryOnly),
          }))
          .sort((left, right) => left.score - right.score)
          .map(({ recipe }) => recipe);

        const selectedRecipes = selectRecipesForWeek(scoredRecipes);

        selectedRecipes.forEach((recipe, dayOffset) => {
          plannedEntries.push({
            day: shiftDate(planStart, dayOffset),
            mealType: slot.mealType,
            slotIndex: slot.slotIndex,
            sourceReason: usePantryOnly
              ? 'Generated from pantry items with priority for ingredients expiring soon'
              : 'Generated from nutritional goals and dietary filters',
            recipe,
          });
        });
      } catch (error) {
        console.error(`Error generating ${slot.label}:`, error.message);
        missingSlots.push(slot.label);
      }
    }

    if (plannedEntries.length === 0) {
      return res.status(502).json({
        error: 'Unable to generate a weekly plan',
        details: 'No meal slots could be generated from Spoonacular.',
      });
    }

    if (missingSlots.length > 0) {
      return res.status(502).json({
        error: 'Unable to generate a complete weekly plan',
        missingSlots,
      });
    }

    const recipeCache = new Map();
    const completeMealPlan = await prisma.$transaction(async (tx) => {
      const mealPlan = await tx.mealPlan.create({
        data: {
          userId,
          planType: 'WEEKLY',
          startDate: planStart,
          endDate: planEnd,
        },
      });

      for (const entry of plannedEntries) {
        let storedRecipe = recipeCache.get(entry.recipe.id);

        if (!storedRecipe) {
          storedRecipe = await tx.recipe.upsert({
            where: { spoonacularId: entry.recipe.id },
            update: buildRecipeRecord(entry.recipe),
            create: buildRecipeRecord(entry.recipe),
          });
          recipeCache.set(entry.recipe.id, storedRecipe);
        }

        await tx.mealPlanEntry.create({
          data: {
            mealPlanId: mealPlan.id,
            day: entry.day,
            mealType: entry.mealType,
            slotIndex: entry.slotIndex,
            recipeId: storedRecipe.id,
            servings: storedRecipe.servings ?? 1,
            sourceReason: entry.sourceReason,
          },
        });
      }

      return tx.mealPlan.findUnique({
        where: { id: mealPlan.id },
        include: {
          entries: {
            include: {
              recipe: true,
            },
            orderBy: [{ day: 'asc' }, { mealType: 'asc' }, { slotIndex: 'asc' }],
          },
        },
      });
    });

    res.status(201).json(completeMealPlan);
  } catch (error) {
    console.error('Error creating weekly plan:', error.message);
    res.status(500).json({ error: 'Failed to create weekly plan', details: error.message });
  }
});
// --- AUTHENTICATION ROUTES ---

// 1. User Registration
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Check if the user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create the user in the database
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
      },
    });

    res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// 2. User Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Find the user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare the provided password with the hashed password in DB
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate the JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' } // Token expires in 7 days
    );

    res.json({ 
      message: 'Login successful', 
      token, 
      user: { id: user.id, email: user.email } 
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// 3. Save Nutritional Profile
app.post('/api/profile', async (req, res) => {
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
app.get('/api/profile/:userId', async (req, res) => {
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
// --- PANTRY ROUTES ---

// 1. Get all ingredients for a user
app.get('/api/pantry/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const items = await prisma.pantryItem.findMany({
      where: { userId: userId },
      include: { ingredient: true }, // Importante: alleghiamo i dati dell'ingrediente!
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(items);
  } catch (error) {
    console.error('Error fetching pantry:', error);
    res.status(500).json({ error: 'Failed to fetch pantry items' });
  }
});

// 2. Add a new ingredient to pantry
app.post('/api/pantry', async (req, res) => {
  try {
    const { userId, name, quantity, unit } = req.body;
    
    if (!userId || !name || !quantity || !unit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const ingredientName = name.trim().toLowerCase();

    // A. Trova l'ingrediente nel DB generale, o crealo se non esiste
    const ingredient = await prisma.ingredient.upsert({
      where: { name: ingredientName },
      update: {}, // Se esiste, non cambiamo nulla
      create: { name: ingredientName } // Se non esiste, lo creiamo
    });

    // B. Aggiungi l'elemento alla dispensa dell'utente
    const newItem = await prisma.pantryItem.create({
      data: { 
        userId: userId, 
        ingredientId: ingredient.id,
        quantity: parseFloat(quantity),
        unit: unit
      },
      include: {
        ingredient: true // Restituiamo il pacchetto completo al frontend
      }
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error adding ingredient:', error);
    res.status(500).json({ error: 'Failed to add ingredient' });
  }
});

// 3. Delete an ingredient from pantry
app.delete('/api/pantry/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.pantryItem.delete({
      where: { id: id }
    });
    res.status(200).json({ message: 'Ingredient deleted' });
  } catch (error) {
    console.error('Error deleting ingredient:', error);
    res.status(500).json({ error: 'Failed to delete ingredient' });
  }
});
// --- EXTERNAL API ROUTES ---

// Autocomplete Ingredients via Spoonacular
app.get('/api/ingredients/autocomplete', async (req, res) => {
  try {
    const { query } = req.query;
    
    // Se l'utente ha scritto meno di 2 lettere, non facciamo la chiamata
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const apiKey = process.env.SPOONACULAR_API_KEY;
    if (!apiKey) {
      throw new Error("SPOONACULAR_API_KEY is missing in .env");
    }

    // Chiamiamo Spoonacular per avere i 5 migliori suggerimenti
    const spoonacularUrl = `https://api.spoonacular.com/food/ingredients/autocomplete?query=${query}&number=5&metaInformation=true&apiKey=${apiKey}`;
    
    // Node.js v18+ ha fetch nativo, possiamo usarlo nel backend!
    const response = await fetch(spoonacularUrl);
    if (!response.ok) {
      throw new Error(`Spoonacular API responded with status ${response.status}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Error in autocomplete:', error.message);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});
// --- MEAL PLANNER ROUTES (MODULO 1, 2 e 4) ---

app.get('/api/planner/:userId', async (req, res) => {
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
    res.status(200).json(activePlan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active meal plan' });
  }
});

// Generatore Definitivo 4.0: Pantry-First e Tetris dei Macro Giornalieri
app.post('/api/planner/generate', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required' });
    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId } });
    if (!goal) return res.status(400).json({ error: 'Profile incomplete' });

    const pantry = await prisma.pantryItem.findMany({ where: { userId }, include: { ingredient: true } });
    const pantryNames = pantry.map(p => p.ingredient.name.toLowerCase());
    const pantryQuery = pantryNames.join(',');

    const apiKey = process.env.SPOONACULAR_API_KEY;
    const avgCals = Math.round(goal.dailyCalories / 3);
    const avgPro = Math.round(goal.dailyProtein / 3);
    const avgCarbs = Math.round(goal.dailyCarbs / 3);
    const avgFat = Math.round(goal.dailyFat / 3);
// 1. SOSTITUISCI SOLO QUESTA FUNZIONE
    const fetchPool = async (type, count) => {
      const offset = Math.floor(Math.random() * 20);
      
      const baseUrl = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=${count}&type=${type}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true&offset=${offset}&minCalories=${Math.max(50, avgCals-250)}&maxCalories=${avgCals+300}&minProtein=${Math.max(0, avgPro-15)}&minCarbs=${Math.max(0, avgCarbs-20)}&minFat=${Math.max(0, avgFat-15)}`;
      
      const res = await fetch(baseUrl);
      const data = await res.json();
      return data.results || [];
    };

    // Peschiamo un "bacino" di ricette da cui attingere
    const breakfastPool = await fetchPool('breakfast', 15);
    const mainCoursePool = await fetchPool('main course', 30);

    // Mettiamo un controllo di sicurezza solo per problemi di rete dell'API
    if (breakfastPool.length < 7 || mainCoursePool.length < 14) {
      return res.status(400).json({ error: 'Spoonacular API is busy or out of quota. Please try again in a few seconds!' });
    }
    const getPantryScore = (recipe) => {
      const allIng = [...(recipe.usedIngredients || []), ...(recipe.missedIngredients || []), ...(recipe.extendedIngredients || [])];
      const uniqueNames = Array.from(new Set(allIng.map(a => a.name.toLowerCase())));
      return uniqueNames.filter(ingName => pantryNames.some(p => ingName.includes(p) || p.includes(ingName))).length;
    };
    breakfastPool.sort((a, b) => getPantryScore(b) - getPantryScore(a));
    mainCoursePool.sort((a, b) => getPantryScore(b) - getPantryScore(a));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
      
      // Target della giornata intera
      let remainingCals = goal.dailyCalories;
      let remainingPro = goal.dailyProtein;

      // A. Scegliamo la Colazione e la rimuoviamo dal pool per non ripeterla
      const breakfast = breakfastPool.splice(Math.floor(Math.random() * Math.min(3, breakfastPool.length)), 1)[0];
      remainingCals -= getMacro(breakfast, 'Calories');
      remainingPro -= getMacro(breakfast, 'Protein');

      // B. Scegliamo il Pranzo
      const lunch = mainCoursePool.splice(Math.floor(Math.random() * Math.min(5, mainCoursePool.length)), 1)[0];
      remainingCals -= getMacro(lunch, 'Calories');
      remainingPro -= getMacro(lunch, 'Protein');

      // C. Scegliamo la Cena: Quella che si avvicina di più ai macro RIMASTI per chiudere la giornata
      // Ordiniamo il pool rimasto in base a chi ha la differenza minore con le calorie e proteine mancanti
      mainCoursePool.sort((a, b) => {
        const diffA = Math.abs(getMacro(a, 'Calories') - remainingCals) + Math.abs(getMacro(a, 'Protein') - remainingPro)*4;
        const diffB = Math.abs(getMacro(b, 'Calories') - remainingCals) + Math.abs(getMacro(b, 'Protein') - remainingPro)*4;
        return diffA - diffB;
      });

      const dinner = mainCoursePool.shift(); // Prendiamo la migliore e la rimuoviamo!

      const dailyMeals = [
        { type: 'BREAKFAST', data: breakfast },
        { type: 'LUNCH', data: lunch },
        { type: 'DINNER', data: dinner }
      ];

      // Salvataggio nel Database (Uguale a prima, ma con controllo Dispensa infallibile)
      for (let j = 0; j < 3; j++) {
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
            slotIndex: 0,
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

// Swap Intelligente (Calcola i macro mancanti nella giornata)
// Swap Intelligente (Macro calcolati + Istruzioni per il Popup)
app.put('/api/planner/swap/:entryId', async (req, res) => {
  try {
    const { entryId } = req.params;
    const apiKey = process.env.SPOONACULAR_API_KEY;

    const currentEntry = await prisma.mealPlanEntry.findUnique({ 
      where: { id: entryId }, 
      include: { mealPlan: true } 
    });
    
    const goal = await prisma.nutritionalGoal.findUnique({ 
      where: { userId: currentEntry.mealPlan.userId } 
    });

    const dayEntries = await prisma.mealPlanEntry.findMany({ 
      where: { mealPlanId: currentEntry.mealPlanId, day: currentEntry.day, id: { not: entryId } }, 
      include: { recipe: true } 
    });
    
    const usedCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
    const targetCals = Math.max(200, goal.dailyCalories - usedCals);
    const type = currentEntry.mealType === 'BREAKFAST' ? 'breakfast' : 'main course';
    const offset = Math.floor(Math.random() * 50);

    // Chiamata con addRecipeInformation=true
    const url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=1&type=${type}&offset=${offset}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true&minCalories=${Math.max(100, targetCals - 200)}&maxCalories=${targetCals + 200}`;
    
    const response = await fetch(url);
    const data = await response.json();
    const rd = data.results[0];

    if (!rd) return res.status(400).json({ error: 'No suitable recipe found' });

    const getMacro = (name) => rd.nutrition?.nutrients?.find(n => n.name === name)?.amount || 0;

    const newRecipe = await prisma.recipe.upsert({
      where: { spoonacularId: rd.id },
      update: {
        instructions: rd.instructions,
        nutritionalInfo: { extendedIngredients: rd.extendedIngredients }
      },
      create: {
        sourceType: 'SPOONACULAR',
        spoonacularId: rd.id,
        title: rd.title,
        imageUrl: rd.image,
        instructions: rd.instructions,
        caloriesPerServing: getMacro('Calories'),
        proteinGramsPerServing: getMacro('Protein'),
        carbsGramsPerServing: getMacro('Carbohydrates'),
        fatGramsPerServing: getMacro('Fat'),
        nutritionalInfo: { 
          usedIngredients: rd.usedIngredients?.map(i => i.name) || [], 
          missedIngredients: rd.missedIngredients?.map(i => i.name) || [], 
          extendedIngredients: rd.extendedIngredients 
        }
      }
    });

    const updatedEntry = await prisma.mealPlanEntry.update({
      where: { id: entryId },
      data: { recipeId: newRecipe.id, isLocked: false },
      include: { recipe: true }
    });

    res.status(200).json(updatedEntry);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Swap failed' });
  }
});

// NUOVA ROTTA: Segna il pasto come "Mangiato" (isLocked)
app.patch('/api/planner/entry/:entryId/toggle', async (req, res) => {
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

const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, prisma, server };
