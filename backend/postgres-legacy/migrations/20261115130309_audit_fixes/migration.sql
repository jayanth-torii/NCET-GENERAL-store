-- AlterTable
ALTER TABLE "purchase" ADD COLUMN     "ready_at" TIMESTAMPTZ(6),
ADD COLUMN     "ready_by" INTEGER;

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "price_override" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "print_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_item" ADD COLUMN     "master_rate" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "store_setting" ADD COLUMN     "return_window_days" INTEGER NOT NULL DEFAULT 30;
