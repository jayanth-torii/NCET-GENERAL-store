-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'STORE_KEEPER', 'CASHIER');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT', 'CANCEL');

-- CreateEnum
CREATE TYPE "ChargeAllocation" AS ENUM ('BY_VALUE', 'BY_QTY', 'NONE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'CARD');

-- CreateEnum
CREATE TYPE "EntryUnit" AS ENUM ('PACK', 'BASE');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GstMode" AS ENUM ('NOT_REGISTERED', 'REGISTERED');

-- CreateTable
CREATE TABLE "app_user" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "printer_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allow_decimal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "pack_unit_id" INTEGER,
    "pack_size" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "hsn_code" TEXT,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "mrp" DECIMAL(12,2),
    "sale_price" DECIMAL(12,2) NOT NULL,
    "last_cost" DECIMAL(12,4),
    "reorder_level" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "rack_no" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stock" (
    "product_id" INTEGER NOT NULL,
    "on_hand" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "product_stock_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" BIGSERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(12,4),
    "ref_type" TEXT NOT NULL,
    "ref_id" BIGINT NOT NULL,
    "note" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_type" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "adds_to_cost" BOOLEAN NOT NULL DEFAULT true,
    "allocation" "ChargeAllocation" NOT NULL DEFAULT 'BY_VALUE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "charge_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase" (
    "id" SERIAL NOT NULL,
    "purchase_no" TEXT,
    "supplier_id" INTEGER NOT NULL,
    "supplier_invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "items_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "charges_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoice_total" DECIMAL(12,2),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by" INTEGER NOT NULL,
    "posted_by" INTEGER,
    "posted_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_item" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "entry_unit" "EntryUnit" NOT NULL DEFAULT 'BASE',
    "entered_qty" DECIMAL(12,3) NOT NULL,
    "pack_size" DECIMAL(12,3) NOT NULL,
    "base_qty" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL,
    "landed_unit_cost" DECIMAL(12,4),
    "batch" TEXT,
    "expiry" DATE,

    CONSTRAINT "purchase_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_charge" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "charge_type_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_to" TEXT,
    "reference_no" TEXT,

    CONSTRAINT "purchase_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_item" (
    "id" SERIAL NOT NULL,
    "kit_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "kit_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale" (
    "id" BIGSERIAL NOT NULL,
    "bill_no" TEXT NOT NULL,
    "counter_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "billed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items_total" DECIMAL(12,2) NOT NULL,
    "discount_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(12,2) NOT NULL,
    "tendered" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "change_due" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "idempotency_key" UUID NOT NULL,
    "customer_name" TEXT,
    "remarks" TEXT,
    "edited_at" TIMESTAMPTZ(6),
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "cancel_reason" TEXT,
    "cancelled_by" INTEGER,
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_item" (
    "id" SERIAL NOT NULL,
    "sale_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" INTEGER,
    "kit_id" INTEGER,
    "code_snapshot" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL,
    "cost_at_sale" DECIMAL(12,4) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_kit_component" (
    "id" SERIAL NOT NULL,
    "sale_item_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty_per_kit" DECIMAL(12,3) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,4) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_kit_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payment" (
    "id" SERIAL NOT NULL,
    "sale_id" BIGINT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,

    CONSTRAINT "sale_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "held_bill" (
    "id" SERIAL NOT NULL,
    "counter_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return" (
    "id" SERIAL NOT NULL,
    "return_no" TEXT NOT NULL,
    "sale_id" BIGINT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_item" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "sale_item_id" INTEGER NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "sales_return_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return" (
    "id" SERIAL NOT NULL,
    "return_no" TEXT NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_item" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "purchase_item_id" INTEGER NOT NULL,
    "base_qty" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_return_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty_change" DECIMAL(12,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" INTEGER NOT NULL,
    "decided_by" INTEGER,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "doc_counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "store_setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "store_name" TEXT NOT NULL DEFAULT 'GENERAL STORE',
    "address_line" TEXT NOT NULL DEFAULT 'Nagarjuna College of Engineering & Technology',
    "phone" TEXT,
    "gstin" TEXT,
    "gst_mode" "GstMode" NOT NULL DEFAULT 'NOT_REGISTERED',
    "receipt_footer" TEXT NOT NULL DEFAULT 'Thank you! Goods once sold can be returned only with this bill.',
    "block_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "round_bill_to_rupee" BOOLEAN NOT NULL DEFAULT true,
    "max_cashier_discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "store_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alert" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "system_alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_username_key" ON "app_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "counter_code_key" ON "counter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "category_name_key" ON "category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "unit_code_key" ON "unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "product_code_key" ON "product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcode_key" ON "product"("barcode");

-- CreateIndex
CREATE INDEX "product_category_id_idx" ON "product"("category_id");

-- CreateIndex
CREATE INDEX "stock_movement_product_id_created_at_idx" ON "stock_movement"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movement_created_at_idx" ON "stock_movement"("created_at");

-- CreateIndex
CREATE INDEX "stock_movement_ref_type_ref_id_idx" ON "stock_movement"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_name_key" ON "supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "charge_type_name_key" ON "charge_type"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_purchase_no_key" ON "purchase"("purchase_no");

-- CreateIndex
CREATE INDEX "purchase_supplier_id_idx" ON "purchase"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_status_posted_at_idx" ON "purchase"("status", "posted_at");

-- CreateIndex
CREATE INDEX "purchase_item_purchase_id_idx" ON "purchase_item"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_item_product_id_idx" ON "purchase_item"("product_id");

-- CreateIndex
CREATE INDEX "purchase_charge_purchase_id_idx" ON "purchase_charge"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "kit_code_key" ON "kit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "kit_item_kit_id_product_id_key" ON "kit_item"("kit_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_bill_no_key" ON "sale"("bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "sale_idempotency_key_key" ON "sale"("idempotency_key");

-- CreateIndex
CREATE INDEX "sale_billed_at_idx" ON "sale"("billed_at");

-- CreateIndex
CREATE INDEX "sale_counter_id_billed_at_idx" ON "sale"("counter_id", "billed_at");

-- CreateIndex
CREATE INDEX "sale_user_id_billed_at_idx" ON "sale"("user_id", "billed_at");

-- CreateIndex
CREATE INDEX "sale_item_sale_id_idx" ON "sale_item"("sale_id");

-- CreateIndex
CREATE INDEX "sale_item_product_id_idx" ON "sale_item"("product_id");

-- CreateIndex
CREATE INDEX "sale_kit_component_sale_item_id_idx" ON "sale_kit_component"("sale_item_id");

-- CreateIndex
CREATE INDEX "sale_payment_sale_id_idx" ON "sale_payment"("sale_id");

-- CreateIndex
CREATE INDEX "held_bill_counter_id_idx" ON "held_bill"("counter_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_return_return_no_key" ON "sales_return"("return_no");

-- CreateIndex
CREATE INDEX "sales_return_created_at_idx" ON "sales_return"("created_at");

-- CreateIndex
CREATE INDEX "sales_return_item_sale_item_id_idx" ON "sales_return_item"("sale_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_return_return_no_key" ON "purchase_return"("return_no");

-- CreateIndex
CREATE INDEX "purchase_return_created_at_idx" ON "purchase_return"("created_at");

-- CreateIndex
CREATE INDEX "purchase_return_item_purchase_item_id_idx" ON "purchase_return_item"("purchase_item_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_status_idx" ON "stock_adjustment"("status");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "system_alert_resolved_at_idx" ON "system_alert"("resolved_at");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_pack_unit_id_fkey" FOREIGN KEY ("pack_unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_charge" ADD CONSTRAINT "purchase_charge_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_charge" ADD CONSTRAINT "purchase_charge_charge_type_id_fkey" FOREIGN KEY ("charge_type_id") REFERENCES "charge_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_item" ADD CONSTRAINT "kit_item_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_item" ADD CONSTRAINT "kit_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_kit_component" ADD CONSTRAINT "sale_kit_component_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_kit_component" ADD CONSTRAINT "sale_kit_component_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payment" ADD CONSTRAINT "sale_payment_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bill" ADD CONSTRAINT "held_bill_counter_id_fkey" FOREIGN KEY ("counter_id") REFERENCES "counter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bill" ADD CONSTRAINT "held_bill_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return" ADD CONSTRAINT "sales_return_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_item" ADD CONSTRAINT "sales_return_item_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_item" ADD CONSTRAINT "sales_return_item_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return" ADD CONSTRAINT "purchase_return_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_item" ADD CONSTRAINT "purchase_return_item_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "purchase_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_item" ADD CONSTRAINT "purchase_return_item_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express in schema.prisma
-- ---------------------------------------------------------------------------

-- No two active products with the same name (case and repeated spaces ignored).
CREATE UNIQUE INDEX "product_name_uq" ON "product" (lower(regexp_replace(trim("name"), '\s+', ' ', 'g'))) WHERE "is_active";

-- One supplier bill can only be entered once (cancelled purchases do not block re-entry).
CREATE UNIQUE INDEX "purchase_supplier_invoice_uq" ON "purchase" ("supplier_id", lower(trim("supplier_invoice_no"))) WHERE "status" <> 'CANCELLED';

-- Sanity checks on values.
ALTER TABLE "product" ADD CONSTRAINT "product_sale_price_ck" CHECK ("sale_price" >= 0);
ALTER TABLE "product" ADD CONSTRAINT "product_pack_size_ck" CHECK ("pack_size" > 0);
ALTER TABLE "product" ADD CONSTRAINT "product_gst_ck" CHECK ("gst_rate" >= 0 AND "gst_rate" <= 40);
ALTER TABLE "product" ADD CONSTRAINT "product_mrp_ck" CHECK ("mrp" IS NULL OR "mrp" >= 0);
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_qty_ck" CHECK ("qty" > 0);
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_ref_ck" CHECK (("product_id" IS NOT NULL) <> ("kit_id" IS NOT NULL));
ALTER TABLE "sale_payment" ADD CONSTRAINT "sale_payment_amount_ck" CHECK ("amount" > 0);
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_qty_ck" CHECK ("entered_qty" > 0 AND "base_qty" > 0);
ALTER TABLE "purchase_charge" ADD CONSTRAINT "purchase_charge_amount_ck" CHECK ("amount" > 0);
ALTER TABLE "kit_item" ADD CONSTRAINT "kit_item_qty_ck" CHECK ("qty" > 0);
ALTER TABLE "kit" ADD CONSTRAINT "kit_price_ck" CHECK ("price" >= 0);
ALTER TABLE "sales_return_item" ADD CONSTRAINT "sales_return_item_qty_ck" CHECK ("qty" > 0);
ALTER TABLE "purchase_return_item" ADD CONSTRAINT "purchase_return_item_qty_ck" CHECK ("base_qty" > 0);
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_qty_ck" CHECK ("qty_change" <> 0);
ALTER TABLE "store_setting" ADD CONSTRAINT "store_setting_singleton_ck" CHECK ("id" = 1);

-- The audit log and the stock ledger are append-only.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
