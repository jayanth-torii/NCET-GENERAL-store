import { Type } from '@nestjs/common';
import { AdminController } from '../../controllers/admin/controller';

/** /users, /admin/*, /audit, /settings, /alerts — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const adminRoutes: Type<unknown>[] = [AdminController];
