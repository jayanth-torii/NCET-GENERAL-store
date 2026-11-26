-- GRN: new selling price and MRP per purchase line, applied to the product when the GRN is posted.
ALTER TABLE "purchase_item" ADD COLUMN "sale_price" DECIMAL(12,2);
ALTER TABLE "purchase_item" ADD COLUMN "mrp" DECIMAL(12,2);
-- Expiry report reads purchase lines by expiry date.
CREATE INDEX "purchase_item_expiry_idx" ON "purchase_item"("expiry") WHERE "expiry" IS NOT NULL;
