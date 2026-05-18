import prisma from './src/db.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildMealSlots } from './src/utils/plannerUtils.js';
import dotenv from 'dotenv';
dotenv.config();



async function run() {
  try {
    const user = await prisma.user.findFirst();
    const userId = user.id;

    const goal = await prisma.nutritionalGoal.findUnique({ where: { userId } });
    const dietaryProfile = await prisma.dietaryProfile.findUnique({ where: { userId } });
    const pantry = await prisma.pantryItem.findMany({ where: { userId }, include: { ingredient: true } });

    const pantryNames = pantry.map(p => p.ingredient.name).join(', ');
    const mealSlots = buildMealSlots(goal);
    const dailySnackCount = mealSlots.filter(s => s.mealType === 'SNACK').length;
    const totalWeeklySnacks = dailySnackCount * 7;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      generationConfig: { responseMimeType: "application/json" }
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

    console.log("Starting stream...");
    const streamingResult = await model.generateContentStream(prompt);
    let fullResponse = '';
    for await (const chunk of streamingResult.stream) {
      fullResponse += chunk.text();
    }
    console.log("Success! Length:", fullResponse.length);
  } catch(e) {
    console.error("ERROR", e);
  } finally {
    await prisma.$disconnect();
  }
}
run();
