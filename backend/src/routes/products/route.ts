import { Type } from '@nestjs/common';
import { ProductsController } from '../../controllers/products/controller';

/** /products/* — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const productsRoutes: Type<unknown>[] = [ProductsController];
