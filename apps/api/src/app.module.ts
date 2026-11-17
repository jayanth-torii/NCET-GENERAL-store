import { DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { join } from 'path';
import { AdminController } from './admin/admin.controller';
import { DashboardController } from './admin/dashboard.controller';
import { StockCheckService } from './admin/stock-check.service';
import { AuthModule } from './auth/auth.module';
import { KitsController } from './catalogue/kits.controller';
import { MastersController } from './catalogue/masters.controller';
import { ProductsController } from './catalogue/products.controller';
import { ProductsService } from './catalogue/products.service';
import { AuditModule } from './common/audit.service';
import { SettingsModule } from './common/settings.service';
import { PrismaModule } from './prisma/prisma.service';
import { PurchaseController } from './purchase/purchase.controller';
import { PurchaseService } from './purchase/purchase.service';
import { ReportsController, StockReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SalesController } from './sales/sales.controller';
import { SalesService } from './sales/sales.service';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';

export const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');

function staticWeb(): DynamicModule[] {
  if (!existsSync(join(WEB_DIST, 'index.html'))) return [];
  return [ServeStaticModule.forRoot({ rootPath: WEB_DIST, exclude: ['/api/{*any}'] })];
}

@Module({
  imports: [PrismaModule, AuditModule, SettingsModule, AuthModule, ScheduleModule.forRoot(), ...staticWeb()],
  controllers: [
    ProductsController,
    MastersController,
    KitsController,
    SalesController,
    PurchaseController,
    StockReportsController,
    StockController,
    ReportsController,
    AdminController,
    DashboardController,
  ],
  providers: [ProductsService, SalesService, PurchaseService, StockService, ReportsService, StockCheckService],
})
export class AppModule {}
