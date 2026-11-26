import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../models/auth/model';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const ALLOW_PASSWORD_CHANGE_PENDING = 'allowPwdPending';

/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is limited to these roles. Routes without @Roles are open to any logged-in user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Route stays reachable while the user still has to change their initial password. */
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING, true);

export const ALLOW_LOCKED = 'allowLocked';
/** Route stays reachable while the counter is locked (only me, unlock and logout). */
export const AllowLocked = () => SetMetadata(ALLOW_LOCKED, true);

export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  counterId: number | null;
  counterCode: string | null;
  mustChangePassword: boolean;
  locked: boolean;
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => {
  return ctx.switchToHttp().getRequest().user as SessionUser;
});

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return (req.ip as string) ?? '';
});

/** Shorthand role groups that match the blueprint's permission table (section 20). */
export const R = {
  BILLING: [Role.ADMIN, Role.MANAGER, Role.CASHIER] as Role[],
  MANAGE: [Role.ADMIN, Role.MANAGER] as Role[],
  PURCHASE: [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER] as Role[],
  ADMIN: [Role.ADMIN] as Role[],
  STOCK_VIEW: [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER] as Role[],
};
