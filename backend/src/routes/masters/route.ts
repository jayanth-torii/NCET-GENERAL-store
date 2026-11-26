import { Type } from '@nestjs/common';
import { MastersController } from '../../controllers/masters/controller';

/** /categories, /units, /suppliers, /counters, /charge-types — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const mastersRoutes: Type<unknown>[] = [MastersController];
