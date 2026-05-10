const SNACK_THRESHOLD = 2000;
const SNACK_INTERVAL = 500;
const MEAL_BASE_SHARES = {
  BREAKFAST: 0.25,
  LUNCH: 0.4,
  DINNER: 0.35,
};
const MAIN_MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER'];

export function buildMealSlots(nutritionalGoal) {
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
