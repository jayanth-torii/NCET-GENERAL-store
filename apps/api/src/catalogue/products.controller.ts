import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, R, Roles, SessionUser } from '../auth/auth.decorators';
import { parse } from '../common/validate';
import { ProductInput, ProductsService } from './products.service';

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Cashiers can look products up but never see what the store paid for them. */
  private showCost(user: SessionUser) {
    return R.PURCHASE.includes(user.role);
  }

  @Get()
  list(@Query() query: unknown, @CurrentUser() user: SessionUser) {
    return this.products.list(parse(ListQuery, query), this.showCost(user));
  }

  @Get('catalogue')
  catalogue(@CurrentUser() user: SessionUser, @Query('since') since?: string) {
    const d = since ? new Date(since) : undefined;
    if (d && Number.isNaN(d.getTime())) throw new BadRequestException('since must be an ISO timestamp');
    return this.products.catalogue(d, this.showCost(user));
  }

  @Get('quick-keys')
  quickKeys() {
    return this.products.quickKeys();
  }

  @Roles(...R.MANAGE)
  @Get('export')
  async export(@Res() res: Response) {
    const buf = await this.products.exportXlsx();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
    res.send(buf);
  }

  @Roles(...R.MANAGE)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  import(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: SessionUser) {
    if (!file) throw new BadRequestException('Attach an .xlsx file in the "file" field');
    return this.products.importXlsx(file.buffer, user);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) {
    return this.products.get(id, this.showCost(user));
  }

  @Roles(...R.PURCHASE)
  @Post()
  create(@Body() body: unknown, @CurrentUser() user: SessionUser) {
    return this.products.create(parse(ProductInput, body), user);
  }

  @Roles(...R.PURCHASE)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: SessionUser) {
    return this.products.update(id, parse(ProductInput, body), user);
  }

  @Roles(...R.MANAGE)
  @Post(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) {
    return this.products.setActive(id, false, user);
  }

  @Roles(...R.MANAGE)
  @Post(':id/activate')
  activate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) {
    return this.products.setActive(id, true, user);
  }
}
