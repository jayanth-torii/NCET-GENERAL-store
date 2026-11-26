import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../../validators/validate';
import { PrismaService } from '../../config/prisma.service';
import { AllowLocked, AllowPasswordChangePending, ClientIp, CurrentUser, Public, R, Roles, SessionUser } from '../../middleware/auth.decorators';
import { JwtPayload, SESSION_COOKIE } from '../../middleware/auth.guard';
import { AuthService, SESSION_HOURS } from '../../services/auth/service';
import { fmtDate, fmtDateTime, fyCode, istDate } from '../../utils/time';
import { JwtService } from '@nestjs/jwt';
import { LoginBody } from '../../validators/auth/validator';

interface ShowcaseItem {
  name: string;
  category: string;
  price: number;
  inStock: boolean;
}

@Controller('auth')
export class AuthController {
  private showcaseCache: { at: number; value: { storeName: string; total: number; items: ShowcaseItem[] } } | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Counters to choose from on the login screen. */
  @Public()
  @Get('counters')
  counters() {
    return this.prisma.counter.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
  }

  /**
   * Landing page: what the store sells, with the shelf price and whether it is in stock right now.
   * No costs, quantities or margins. Cached for a minute so the public page cannot load the database.
   */
  @Public()
  @Get('showcase')
  async showcase() {
    if (this.showcaseCache && Date.now() - this.showcaseCache.at < 60_000) return this.showcaseCache.value;
    const [items, settings] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true },
        select: { name: true, salePrice: true, category: { select: { name: true } }, stock: { select: { onHand: true } } },
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
        take: 500,
      }),
      this.prisma.storeSetting.findUnique({ where: { id: 1 }, select: { storeName: true } }),
    ]);
    const value = {
      storeName: settings?.storeName ?? 'GENERAL STORE',
      total: items.length,
      items: items.map((i) => ({ name: i.name, category: i.category.name, price: Number(i.salePrice), inStock: Number(i.stock?.onHand ?? 0) > 0 })),
    };
    this.showcaseCache = { at: Date.now(), value };
    return value;
  }

  /** Server clock. The client shows this and never sends its own date. */
  @Public()
  @Get('time')
  time() {
    const now = new Date();
    return { iso: now.toISOString(), date: istDate(now), display: fmtDateTime(now), displayDate: fmtDate(now), fy: fyCode(now) };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @ClientIp() ip: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const b = parse(LoginBody, body);
    const { token, user } = await this.auth.login(b.username, b.password, b.counterId ?? null, ip, req.headers['user-agent'] ?? null);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: SESSION_HOURS * 60 * 60 * 1000,
      path: '/',
    });
    return user;
  }

  /** Ends the session on the server as well as clearing the cookie. Works even when the session is already gone. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token).catch(() => null);
      if (payload?.sid) await this.auth.logout(payload.sid, payload.sub, ip);
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @AllowPasswordChangePending()
  @AllowLocked()
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return user;
  }

  /** Ctrl+L or the idle timer: lock this user's counter. The server refuses every other request until the password is entered. */
  @Post('lock')
  @HttpCode(200)
  async lock(@CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    await this.auth.lock(user.id, ip);
    return { ok: true };
  }

  /** Unlock a counter that was locked with Ctrl+L. */
  @AllowLocked()
  @Post('verify-password')
  @HttpCode(200)
  async verify(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string) {
    const b = parse(z.object({ password: z.string().min(1).max(128) }), body);
    await this.auth.verifyPassword(user.id, b.password, ip);
    return { ok: true };
  }

  /** Changing the password ends every session of this user, including this one. */
  @AllowPasswordChangePending()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const b = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }), body);
    await this.auth.changePassword(user.id, b.currentPassword, b.newPassword, ip);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, message: 'Password changed. Please log in with the new password.' };
  }

  /** Who is logged in right now (admin and manager). */
  @Roles(...R.MANAGE)
  @Get('sessions')
  sessions(@Query('userId') userId?: string) {
    return this.auth.listSessions(userId ? Number(userId) : undefined);
  }

  /** Admin ends someone else's session (a counter left logged in, a leaver's account). */
  @Roles(...R.ADMIN)
  @Post('sessions/:id/revoke')
  @HttpCode(200)
  async revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() me: SessionUser, @ClientIp() ip: string) {
    await this.auth.revokeOne(id, me.id, ip);
    return { ok: true };
  }
}
