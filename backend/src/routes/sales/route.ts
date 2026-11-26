import { Type } from '@nestjs/common';
import { SalesController } from '../../controllers/sales/controller';

/** /sales/* — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const salesRoutes: Type<unknown>[] = [SalesController];
