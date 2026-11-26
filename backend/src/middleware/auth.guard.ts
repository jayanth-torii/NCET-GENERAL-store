import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../models/auth/model';
import { DbService } from '../config/db';
import { ALLOW_LOCKED, ALLOW_PASSWORD_CHANGE_PENDING, IS_PUBLIC, ROLES, SessionUser } from './auth.decorators';

export const SESSION_COOKIE = 'pos_session';

export interface JwtPayload {
  sub: number;
  sid: string; // server-side session id
  cid: number | null; // counter id
  tv: number; // token version: bumping it signs the user out everywhere
}

/**
 * Global guard. Every route needs a valid session unless marked @Public.
 * The session row and the user row are re-read on every request, so logging out, revoking a session,
 * deactivating a user, changing their role or resetting their password takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Please log in');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Your session has expired. Please log in again.');
    }
    if (!payload.sid) throw new UnauthorizedException('Please log in again.');

    const session = await this.db.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.sub) {
      throw new UnauthorizedException('Your session has ended. Please log in again.');
    }
    const user = session.user;
    if (!user.isActive || user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Your session has ended. Please log in again.');
    }
    // Keep "last seen" roughly current without writing on every request.
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      void this.db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }

    let counterCode: string | null = null;
    if (payload.cid) {
      const counter = await this.db.counter.findUnique({ where: { id: payload.cid } });
      if (!counter || !counter.isActive) throw new UnauthorizedException('This counter has been switched off. Please log in again.');
      counterCode = counter.code;
    }

    const su: SessionUser = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      counterId: payload.cid,
      counterCode,
      mustChangePassword: user.mustChangePassword,
      locked: user.lockedAt !== null,
      sessionId: session.id,
    };
    req.user = su;

    // Ctrl+L lock is enforced here, so clearing the browser cannot get round it.
    if (user.lockedAt && !this.reflector.getAllAndOverride<boolean>(ALLOW_LOCKED, targets)) {
      throw new HttpException({ message: 'This counter is locked. Enter your password to continue.', code: 'COUNTER_LOCKED' }, HttpStatus.LOCKED);
    }

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING, targets)) {
      throw new ForbiddenException({ message: 'Change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role does not allow this action');
    }
    return true;
  }
}
