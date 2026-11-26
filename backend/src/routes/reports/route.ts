import { Type } from '@nestjs/common';
import { ReportsController, StockReportsController } from '../../controllers/reports/controller';

/** /stock/* reports and /reports/* — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const reportsRoutes: Type<unknown>[] = [StockReportsController, ReportsController];
