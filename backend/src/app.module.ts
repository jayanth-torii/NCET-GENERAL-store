import { DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'fs';
import { join } from 'path';
import { BackupService } from './services/backup/service';
import { StockCheckService } from './services/stockCheck/service';
import { AuthModule } from './config/auth.module';
import { ProductsService } from './services/products/service';
import { AuditModule } from './services/audit/service';
import { SettingsModule } from './services/settings/service';
import { DbModule } from './config/db.module';
import { PurchaseService } from './services/purchases/service';
import { ReportsService } from './services/reports/service';
import { SalesService } from './services/sales/service';
import { StockService } from './services/stock/service';
import { globalRoutes } from './routes/globalRoutes';

export const WEB_DIST = join(__dirname, '..', '..', 'frontend', 'dist');

function staticWeb(): DynamicModule[] {
  if (!existsSync(join(WEB_DIST, 'index.html'))) return [];
  return [ServeStaticModule.forRoot({ rootPath: WEB_DIST, exclude: ['/api/{*any}'] })];
}

@Module({
  imports: [DbModule, AuditModule, SettingsModule, AuthModule, ScheduleModule.forRoot(), ...staticWeb()],
  controllers: globalRoutes,
  providers: [ProductsService, SalesService, PurchaseService, StockService, ReportsService, StockCheckService, BackupService],
})
export class AppModule {}
