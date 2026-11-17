import { Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, R, Roles, SessionUser } from '../auth/auth.decorators';
import { fyCode, istDate } from '../common/time';
import { parse, zDate, zFormat } from '../common/validate';
import { ReportsService } from './reports.service';

const today = () => istDate();
const monthStart = () => `${istDate().slice(0, 8)}01`;
const defaultFy = () => {
  const c = fyCode();
  return `20${c.slice(0, 2)}-${c.slice(3)}`;
};

const RangeQ = z.object({
  from: zDate.default(monthStart),
  to: zDate.default(today),
  format: zFormat,
  counterId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
});

const StockQ = z.object({
  from: zDate.default(monthStart),
  to: zDate.default(today),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(60).optional(),
  belowReorderOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  format: zFormat,
});

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Daily report. Cashiers get their own bills for today only (permission table: "Own day"). */
  @Get('sales/daily')
  async daily(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(z.object({ date: zDate.default(today), format: zFormat }), q);
    if (user.role === Role.STORE_KEEPER) throw new ForbiddenException('Store keepers can view stock reports only');
    const ownOnly = user.role === Role.CASHIER;
    if (ownOnly && p.date !== today()) throw new ForbiddenException('Cashiers can only see today');
    return this.reports.send(res, await this.reports.daily(p.date, user, ownOnly), p.format);
  }

  @Roles(...R.MANAGE)
  @Get('sales/monthly')
  async monthly(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(() => istDate().slice(0, 7)), format: zFormat }), q);
    return this.reports.send(res, await this.reports.monthly(p.month, user), p.format);
  }

  @Roles(...R.MANAGE)
  @Get('sales/register')
  async register(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(RangeQ, q);
    return this.reports.send(res, await this.reports.salesRegister(p.from, p.to, user, p), p.format);
  }

  @Roles(...R.MANAGE)
  @Get('purchases/register')
  async purchaseRegister(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(RangeQ, q);
    return this.reports.send(res, await this.reports.purchaseRegister(p.from, p.to, user, p.supplierId), p.format);
  }

  @Roles(...R.STOCK_VIEW)
  @Get('stock/summary')
  async stockSummary(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(StockQ, q);
    return this.reports.send(res, await this.reports.stockSummary(p, user), p.format);
  }

  @Roles(...R.STOCK_VIEW)
  @Get('stock/yearly')
  async yearly(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).default(defaultFy), categoryId: z.coerce.number().int().positive().optional(), format: zFormat }), q);
    return this.reports.send(res, await this.reports.yearlyStock(p.fy, user, p.categoryId), p.format);
  }

  @Roles(...R.STOCK_VIEW)
  @Get('stock/low')
  async low(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(z.object({ format: zFormat }), q);
    return this.reports.send(res, await this.reports.lowStock(user), p.format);
  }

  @Roles(...R.STOCK_VIEW)
  @Get('stock/dead')
  async dead(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(z.object({ days: z.coerce.number().int().min(7).max(730).default(90), format: zFormat }), q);
    return this.reports.send(res, await this.reports.deadStock(p.days, user), p.format);
  }
}

/** Blueprint paths /stock/summary and /stock/movements, backed by the same reports. */
@Roles(...R.STOCK_VIEW)
@Controller('stock')
export class StockReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  async summary(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(StockQ, q);
    return this.reports.send(res, await this.reports.stockSummary(p, user), p.format);
  }

  @Get('movements')
  async movements(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(z.object({ product: z.coerce.number().int().positive(), from: zDate.default(monthStart), to: zDate.default(today), format: zFormat }), q);
    return this.reports.send(res, await this.reports.movements(p.product, p.from, p.to, user), p.format);
  }
}
