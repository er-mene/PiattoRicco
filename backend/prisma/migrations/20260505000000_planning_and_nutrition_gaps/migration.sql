-- CreateEnum
CREATE TYPE "PantryReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

-- AlterTable
ALTER TABLE "MealPlanEntry"
ADD COLUMN "slotIndex" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Recipe"
ADD COLUMN "caloriesPerServing" DOUBLE PRECISION,
ADD COLUMN "proteinGramsPerServing" DOUBLE PRECISION,
ADD COLUMN "carbsGramsPerServing" DOUBLE PRECISION,
ADD COLUMN "fatGramsPerServing" DOUBLE PRECISION,
ADD COLUMN "fiberGramsPerServing" DOUBLE PRECISION,
ADD COLUMN "sugarGramsPerServing" DOUBLE PRECISION,
ADD COLUMN "sodiumMgPerServing" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "RecipeIngredient"
ADD COLUMN "normalizedQuantity" DOUBLE PRECISION,
ADD COLUMN "normalizedUnit" TEXT;

-- DropIndex
DROP INDEX "MealPlanEntry_mealPlanId_day_mealType_key";

-- CreateTable
CREATE TABLE "PantryReservation" (
    "id" TEXT NOT NULL,
    "mealPlanEntryId" TEXT NOT NULL,
    "pantryItemId" TEXT NOT NULL,
    "recipeIngredientId" TEXT,
    "ingredientId" TEXT NOT NULL,
    "status" "PantryReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedQuantity" DOUBLE PRECISION NOT NULL,
    "reservedUnit" TEXT NOT NULL,
    "normalizedQuantity" DOUBLE PRECISION,
    "normalizedUnit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PantryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanEntry_mealPlanId_day_mealType_slotIndex_key" ON "MealPlanEntry"("mealPlanId", "day", "mealType", "slotIndex");

-- CreateIndex
CREATE INDEX "MealPlanEntry_mealPlanId_day_idx" ON "MealPlanEntry"("mealPlanId", "day");

-- CreateIndex
CREATE INDEX "PantryReservation_mealPlanEntryId_idx" ON "PantryReservation"("mealPlanEntryId");

-- CreateIndex
CREATE INDEX "PantryReservation_pantryItemId_idx" ON "PantryReservation"("pantryItemId");

-- CreateIndex
CREATE INDEX "PantryReservation_ingredientId_idx" ON "PantryReservation"("ingredientId");

-- CreateIndex
CREATE INDEX "PantryReservation_status_idx" ON "PantryReservation"("status");

-- AddForeignKey
ALTER TABLE "PantryReservation" ADD CONSTRAINT "PantryReservation_mealPlanEntryId_fkey" FOREIGN KEY ("mealPlanEntryId") REFERENCES "MealPlanEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PantryReservation" ADD CONSTRAINT "PantryReservation_pantryItemId_fkey" FOREIGN KEY ("pantryItemId") REFERENCES "PantryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PantryReservation" ADD CONSTRAINT "PantryReservation_recipeIngredientId_fkey" FOREIGN KEY ("recipeIngredientId") REFERENCES "RecipeIngredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PantryReservation" ADD CONSTRAINT "PantryReservation_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
