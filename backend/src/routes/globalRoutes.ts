// Global route table: every URL under /api/v1, feature by feature (routes/<feature>/route.ts).
// Order matters: Nest matches routes in registration order, so reportsRoutes (which serves the
// /stock report URLs) must stay before stockRoutes.
// authRoutes is registered by config/auth.module.ts together with the global auth guard.
import { Type } from '@nestjs/common';
import { adminRoutes } from './admin/route';
import { dashboardRoutes } from './dashboard/route';
import { kitsRoutes } from './kits/route';
import { mastersRoutes } from './masters/route';
import { productsRoutes } from './products/route';
import { purchasesRoutes } from './purchases/route';
import { reportsRoutes } from './reports/route';
import { salesRoutes } from './sales/route';
import { stockRoutes } from './stock/route';

export const globalRoutes: Type<unknown>[] = [
  ...productsRoutes,
  ...mastersRoutes,
  ...kitsRoutes,
  ...salesRoutes,
  ...purchasesRoutes,
  ...reportsRoutes,
  ...stockRoutes,
  ...adminRoutes,
  ...dashboardRoutes,
];
