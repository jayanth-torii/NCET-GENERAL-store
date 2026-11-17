import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.guard';

const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const SESSION_HOURS = 12;

export async function hashPassword(pw: string): Promise<string> {
  return hash(pw, ARGON);
}

export function checkPasswordStrength(pw: string): void {
  if (pw.length < 8) throw new BadRequestException('Password must be at least 8 characters');
  if (pw.length > 128) throw new BadRequestException('Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new BadRequestException('Password must contain letters and numbers');
}

/** Simple in-memory brute-force limit: 5 failed attempts per key in 10 minutes. */
class LoginLimiter {
  private readonly fails = new Map<string, { count: number; first: number }>();
  private readonly windowMs = 10 * 60 * 1000;
  private readonly max = 5;

  check(key: string) {
    const f = this.fails.get(key);
    if (!f) return;
    if (Date.now() - f.first > this.windowMs) {
      this.fails.delete(key);
      return;
    }
    if (f.count >= this.max) {
      const mins = Math.ceil((this.windowMs - (Date.now() - f.first)) / 60000);
      throw new HttpException(`Too many wrong passwords. Try again in ${mins} minute(s).`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
  fail(key: string) {
    const f = this.fails.get(key);
    if (!f || Date.now() - f.first > this.windowMs) this.fails.set(key, { count: 1, first: Date.now() });
    else f.count++;
  }
  clear(key: string) {
    this.fails.delete(key);
  }
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuthService {
  private readonly limiter = new LoginLimiter();
  // Used to spend the same time on unknown usernames as on wrong passwords.
  private readonly dummyHash: Promise<string> = hashPassword('dummy-password-0');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(username: string, password: string, counterId: number | null, ip: string, userAgent: string | null) {
    const uname = username.trim().toLowerCase();
    const key = `${uname}|${ip}`;
    this.limiter.check(key);

    const user = await this.prisma.appUser.findUnique({ where: { username: uname } });
    const ok = user ? await verify(user.passwordHash, password) : (await verify(await this.dummyHash, password), false);
    if (!user || !ok || !user.isActive) {
      this.limiter.fail(key);
      await this.audit.log({ userId: user?.id ?? null, action: 'LOGIN_FAILED', entity: 'user', entityId: uname, ip });
      // Same message whatever went wrong, so nothing about the account can be learned from the reply.
      throw new UnauthorizedException('Wrong username or password, or the account is switched off');
    }

    let counter = null;
    if (counterId) {
      counter = await this.prisma.counter.findUnique({ where: { id: counterId } });
      if (!counter || !counter.isActive) throw new BadRequestException('Choose an active counter');
    }
    if (user.role === Role.CASHIER && !counter) {
      throw new BadRequestException('Cashiers must choose a counter to log in');
    }

    this.limiter.clear(key);
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
    const session = await this.prisma.$transaction(async (tx) => {
      // A fresh login with the password also releases a counter lock.
      if (user.lockedAt) await tx.appUser.update({ where: { id: user.id }, data: { lockedAt: null } });
      return tx.session.create({ data: { userId: user.id, counterId: counter?.id ?? null, ip, userAgent: userAgent?.slice(0, 200) ?? null, expiresAt } });
    });
    const payload: JwtPayload = { sub: user.id, sid: session.id, cid: counter?.id ?? null, tv: user.tokenVersion };
    const token = await this.jwt.signAsync(payload, { expiresIn: `${SESSION_HOURS}h` });
    await this.audit.log({ userId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id, after: { counter: counter?.code ?? null, session: session.id }, ip });
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        counterId: counter?.id ?? null,
        counterCode: counter?.code ?? null,
        mustChangePassword: user.mustChangePassword,
        locked: false,
        sessionId: session.id,
      },
    };
  }

  /** Ends one session on the server. The cookie alone is then useless even if it was copied. */
  async logout(sessionId: string | null, userId: number | null, ip: string) {
    if (!sessionId) return;
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: 'LOGOUT' } });
    await this.audit.log({ userId, action: 'LOGOUT', entity: 'session', entityId: sessionId, ip });
  }

  /** Ends every session of a user (password change or reset, account switched off, admin action). */
  async revokeAll(userId: number, reason: string, tx?: Tx, except?: string) {
    const client = tx ?? this.prisma;
    await client.session.updateMany({
      where: { userId, revokedAt: null, ...(except ? { id: { not: except } } : {}) },
      data: { revokedAt: new Date(), revokedBy: reason },
    });
  }

  async revokeOne(sessionId: string, by: number, ip: string) {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s) throw new BadRequestException('Session not found');
    if (!s.revokedAt) await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokedBy: 'ADMIN' } });
    await this.audit.log({ userId: by, action: 'SESSION_REVOKE', entity: 'session', entityId: sessionId, ip, before: { userId: s.userId } });
  }

  listSessions(userId?: number) {
    return this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() }, ...(userId ? { userId } : {}) },
      orderBy: { lastSeenAt: 'desc' },
      include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
      take: 300,
    });
  }

  async lock(userId: number, ip: string) {
    await this.prisma.appUser.update({ where: { id: userId }, data: { lockedAt: new Date() } });
    await this.audit.log({ userId, action: 'COUNTER_LOCK', entity: 'user', entityId: userId, ip });
  }

  async verifyPassword(userId: number, password: string, ip: string): Promise<void> {
    const key = `unlock:${userId}|${ip}`;
    this.limiter.check(key);
    const user = await this.prisma.appUser.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verify(user.passwordHash, password))) {
      this.limiter.fail(key);
      throw new UnauthorizedException('Wrong password');
    }
    this.limiter.clear(key);
    if (user.lockedAt) {
      await this.prisma.appUser.update({ where: { id: userId }, data: { lockedAt: null } });
      await this.audit.log({ userId, action: 'COUNTER_UNLOCK', entity: 'user', entityId: userId, ip });
    }
  }

  async changePassword(userId: number, current: string, next: string, ip: string) {
    const user = await this.prisma.appUser.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verify(user.passwordHash, current))) throw new BadRequestException('Current password is wrong');
    checkPasswordStrength(next);
    if (current === next) throw new BadRequestException('Choose a password different from the current one');
    await this.prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(next), mustChangePassword: false, tokenVersion: { increment: 1 } },
      });
      await this.revokeAll(userId, 'PASSWORD_CHANGE', tx);
    });
    await this.audit.log({ userId, action: 'PASSWORD_CHANGE', entity: 'user', entityId: userId, ip });
  }
}
