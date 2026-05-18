import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  try {
    const aiEntry = await prisma.mealPlanEntry.findFirst({
      where: { recipe: { sourceType: 'AI_GENERATED' } },
      include: { mealPlan: true, recipe: true }
    });

    if (!aiEntry) {
      console.log('No AI entry found');
      return;
    }

    console.log('Found AI Entry:', aiEntry.id);
    console.log('Meal Type:', aiEntry.mealType);
    console.log('Recipe ID:', aiEntry.recipeId);
    
    // Simulate what the swap endpoint does
    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId: aiEntry.mealPlan.userId } });
    console.log('Goal:', goal);

    const dayEntries = await prisma.mealPlanEntry.findMany({
      where: { mealPlanId: aiEntry.mealPlanId, day: aiEntry.day, id: { not: aiEntry.id } }, include: { recipe: true }
    });
    console.log('Day Entries Count:', dayEntries.length);

    const usedCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
    const targetCals = Math.max(100, goal.dailyCalories - usedCals);
    console.log('Target Cals:', targetCals);

    let type = 'main course';
    if (aiEntry.mealType === 'BREAKFAST') type = 'breakfast';
    if (aiEntry.mealType === 'SNACK') type = 'snack';

    const offset = Math.floor(Math.random() * 30);
    console.log(`URL would be: type=${type}, offset=${offset}`);

    // If everything here works, the issue is not in the data preparation.
    // Let's mock a Spoonacular response
    const mockSpoonacularId = Math.floor(Math.random() * 1000000) + 1000000;
    const newRecipe = await prisma.recipe.upsert({
      where: { spoonacularId: mockSpoonacularId },
      update: {},
      create: {
        sourceType: 'SPOONACULAR', 
        spoonacularId: mockSpoonacularId, 
        title: 'Mock Recipe', 
        imageUrl: 'http://mock.com/img.png',
        instructions: 'Mock instructions', 
        readyInMinutes: 30, 
        servings: 1,
        caloriesPerServing: 500, 
        proteinGramsPerServing: 30,
        carbsGramsPerServing: 40, 
        fatGramsPerServing: 20,
        nutritionalInfo: { usedIngredients: [], missedIngredients: [], extendedIngredients: [] }
      }
    });

    console.log('Upsert successful:', newRecipe.id);

    const updatedEntry = await prisma.mealPlanEntry.update({
      where: { id: aiEntry.id }, data: { recipeId: newRecipe.id, isLocked: false }, include: { recipe: true }
    });

    console.log('Update successful, swapped to:', updatedEntry.recipe.title);
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    await prisma.$disconnect();
  }
}

test();
