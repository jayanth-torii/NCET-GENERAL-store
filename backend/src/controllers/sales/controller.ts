import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { ClientIp, CurrentUser, R, Roles, SessionUser } from '../../middleware/auth.decorators';
import { SettingsService } from '../../services/settings/service';
import { parse, zReason } from '../../validators/validate';
import { receiptHtml, receiptPdf } from '../../utils/receipt';
import { SalesService } from '../../services/sales/service';
import { ReturnInput, SaleInput, SaleListQuery as ListQuery, UUID } from '../../validators/sales/validator';

function bigId(v: string): bigint {
  if (!/^\d{1,15}$/.test(v)) throw new BadRequestException('Invalid bill id');
  return BigInt(v);
}

@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly settings: SettingsService,
  ) {}

  /** Save a bill. Header Idempotency-Key (a UUID made once per bill by the screen) is required. */
  @Roles(...R.BILLING)
  @Post()
  create(@Body() body: unknown, @CurrentUser() user: SessionUser, @Headers('idempotency-key') key?: string) {
    if (!key || !UUID.test(key)) throw new BadRequestException('Idempotency-Key header with a UUID is required');
    return this.sales.create(parse(SaleInput, body), user, key.toLowerCase());
  }

  @Roles(...R.BILLING)
  @Get('held')
  held(@CurrentUser() user: SessionUser) {
    return this.sales.listHeld(user);
  }

  @Roles(...R.BILLING)
  @Post('held')
  hold(@Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    const b = parse(z.object({ label: z.string().max(60).optional(), payload: z.unknown() }), body);
    return this.sales.hold(user, b.label, b.payload, ip);
  }

  @Roles(...R.BILLING)
  @Delete('held/:id')
  deleteHeld(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.sales.deleteHeld(id, user, ip);
  }

  @Roles(...R.BILLING)
  @Get('last')
  last(@CurrentUser() user: SessionUser) {
    return this.sales.lastBillOfCounter(user);
  }

  /** Sales register. Cashiers see only their own bills of today; store keepers do not see sales at all. */
  @Roles(...R.BILLING)
  @Get()
  list(@Query() query: unknown, @CurrentUser() user: SessionUser) {
    return this.sales.list(parse(ListQuery, query), user);
  }

  @Roles(...R.BILLING)
  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.sales.detail(bigId(id), user);
  }

  /**
   * 80 mm receipt (html, for silent printing) or PDF (80 mm or A4). The server counts prints:
   * the first is the original, every later one carries a DUPLICATE stamp and is logged.
   */
  @Roles(...R.BILLING)
  @Get(':id/receipt')
  async receipt(@Param('id') id: string, @Query('format') format: string = 'html', @Query('size') size: string = '80mm', @CurrentUser() user: SessionUser, @ClientIp() ip: string, @Res() res: Response) {
    if (format !== 'html' && format !== 'pdf') throw new BadRequestException('format must be html or pdf');
    const { sale, stamp } = await this.sales.receiptFor(bigId(id), user, ip);
    const s = await this.settings.get();
    if (format === 'pdf') {
      const buf = await receiptPdf(sale, s, size === 'a4' ? 'a4' : '80mm', stamp);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="bill_${sale.billNo.replace(/\//g, '-')}.pdf"`);
      return res.send(buf);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(receiptHtml(sale, s, { stamp }));
  }

  @Roles(...R.MANAGE)
  @Patch(':id')
  edit(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.sales.edit(bigId(id), parse(SaleInput, body), user, ip);
  }

  @Roles(...R.MANAGE)
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    const b = parse(z.object({ reason: zReason }), body);
    return this.sales.cancel(bigId(id), b.reason, user, ip);
  }

  @Roles(...R.MANAGE)
  @Post(':id/returns')
  createReturn(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.sales.createReturn(bigId(id), parse(ReturnInput, body), user, ip);
  }
}
