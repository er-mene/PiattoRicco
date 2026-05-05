import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

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

const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, prisma, server };
