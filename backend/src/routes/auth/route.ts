import { Type } from '@nestjs/common';
import { AuthController } from '../../controllers/auth/controller';

/** /auth/* (login, logout, me, change password, lock) — paths inside each prefix come from the controller's @Get/@Post/... decorators. */
export const authRoutes: Type<unknown>[] = [AuthController];
