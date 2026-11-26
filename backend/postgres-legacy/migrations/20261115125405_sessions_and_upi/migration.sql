-- AlterTable
ALTER TABLE "store_setting" ADD COLUMN     "auto_lock_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "require_card_reference" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "require_upi_reference" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "upi_id" TEXT,
ADD COLUMN     "upi_payee_name" TEXT;

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "counter_id" INTEGER,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_user_id_revoked_at_idx" ON "session"("user_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A UPI or card transaction reference can back only one completed bill (checked in the app with an
-- advisory lock too, so two counters cannot claim the same payment at the same moment).
CREATE INDEX "sale_payment_reference_idx" ON "sale_payment" ("mode", "reference") WHERE "reference" IS NOT NULL;
ALTER TABLE "store_setting" ADD CONSTRAINT "store_setting_autolock_ck" CHECK ("auto_lock_minutes" >= 0 AND "auto_lock_minutes" <= 240);
