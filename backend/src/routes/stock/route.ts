import { Type } from '@nestjs/common';
import { StockController } from '../../controllers/stock/controller';

/** /stock/* — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const stockRoutes: Type<unknown>[] = [StockController];
