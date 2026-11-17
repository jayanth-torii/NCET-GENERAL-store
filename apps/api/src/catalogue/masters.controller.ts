import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ChargeAllocation } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, R, Roles, SessionUser } from '../auth/auth.decorators';
import { AuditService } from '../common/audit.service';
import { parse, zOptText } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';

const NameBody = z.object({ name: z.string().trim().min(2).max(60) });
const UnitBody = z.object({
  code: z.string().trim().toUpperCase().min(1).max(8).regex(/^[A-Z0-9]+$/, 'use letters and digits only'),
  name: z.string().trim().min(2).max(40),
  allowDecimal: z.boolean().default(false),
});
const SupplierBody = z.object({
  name: z.string().trim().min(2).max(120),
  phone: zOptText(20),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN must be 15 characters like 29ABCDE1234F1Z5')
    .optional()
    .nullable()
    .transform((v) => v || null),
  address: zOptText(300),
  isActive: z.boolean().default(true),
});
const ChargeTypeBody = z.object({
  name: z.string().trim().min(2).max(40),
  addsToCost: z.boolean().default(true),
  allocation: z.nativeEnum(ChargeAllocation).default(ChargeAllocation.BY_VALUE),
  isActive: z.boolean().default(true),
});
const CounterBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,5}$/, 'code must start with a letter, e.g. C1'),
  name: z.string().trim().min(2).max(40),
  printerName: zOptText(80),
  isActive: z.boolean().default(true),
});

@Controller()
export class MastersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----- categories -----
  @Get('categories')
  categories() {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }
  @Roles(...R.MANAGE)
  @Post('categories')
  async createCategory(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.prisma.category.create({ data: parse(NameBody, body) });
    await this.audit.log({ userId: u.id, action: 'CATEGORY_CREATE', entity: 'category', entityId: c.id, after: c });
    return c;
  }
  @Roles(...R.MANAGE)
  @Patch('categories/:id')
  async updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.prisma.category.update({ where: { id }, data: parse(NameBody, body) });
    await this.audit.log({ userId: u.id, action: 'CATEGORY_UPDATE', entity: 'category', entityId: id, after: c });
    return c;
  }

  // ----- units -----
  @Get('units')
  units() {
    return this.prisma.unit.findMany({ orderBy: { code: 'asc' } });
  }
  @Roles(...R.ADMIN)
  @Post('units')
  async createUnit(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const x = await this.prisma.unit.create({ data: parse(UnitBody, body) });
    await this.audit.log({ userId: u.id, action: 'UNIT_CREATE', entity: 'unit', entityId: x.id, after: x });
    return x;
  }
  @Roles(...R.ADMIN)
  @Patch('units/:id')
  async updateUnit(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const x = await this.prisma.unit.update({ where: { id }, data: parse(UnitBody, body) });
    await this.audit.log({ userId: u.id, action: 'UNIT_UPDATE', entity: 'unit', entityId: id, after: x });
    return x;
  }

  // ----- suppliers -----
  @Roles(...R.PURCHASE)
  @Get('suppliers')
  suppliers(@Query('all') all?: string) {
    return this.prisma.supplier.findMany({ where: all === 'true' ? {} : { isActive: true }, orderBy: { name: 'asc' } });
  }
  /** New suppliers need a manager, so a purchase cannot be invented against a supplier nobody knows. */
  @Roles(...R.MANAGE)
  @Post('suppliers')
  async createSupplier(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const s = await this.prisma.supplier.create({ data: parse(SupplierBody, body) });
    await this.audit.log({ userId: u.id, action: 'SUPPLIER_CREATE', entity: 'supplier', entityId: s.id, after: s });
    return s;
  }
  @Roles(...R.MANAGE)
  @Patch('suppliers/:id')
  async updateSupplier(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const before = await this.prisma.supplier.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Supplier not found');
    const s = await this.prisma.supplier.update({ where: { id }, data: parse(SupplierBody, body) });
    await this.audit.log({ userId: u.id, action: 'SUPPLIER_UPDATE', entity: 'supplier', entityId: id, before, after: s });
    return s;
  }

  // ----- charge types (UR-3) -----
  @Roles(...R.PURCHASE)
  @Get('charge-types')
  chargeTypes(@Query('all') all?: string) {
    return this.prisma.chargeType.findMany({ where: all === 'true' ? {} : { isActive: true }, orderBy: { name: 'asc' } });
  }
  @Roles(...R.ADMIN)
  @Post('charge-types')
  async createChargeType(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.prisma.chargeType.create({ data: parse(ChargeTypeBody, body) });
    await this.audit.log({ userId: u.id, action: 'CHARGE_TYPE_CREATE', entity: 'charge_type', entityId: c.id, after: c });
    return c;
  }
  @Roles(...R.ADMIN)
  @Patch('charge-types/:id')
  async updateChargeType(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const before = await this.prisma.chargeType.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Charge type not found');
    const c = await this.prisma.chargeType.update({ where: { id }, data: parse(ChargeTypeBody, body) });
    await this.audit.log({ userId: u.id, action: 'CHARGE_TYPE_UPDATE', entity: 'charge_type', entityId: id, before, after: c });
    return c;
  }

  // ----- counters -----
  @Get('counters')
  counters() {
    return this.prisma.counter.findMany({ orderBy: { code: 'asc' } });
  }
  @Roles(...R.ADMIN)
  @Post('counters')
  async createCounter(@Body() body: unknown, @CurrentUser() u: SessionUser) {
    const c = await this.prisma.counter.create({ data: parse(CounterBody, body) });
    await this.audit.log({ userId: u.id, action: 'COUNTER_CREATE', entity: 'counter', entityId: c.id, after: c });
    return c;
  }
  @Roles(...R.ADMIN)
  @Patch('counters/:id')
  async updateCounter(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() u: SessionUser) {
    const before = await this.prisma.counter.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Counter not found');
    const data = parse(CounterBody, body);
    if (data.code !== before.code && (await this.prisma.sale.count({ where: { counterId: id } })) > 0) {
      throw new BadRequestException('The code of a counter that already has bills cannot change, because it is part of the bill numbers');
    }
    const c = await this.prisma.counter.update({ where: { id }, data });
    await this.audit.log({ userId: u.id, action: 'COUNTER_UPDATE', entity: 'counter', entityId: id, before, after: c });
    return c;
  }
}
