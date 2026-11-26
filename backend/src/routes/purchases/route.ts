import { Type } from '@nestjs/common';
import { PurchaseController } from '../../controllers/purchases/controller';

/** /purchases/* — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const purchasesRoutes: Type<unknown>[] = [PurchaseController];
