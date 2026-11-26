import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, R, Roles, SessionUser } from '../../middleware/auth.decorators';
import { AuditService } from '../../services/audit/service';
import { parse } from '../../validators/validate';
import { DbService } from '../../config/db';
import { NameBody, UnitBody, SupplierBody, ChargeTypeBody, CounterBody } from '../../validators/masters/validator';

@Controller()
export class MastersController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ----- categories -----
  @Get('categories')
  categories() {
    return this.db.category.findMany({ orderBy: { name: 'asc' } });
  }
  @Roles(...R.MANAGE)
  @Post('categories')
  async createCategory(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.db.category.create({ data: parse(NameBody, body) });
    await this.audit.log({ userId: u.id, action: 'CATEGORY_CREATE', entity: 'category', entityId: c.id, after: c });
    return c;
  }
  @Roles(...R.MANAGE)
  @Patch('categories/:id')
  async updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.db.category.update({ where: { id }, data: parse(NameBody, body) });
    await this.audit.log({ userId: u.id, action: 'CATEGORY_UPDATE', entity: 'category', entityId: id, after: c });
    return c;
  }

  // ----- units -----
  @Get('units')
  units() {
    return this.db.unit.findMany({ orderBy: { code: 'asc' } });
  }
  @Roles(...R.ADMIN)
  @Post('units')
  async createUnit(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const x = await this.db.unit.create({ data: parse(UnitBody, body) });
    await this.audit.log({ userId: u.id, action: 'UNIT_CREATE', entity: 'unit', entityId: x.id, after: x });
    return x;
  }
  @Roles(...R.ADMIN)
  @Patch('units/:id')
  async updateUnit(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const x = await this.db.unit.update({ where: { id }, data: parse(UnitBody, body) });
    await this.audit.log({ userId: u.id, action: 'UNIT_UPDATE', entity: 'unit', entityId: id, after: x });
    return x;
  }

  // ----- suppliers -----
  @Roles(...R.PURCHASE)
  @Get('suppliers')
  suppliers(@Query('all') all?: string) {
    return this.db.supplier.findMany({ where: all === 'true' ? {} : { isActive: true }, orderBy: { name: 'asc' } });
  }
  /** New suppliers need a manager, so a purchase cannot be invented against a supplier nobody knows. */
  @Roles(...R.MANAGE)
  @Post('suppliers')
  async createSupplier(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const s = await this.db.supplier.create({ data: parse(SupplierBody, body) });
    await this.audit.log({ userId: u.id, action: 'SUPPLIER_CREATE', entity: 'supplier', entityId: s.id, after: s });
    return s;
  }
  @Roles(...R.MANAGE)
  @Patch('suppliers/:id')
  async updateSupplier(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const before = await this.db.supplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Supplier not found');
    const s = await this.db.supplier.update({ where: { id }, data: parse(SupplierBody, body) });
    await this.audit.log({ userId: u.id, action: 'SUPPLIER_UPDATE', entity: 'supplier', entityId: id, before, after: s });
    return s;
  }

  // ----- charge types (UR-3) -----
  @Roles(...R.PURCHASE)
  @Get('charge-types')
  chargeTypes(@Query('all') all?: string) {
    return this.db.chargeType.findMany({ where: all === 'true' ? {} : { isActive: true }, orderBy: { name: 'asc' } });
  }
  @Roles(...R.ADMIN)
  @Post('charge-types')
  async createChargeType(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.db.chargeType.create({ data: parse(ChargeTypeBody, body) });
    await this.audit.log({ userId: u.id, action: 'CHARGE_TYPE_CREATE', entity: 'charge_type', entityId: c.id, after: c });
    return c;
  }
  @Roles(...R.ADMIN)
  @Patch('charge-types/:id')
  async updateChargeType(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const before = await this.db.chargeType.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Charge type not found');
    const c = await this.db.chargeType.update({ where: { id }, data: parse(ChargeTypeBody, body) });
    await this.audit.log({ userId: u.id, action: 'CHARGE_TYPE_UPDATE', entity: 'charge_type', entityId: id, before, after: c });
    return c;
  }

  // ----- counters -----
  @Get('counters')
  counters() {
    return this.db.counter.findMany({ orderBy: { code: 'asc' } });
  }
  @Roles(...R.ADMIN)
  @Post('counters')
  async createCounter(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.db.counter.create({ data: parse(CounterBody, body) });
    await this.audit.log({ userId: u.id, action: 'COUNTER_CREATE', entity: 'counter', entityId: c.id, after: c });
    return c;
  }
  @Roles(...R.ADMIN)
  @Patch('counters/:id')
  async updateCounter(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const before = await this.db.counter.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Counter not found');
    const data = parse(CounterBody, body);
    if (data.code !== before.code && (await this.db.sale.count({ where: { counterId: id } })) > 0) {
      throw new BadRequestException('The code of a counter that already has bills cannot change, because it is part of the bill numbers');
    }
    const c = await this.db.counter.update({ where: { id }, data });
    await this.audit.log({ userId: u.id, action: 'COUNTER_UPDATE', entity: 'counter', entityId: id, before, after: c });
    return c;
  }
}
