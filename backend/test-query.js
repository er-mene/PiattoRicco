import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const plans = await prisma.mealPlan.findMany({ include: { entries: { include: { recipe: true } } } });
  for (const p of plans) {
    const titles = p.entries.map(e => e.recipe.title);
    const unique = new Set(titles);
    console.log("Plan ID:", p.id, "Unique Recipes:", unique.size);
    console.log("Titles:", Array.from(unique));
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
