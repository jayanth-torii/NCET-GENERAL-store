-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_ready_by_fkey" FOREIGN KEY ("ready_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
