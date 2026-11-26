import { BadRequestException, Controller, ForbiddenException, Get, Query, Res } from '@nestjs/common';
import { Role } from '../../models/auth/model';
import { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, R, Roles, SessionUser } from '../../middleware/auth.decorators';
import { fyCode, istDate } from '../../utils/time';
import { parse, zDate, zFormat } from '../../validators/validate';
import { ReportsService } from '../../services/reports/service';
import { RangeQ, StockQ } from '../../validators/reports/validator';

const today = () => istDate();
const monthStart = () => `${istDate().slice(0, 8)}01`;
const defaultFy = () => {
  const c = fyCode();
  return `20${c.slice(0, 2)}-${c.slice(3)}`;
};

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

  /** FR-14: kit sales per section. */
  @Roles(...R.MANAGE)
  @Get('kits')
  async kits(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(RangeQ, q);
    return this.reports.send(res, await this.reports.kitSales(p.from, p.to, user), p.format);
  }

  /** FR-14: printable class order sheet for one kit. */
  @Roles(...R.MANAGE)
  @Get('kits/order-sheet')
  async kitOrderSheet(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(
      z.object({
        kit: z.coerce.number().int().positive(),
        section: z.string().trim().max(40).default(''),
        students: z.coerce.number().int().min(1).max(200).default(60),
        format: zFormat,
      }),
      q,
    );
    return this.reports.send(res, await this.reports.kitOrderSheet(p.kit, p.section, p.students, user), p.format);
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
  @Get('stock/expiry')
  async expiry(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(
      z.object({
        days: z.coerce.number().int().min(0).max(730).default(90),
        inStock: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
        format: zFormat,
      }),
      q,
    );
    return this.reports.send(res, await this.reports.expiry(p.days, p.inStock, user), p.format);
  }

  /** GST input register: tax on purchases (GRNs) less debit notes. */
  @Roles(...R.MANAGE)
  @Get('gst/input')
  async gstInput(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(RangeQ, q);
    if (p.from > p.to) throw new BadRequestException('The start date is after the end date');
    return this.reports.send(res, await this.reports.gstInput(p.from, p.to, user), p.format);
  }

  /** GST output register: tax on sales bills less credit notes. */
  @Roles(...R.MANAGE)
  @Get('gst/output')
  async gstOutput(@Query() q: unknown, @CurrentUser() user: SessionUser, @Res() res: Response) {
    const p = parse(RangeQ, q);
    if (p.from > p.to) throw new BadRequestException('The start date is after the end date');
    return this.reports.send(res, await this.reports.gstOutput(p.from, p.to, user), p.format);
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
