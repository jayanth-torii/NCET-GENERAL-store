import { Type } from '@nestjs/common';
import { DashboardController } from '../../controllers/dashboard/controller';

/** /dashboard/* — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const dashboardRoutes: Type<unknown>[] = [DashboardController];
