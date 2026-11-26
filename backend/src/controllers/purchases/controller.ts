import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClientIp, CurrentUser, R, Roles, SessionUser } from '../../middleware/auth.decorators';
import { parse, zReason } from '../../validators/validate';
import { PurchaseDraft, PurchaseService } from '../../services/purchases/service';
import { PurchaseHeader, PurchaseListQuery as ListQuery, PurchaseReturnInput } from '../../validators/purchases/validator';

/**
 * Maker / checker: a store keeper enters the supplier bill and marks it ready; a manager posts it to stock.
 * The person who typed the lines can never be the only person behind a stock increase.
 */
@Roles(...R.PURCHASE)
@Controller('purchases')
export class PurchaseController {
  constructor(private readonly purchases: PurchaseService) {}

  @Get()
  list(@Query() q: unknown) {
    return this.purchases.list(parse(ListQuery, q));
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: SessionUser) {
    return this.purchases.createDraft(parse(PurchaseHeader, body), user);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.purchases.detail(id);
  }

  /** Save lines, charges and the invoice total. Returns computed totals and the difference. */
  @Put(':id')
  save(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser) {
    return this.purchases.saveDraft(id, parse(PurchaseDraft, body), user);
  }

  /** Store keeper: the bill is complete and matches; a manager can now post it. */
  @Post(':id/ready')
  @HttpCode(200)
  ready(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.purchases.markReady(id, user, ip);
  }

  /** Manager: post to stock. 422 with the difference when totals do not match the supplier bill. */
  @Roles(...R.MANAGE)
  @Post(':id/post')
  @HttpCode(200)
  post(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.purchases.post(id, user, ip);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) {
    return this.purchases.deleteDraft(id, user);
  }

  @Roles(...R.MANAGE)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.purchases.cancel(id, parse(z.object({ reason: zReason }), body).reason, user, ip);
  }

  /** Goods going back to the supplier reduce stock, so a manager records them. */
  @Roles(...R.MANAGE)
  @Post(':id/returns')
  createReturn(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.purchases.createReturn(id, parse(PurchaseReturnInput, body), user, ip);
  }
}
