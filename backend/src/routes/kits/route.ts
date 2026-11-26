import { Type } from '@nestjs/common';
import { KitsController } from '../../controllers/kits/controller';

/** /kits/* — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const kitsRoutes: Type<unknown>[] = [KitsController];
