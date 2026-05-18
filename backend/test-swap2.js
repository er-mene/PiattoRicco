import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSwap() {
  try {
    const aiRecipes = await prisma.recipe.findMany({ 
      where: { sourceType: 'AI_GENERATED' }, 
      include: { mealPlanEntries: { include: { mealPlan: true } } } 
    });
    
    if (aiRecipes.length === 0) {
      console.log("No AI recipes found.");
      return;
    }

    const recipe = aiRecipes.find(r => r.mealPlanEntries.length > 0);
    if (!recipe) return console.log("No entries found");
    
    const entryId = recipe.mealPlanEntries[0].id;
    console.log("Found entry:", entryId);

    const currentEntry = await prisma.mealPlanEntry.findUnique({ 
      where: { id: entryId }, 
      include: { mealPlan: true, recipe: true } 
    });
    
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

    const targetCals = Math.max(100, goal.dailyCalories - usedCals);
    const targetPro = Math.max(5, goal.dailyProtein - usedPro);
    const targetCarb = Math.max(5, goal.dailyCarbs - usedCarb);
    const targetFat = Math.max(5, goal.dailyFat - usedFat);

    let type = 'main course';
    if (currentEntry.mealType === 'BREAKFAST') type = 'breakfast';
    if (currentEntry.mealType === 'SNACK') type = 'snack';

    const offset = Math.floor(Math.random() * 30);
    const apiKey = process.env.SPOONACULAR_API_KEY || 'dummy'; // Will fail fetch but we can see before fetch
    let url = `https://api.spoonacular.com/recipes/complexSearch?apiKey=${apiKey}&number=15&offset=${offset}&type=${type}&addRecipeNutrition=true&addRecipeInformation=true&fillIngredients=true`;
    
    console.log("Target Cals:", targetCals);
    console.log("Type:", type);
    console.log("URL:", url.substring(0, 50) + "...");
    
    console.log("Everything up to fetch is working!");

  } catch(e) {
    console.error("Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}

testSwap();
