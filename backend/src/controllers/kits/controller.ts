import { withTx } from '../../config/db';
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, R, Roles, SessionUser } from '../../middleware/auth.decorators';
import { AuditService } from '../../services/audit/service';
import { num } from '../../utils/money';
import { parse } from '../../validators/validate';
import { DbService } from '../../config/db';
import { KitBody } from '../../validators/kits/validator';

/** Section kits (FR-14): a bundle such as "Physics cycle lab kit" billed as one line. */

@Controller('kits')
export class KitsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query('all') all?: string) {
    return this.db.kit.findMany({
      where: all === 'true' ? {} : { isActive: true },
      include: { items: { include: { product: { select: { id: true, code: true, name: true, salePrice: true, isActive: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  private async validate(data: z.infer<typeof KitBody>) {
    const ids = data.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each product can appear only once in a kit');
    const products = await this.db.product.findMany({ where: { id: { in: ids } }, include: { unit: true } });
    if (products.length !== ids.length) throw new BadRequestException('One of the kit products does not exist');
    for (const p of products) {
      if (!p.isActive) throw new BadRequestException(`${p.name} is switched off and cannot be in a kit`);
      const q = data.items.find((i) => i.productId === p.id)!.qty;
      if (!p.unit.allowDecimal && !Number.isInteger(q)) throw new BadRequestException(`${p.name} must be a whole number of ${p.unit.code}`);
    }
  }

  @Roles(...R.MANAGE)
  @Post()
  async create(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const data = parse(KitBody, body);
    await this.validate(data);
    const kit = await this.db.kit.create({
      data: { code: data.code, name: data.name, price: num(data.price), isActive: data.isActive, items: { create: data.items.map((i) => ({ productId: i.productId, qty: num(i.qty) })) } },
      include: { items: true },
    });
    await this.audit.log({ userId: u.id, action: 'KIT_CREATE', entity: 'kit', entityId: kit.id, after: kit });
    return kit;
  }

  @Roles(...R.MANAGE)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const before = await this.db.kit.findUnique({ where: { id }, include: { items: true } });
    if (!before) throw new NotFoundException('Kit not found');
    const data = parse(KitBody, body);
    await this.validate(data);
    // Past bills keep their own snapshot of kit contents (sale_kit_component), so editing is safe.
    const kit = await withTx(this.db, async (tx) => {
      await tx.kitItem.deleteMany({ where: { kitId: id } });
      return tx.kit.update({
        where: { id },
        data: { code: data.code, name: data.name, price: num(data.price), isActive: data.isActive, items: { create: data.items.map((i) => ({ productId: i.productId, qty: num(i.qty) })) } },
        include: { items: true },
      });
    });
    await this.audit.log({ userId: u.id, action: 'KIT_UPDATE', entity: 'kit', entityId: id, before, after: kit });
    return kit;
  }
}
