import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { GstMode, Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { ClientIp, CurrentUser, R, Roles, SessionUser } from '../auth/auth.decorators';
import { AuthService, checkPasswordStrength, hashPassword } from '../auth/auth.service';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { istDate, istRange } from '../common/time';
import { parse, zDate, zOptText } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { StockCheckService } from './stock-check.service';

const UserCreate = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._]{2,29}$/, 'username: 3-30 letters, digits, dot or underscore, starting with a letter'),
  fullName: z.string().trim().min(2).max(60),
  role: z.nativeEnum(Role),
  password: z.string().min(1).max(128),
});
const UserUpdate = z.object({
  fullName: z.string().trim().min(2).max(60),
  role: z.nativeEnum(Role),
  isActive: z.boolean(),
});
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const SettingsBody = z
  .object({
    storeName: z.string().trim().min(2).max(60),
    addressLine: z.string().trim().min(2).max(200),
    phone: zOptText(30),
    gstin: z.string().trim().toUpperCase().optional().nullable().transform((v) => v || null),
    gstMode: z.nativeEnum(GstMode),
    receiptFooter: z.string().trim().max(200),
    blockNegativeStock: z.boolean(),
    roundBillToRupee: z.boolean(),
    maxCashierDiscount: z.coerce.number().min(0).max(100),
    upiId: z
      .string()
      .trim()
      .regex(/^$|^[A-Za-z0-9.\-_]{2,64}@[A-Za-z]{2,32}$/, 'UPI ID must look like storename@bank')
      .optional()
      .nullable()
      .transform((v) => v || null),
    upiPayeeName: zOptText(60),
    requireUpiReference: z.boolean().default(true),
    requireCardReference: z.boolean().default(false),
    autoLockMinutes: z.coerce.number().int().min(0).max(240).default(10),
    returnWindowDays: z.coerce.number().int().min(0).max(365).default(30),
  })
  .refine((s) => s.gstMode !== 'REGISTERED' || (s.gstin && GSTIN.test(s.gstin)), { message: 'A valid 15-character GSTIN is needed when the store is GST-registered', path: ['gstin'] })
  .refine((s) => !s.upiId || (s.upiPayeeName && s.upiPayeeName.length >= 2), { message: 'Enter the payee name shown in the customer\'s UPI app', path: ['upiPayeeName'] });

const userSelect = { id: true, username: true, fullName: true, role: true, isActive: true, mustChangePassword: true, createdAt: true } satisfies Prisma.AppUserSelect;

