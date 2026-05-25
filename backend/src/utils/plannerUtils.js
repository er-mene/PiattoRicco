/**
 * Meal Planning Utilities (Caloric Tetris).
 * Contains the algorithmic logic for partitioning the user's daily calorie targets
 * into proportional meal slots (Breakfast, Lunch, Dinner, Snack).
 */

const SNACK_THRESHOLD = 2000;
const SNACK_INTERVAL = 500;
const MEAL_BASE_SHARES = {
  BREAKFAST: 0.25,
  LUNCH: 0.4,
  DINNER: 0.35,
};
const MAIN_MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'];

/**
 * Computes and returns the list of daily meal slots, assigning macro percentages and quantitative
 * target goals to each slot based on the user's overall daily goal.
 * Snacks are automatically distributed if the calorie target exceeds the snack threshold.
 */
export function buildMealSlots(nutritionalGoal) {
  const snackCount =
    nutritionalGoal.dailyCalories > SNACK_THRESHOLD
      ? Math.floor((nutritionalGoal.dailyCalories - SNACK_THRESHOLD) / SNACK_INTERVAL) + 1
      : 0;

  const snackShare = snackCount > 0 ? 0.1 : 0;
  const mainMealMultiplier = 1 - snackShare;
  const perSnackShare = snackCount > 0 ? snackShare / snackCount : 0;

  const mealSlots = [];
  let currentSnack = 0;

  for (let i = 0; i < MAIN_MEAL_TYPES.length; i++) {
    const mealType = MAIN_MEAL_TYPES[i];
    mealSlots.push({
      label: mealType,
      mealType,
      shares: {
        calories: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
        protein: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
        carbs: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
        fat: MEAL_BASE_SHARES[mealType] * mainMealMultiplier,
      },
    });

    if (currentSnack < snackCount) {
      mealSlots.push({
        label: `SNACK_${currentSnack + 1}`,
        mealType: 'SNACK',
        shares: {
          calories: perSnackShare,
          protein: perSnackShare,
          carbs: perSnackShare,
          fat: perSnackShare,
        },
      });
      currentSnack++;
    }
  }

  while (currentSnack < snackCount) {
    mealSlots.push({
      label: `SNACK_${currentSnack + 1}`,
      mealType: 'SNACK',
      shares: {
        calories: perSnackShare,
        protein: perSnackShare,
        carbs: perSnackShare,
        fat: perSnackShare,
      },
    });
    currentSnack++;
  }

  return mealSlots.map((slot, index) => ({
    ...slot,
    slotIndex: index,
    targets: {
      calories: Math.round(nutritionalGoal.dailyCalories * slot.shares.calories),
      protein: Math.round(nutritionalGoal.dailyProtein * slot.shares.protein),
      carbs: Math.round(nutritionalGoal.dailyCarbs * slot.shares.carbs),
      fat: Math.round(nutritionalGoal.dailyFat * slot.shares.fat),
    },
  }));
}
