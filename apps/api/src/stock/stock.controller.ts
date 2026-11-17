import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdjustmentStatus } from '@prisma/client';
import { z } from 'zod';
import { ClientIp, CurrentUser, R, Roles, SessionUser } from '../auth/auth.decorators';
import { parse, zOptText, zReason } from '../common/validate';
import { StockService } from './stock.service';

const AdjustBody = z
  .object({
    productId: z.coerce.number().int().positive(),
    qtyChange: z.coerce.number().finite().min(-9_999_999).max(9_999_999).optional(),
    countedQty: z.coerce.number().finite().min(0).max(9_999_999).optional(),
    reason: zReason,
  })
  .refine((b) => (b.qtyChange === undefined) !== (b.countedQty === undefined), 'Give either the change or the counted quantity');

@Roles(...R.STOCK_VIEW)
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('low')
  low() {
    return this.stock.lowAndNegative();
  }

  @Get('adjustments')
  adjustments(@Query('status') status?: string) {
    const s = status ? parse(z.nativeEnum(AdjustmentStatus), status) : undefined;
    return this.stock.listAdjustments(s);
  }

  @Post('adjustments')
  adjust(@Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    return this.stock.createAdjustment(parse(AdjustBody, body), user, ip);
  }

  @Roles(...R.MANAGE)
  @Post('adjustments/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    const b = parse(z.object({ note: zOptText(200) }), body ?? {});
    return this.stock.decideAdjustment(id, true, b.note, user, ip);
  }

  @Roles(...R.MANAGE)
  @Post('adjustments/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    const b = parse(z.object({ note: zOptText(200) }), body ?? {});
    return this.stock.decideAdjustment(id, false, b.note, user, ip);
  }

  @Roles(...R.ADMIN)
  @Post('opening-import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  openingImport(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser, @ClientIp() ip: string) {
    if (!file) throw new BadRequestException('Attach an .xlsx file in the "file" field');
    return this.stock.importOpeningCount(file.buffer, user, ip);
  }
}