@Controller()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly stockCheck: StockCheckService,
    private readonly auth: AuthService,
  ) {}

  // ---------- users ----------
  @Roles(...R.MANAGE)
  @Get('users')
  users() {
    return this.prisma.appUser.findMany({ select: userSelect, orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }] });
  }

  @Roles(...R.ADMIN)
  @Post('users')
  async createUser(@Body() body: unknown, @CurrentUser() me: SessionUser, @ClientIp() ip: string) {
    const b = parse(UserCreate, body);
    checkPasswordStrength(b.password);
    const u = await this.prisma.appUser.create({
      data: { username: b.username, fullName: b.fullName, role: b.role, passwordHash: await hashPassword(b.password), mustChangePassword: true },
      select: userSelect,
    });
    await this.audit.log({ userId: me.id, action: 'USER_CREATE', entity: 'user', entityId: u.id, after: u, ip });
    return u;
  }

  private async assertAdminRemains(changingId: number, nextRole: Role, nextActive: boolean) {
    if (nextRole === Role.ADMIN && nextActive) return;
    const others = await this.prisma.appUser.count({ where: { role: Role.ADMIN, isActive: true, id: { not: changingId } } });
    if (others === 0) throw new BadRequestException('There must always be at least one active admin');
  }

  @Roles(...R.ADMIN)
  @Patch('users/:id')
  async updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() me: SessionUser, @ClientIp() ip: string) {
    const b = parse(UserUpdate, body);
    const before = await this.prisma.appUser.findUnique({ where: { id }, select: userSelect });
    if (!before) throw new NotFoundException('User not found');
    if (id === me.id && (!b.isActive || b.role !== me.role)) throw new BadRequestException('You cannot switch off or change the role of your own account');
    await this.assertAdminRemains(id, b.role, b.isActive);
    const roleOrActiveChanged = before.role !== b.role || before.isActive !== b.isActive;
    const u = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.appUser.update({
        where: { id },
        data: { ...b, ...(roleOrActiveChanged ? { tokenVersion: { increment: 1 } } : {}) },
        select: userSelect,
      });
      if (roleOrActiveChanged) await this.auth.revokeAll(id, b.isActive ? 'ROLE_CHANGE' : 'USER_DISABLED', tx);
      return updated;
    });
    await this.audit.log({ userId: me.id, action: 'USER_UPDATE', entity: 'user', entityId: id, before, after: u, ip });
    return u;
  }

  /** Sets a temporary password, signs the user out everywhere, and forces a change at next login. */
  @Roles(...R.ADMIN)
  @Post('users/:id/reset-password')
  @HttpCode(200)
  async resetPassword(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() me: SessionUser, @ClientIp() ip: string) {
    const b = parse(z.object({ password: z.string().min(1).max(128) }), body);
    checkPasswordStrength(b.password);
    const hashed = await hashPassword(b.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.appUser.update({ where: { id }, data: { passwordHash: hashed, mustChangePassword: true, tokenVersion: { increment: 1 } } });
      await this.auth.revokeAll(id, 'PASSWORD_RESET', tx);
    });
    await this.audit.log({ userId: me.id, action: 'USER_PASSWORD_RESET', entity: 'user', entityId: id, ip });
    return { ok: true };
  }

  // ---------- settings ----------
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Roles(...R.ADMIN)
  @Put('settings')
  async putSettings(@Body() body: unknown, @CurrentUser() me: SessionUser, @ClientIp() ip: string) {
    const b = parse(SettingsBody, body);
    const before = await this.settings.get();
    const after = await this.prisma.storeSetting.update({ where: { id: 1 }, data: b });
    this.settings.invalidate();
    await this.audit.log({ userId: me.id, action: 'SETTINGS_UPDATE', entity: 'settings', entityId: 1, before, after, ip });
    return after;
  }

  // ---------- audit log ----------
  @Roles(...R.MANAGE)
  @Get('audit')
  async auditLog(@Query() q: unknown) {
    const p = parse(
      z.object({
        from: zDate.default(() => istDate()),
        to: zDate.default(() => istDate()),
        action: z.string().trim().max(40).optional(),
        userId: z.coerce.number().int().positive().optional(),
        entity: z.string().trim().max(40).optional(),
        entityId: z.string().trim().max(40).optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      q,
    );
    const r = istRange(p.from, p.to);
    const where: Prisma.AuditLogWhereInput = {
      createdAt: { gte: r.start, lt: r.end },
      ...(p.action ? { action: p.action } : {}),
      ...(p.userId ? { userId: p.userId } : {}),
      ...(p.entity ? { entity: p.entity } : {}),
      ...(p.entityId ? { entityId: p.entityId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p.page - 1) * 200, take: 200, include: { user: { select: { fullName: true, username: true } } } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { rows, total, page: p.page, pageSize: 200 };
  }

  // ---------- alerts and checks ----------
  @Roles(...R.MANAGE)
  @Get('alerts')
  alerts() {
    return this.prisma.systemAlert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  @Roles(...R.ADMIN)
  @Post('alerts/:id/resolve')
  @HttpCode(200)
  async resolve(@Param('id', ParseIntPipe) id: number, @CurrentUser() me: SessionUser) {
    const a = await this.prisma.systemAlert.update({ where: { id }, data: { resolvedAt: new Date() } });
    await this.audit.log({ userId: me.id, action: 'ALERT_RESOLVE', entity: 'alert', entityId: id });
    return a;
  }

  @Roles(...R.ADMIN)
  @Post('admin/stock-check')
  @HttpCode(200)
  runCheck() {
    return this.stockCheck.run();
  }
}
