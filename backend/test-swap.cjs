const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function test() {
  const aiRecipes = await prisma.recipe.findMany({ where: { sourceType: 'AI_GENERATED' }, include: { mealPlanEntries: { include: { mealPlan: true } } } });
  
  if (aiRecipes.length === 0) {
    console.log("No AI recipes found.");
    return;
  }

  const recipe = aiRecipes.find(r => r.mealPlanEntries.length > 0);
  if (!recipe) return console.log("No entries found");
  
  const entry = recipe.mealPlanEntries[0];
  const userId = entry.mealPlan.userId;
  const token = 'MOCK_TOKEN'; // We will just call the function directly by importing the route? No, we can't easily mock requireAuth.
  
  console.log("Found entry:", entry.id);
  // Let's do the exact DB steps here:
  const currentEntry = await prisma.mealPlanEntry.findUnique({ where: { id: entry.id }, include: { mealPlan: true, recipe: true } });
  
  const goal = await prisma.nutritionalGoal.findUnique({ where: { userId: currentEntry.mealPlan.userId } });
  const dayEntries = await prisma.mealPlanEntry.findMany({
    where: { mealPlanId: currentEntry.mealPlanId, day: currentEntry.day, id: { not: entry.id } }, include: { recipe: true }
  });

  const usedCals = dayEntries.reduce((sum, e) => sum + (e.recipe.caloriesPerServing || 0), 0);
  console.log("usedCals:", usedCals);
  
  const type = currentEntry.mealType === 'BREAKFAST' ? 'breakfast' : 'main course';
  console.log("type:", type);
  console.log("spoonacularId:", currentEntry.recipe.spoonacularId);
}

test().catch(console.error).finally(() => prisma.$disconnect());
