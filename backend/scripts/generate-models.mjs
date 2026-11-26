// One-off generator used for the Prisma -> Mongoose switch: turns the schema metadata (datamodel + live
// index list, dumped to JSON) into src/models/<feature>/model.ts files. Kept for reference; the model files
// are now the source of truth and are edited by hand.
//   node scripts/generate-models.mjs <meta.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'models');
const meta = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { models, enums } = meta.datamodel;

const GROUPS = {
  auth: { title: 'Users and login sessions.', names: ['Role', 'AppUser', 'Session'] },
  masters: { title: 'Masters: counters, categories, units, suppliers, purchase charge types.', names: ['ChargeAllocation', 'Counter', 'Category', 'Unit', 'Supplier', 'ChargeType'] },
  products: { title: 'Product master and the cached stock balance per product.', names: ['Product', 'ProductStock'] },
  stock: { title: 'Append-only stock ledger and manager-approved stock adjustments.', names: ['MovementKind', 'AdjustmentStatus', 'StockMovement', 'StockAdjustment'] },
  purchases: { title: 'Purchases (GRN): header, lines, charges, and returns to suppliers.', names: ['PurchaseStatus', 'EntryUnit', 'Purchase', 'PurchaseItem', 'PurchaseCharge', 'PurchaseReturn', 'PurchaseReturnItem'] },
  kits: { title: 'Section kits (bundles of products sold together).', names: ['Kit', 'KitItem'] },
  sales: { title: 'Counter sales: bills, lines, kit components, payments, held bills, returns.', names: ['SaleStatus', 'PaymentMode', 'Sale', 'SaleItem', 'SaleKitComponent', 'SalePayment', 'HeldBill', 'SalesReturn', 'SalesReturnItem'] },
  admin: { title: 'Audit trail, store settings and dashboard alerts.', names: ['GstMode', 'AuditLog', 'StoreSetting', 'SystemAlert'] },
  system: { title: 'Shared counters: gapless document numbers and the id sequences that replace auto-increment.', names: ['DocCounter', 'Sequence'] },
};
const featureOf = {};
for (const [g, v] of Object.entries(GROUPS)) for (const n of v.names) featureOf[n] = g;
for (const m of [...models, ...enums]) if (!featureOf[m.name]) throw new Error(`no feature for ${m.name}`);

const modelByName = Object.fromEntries(models.map((m) => [m.name, m]));
const enumNames = new Set(enums.map((e) => e.name));
const db = (f) => f.dbName ?? f.name;
const coll = (m) => m.dbName ?? m.name;

function mongooseType(f) {
  if (f.kind === 'enum') return 'String';
  return { String: 'String', Int: 'Schema.Types.Int32', BigInt: 'Schema.Types.BigInt', Float: 'Schema.Types.Double', Boolean: 'Boolean', DateTime: 'Date', Json: 'Schema.Types.Mixed' }[f.type];
}
function tsType(f) {
  if (f.kind === 'enum') return f.type;
  return { String: 'string', Int: 'number', BigInt: 'number', Float: 'number', Boolean: 'boolean', DateTime: 'Date', Json: 'unknown' }[f.type];
}
function defaultOf(f) {
  const d = f.default;
  if (f.isId) return d?.name === 'uuid' ? '() => randomUUID()' : null; // numeric ids come from the _seq collection
  if (d === undefined) return f.isRequired ? null : 'null';
  if (typeof d === 'object' && d && d.name === 'now') return 'Date.now';
  if (typeof d === 'object' && d && d.name === 'uuid') return '() => randomUUID()';
  if (typeof d === 'object' && d && d.name) throw new Error(`default fn ${d.name}`);
  return typeof d === 'string' ? `'${d}'` : JSON.stringify(d);
}

/** Relation fields -> Mongoose populate virtuals (same names as before, so queries can include them). */
function relationVirtual(m, f) {
  const target = modelByName[f.type];
  if (f.relationFromFields?.length) {
    // this model holds the foreign key
    const local = m.fields.find((x) => x.name === f.relationFromFields[0]);
    const foreign = target.fields.find((x) => x.name === f.relationToFields[0]);
    return { name: f.name, ref: f.type, localField: db(local), foreignField: db(foreign), justOne: true };
  }
  // the other side holds the foreign key
  const back = target.fields.find((x) => x.kind === 'object' && x.relationName === f.relationName && x.relationFromFields?.length);
  const fk = target.fields.find((x) => x.name === back.relationFromFields[0]);
  const pk = m.fields.find((x) => x.name === back.relationToFields[0]);
  return { name: f.name, ref: f.type, localField: db(pk), foreignField: db(fk), justOne: !f.isList };
}

function indexLines(m) {
  return (meta.indexes[coll(m)] ?? [])
    .filter((i) => i.name !== '_id_')
    .map((i) => {
      const opts = { name: i.name, ...(i.unique ? { unique: true } : {}), ...(i.partialFilterExpression ? { partialFilterExpression: i.partialFilterExpression } : {}) };
      return `${m.name}Schema.index(${JSON.stringify(i.key)}, ${JSON.stringify(opts)});`;
    });
}

function modelCode(m) {
  const scalars = m.fields.filter((f) => f.kind !== 'object');
  const relations = m.fields.filter((f) => f.kind === 'object');
  const updatedAt = scalars.find((f) => f.isUpdatedAt);
  const lines = [];
  // interface
  lines.push(`export interface ${m.name} {`);
  for (const f of scalars) lines.push(`  ${f.name}: ${tsType(f)}${f.isRequired ? '' : ' | null'};`);
  for (const r of relations) lines.push(`  ${r.name}?: ${r.type}${r.isList ? '[]' : r.isRequired ? '' : ' | null'};`);
  lines.push('}', '');
  // schema
  lines.push(`export const ${m.name}Schema = new Schema(`, '  {');
  for (const f of scalars) {
    const parts = [`type: ${mongooseType(f)}`];
    if (f.kind === 'enum') parts.push(`enum: Object.values(${f.type})`);
    const d = defaultOf(f);
    if (d !== null) parts.push(`default: ${d}`);
    const key = db(f);
    if (key !== f.name && !(f.isId && f.name === 'id')) parts.push(`alias: '${f.name}'`);
    lines.push(`    ${/^[a-z_][a-z0-9_]*$/i.test(key) ? key : `'${key}'`}: { ${parts.join(', ')} },`);
  }
  lines.push('  },');
  const opts = [`collection: '${coll(m)}'`, 'versionKey: false', 'id: false', "strict: 'throw'"];
  if (updatedAt) opts.push(`timestamps: { createdAt: false, updatedAt: '${db(updatedAt)}' }`);
  lines.push(`  { ${opts.join(', ')} },`, ');');
  for (const r of relations) {
    const v = relationVirtual(m, r);
    lines.push(`${m.name}Schema.virtual('${v.name}', { ref: '${v.ref}', localField: '${v.localField}', foreignField: '${v.foreignField}', justOne: ${v.justOne} });`);
  }
  lines.push(...indexLines(m));
  lines.push(`export const ${m.name}Model = (models.${m.name} as Model<${m.name}>) ?? model<${m.name}>('${m.name}', ${m.name}Schema);`, '');
  return lines.join('\n');
}

function enumCode(e) {
  return [
    `export const ${e.name} = { ${e.values.map((v) => `${v.name}: '${v.name}'`).join(', ')} } as const;`,
    `export type ${e.name} = (typeof ${e.name})[keyof typeof ${e.name}];`,
    '',
  ].join('\n');
}

const index = [];
for (const [g, v] of Object.entries(GROUPS)) {
  const ms = v.names.filter((n) => modelByName[n]).map((n) => modelByName[n]);
  const es = v.names.filter((n) => enumNames.has(n)).map((n) => enums.find((e) => e.name === n));
  // types this file needs from other features (relations and enum fields)
  const external = {};
  for (const m of ms)
    for (const f of m.fields)
      if ((f.kind === 'object' || f.kind === 'enum') && featureOf[f.type] !== g) (external[featureOf[f.type]] ??= new Set()).add(f.type);
  const usesUuid = ms.some((m) => m.fields.some((f) => f.default?.name === 'uuid'));
  const head = [
    `// ${v.title}`,
    '// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is',
    '// unchanged); each path has a camelCase alias, which is the name the services and the API use.',
  ];
  if (usesUuid) head.push("import { randomUUID } from 'crypto';");
  head.push(`import { ${ms.length ? 'Model, model, models, Schema' : ''} } from 'mongoose';`);
  for (const [f, names] of Object.entries(external)) {
    const ens = [...names].filter((n) => enumNames.has(n));
    const typesOnly = [...names].filter((n) => !enumNames.has(n));
    if (ens.length) head.push(`import { ${ens.sort().join(', ')} } from '../${f}/model';`);
    if (typesOnly.length) head.push(`import type { ${typesOnly.sort().join(', ')} } from '../${f}/model';`);
  }
  const body = [...es.map(enumCode), ...ms.map(modelCode)];
  mkdirSync(join(MODELS, g), { recursive: true });
  writeFileSync(join(MODELS, g, 'model.ts'), head.join('\n') + '\n\n' + body.join('\n'));
  index.push(`export * from './${g}/model';`);
  console.log(`${g}/model.ts: ${v.names.join(', ')}`);
}
writeFileSync(
  join(MODELS, 'index.ts'),
  '// Every Mongoose model, so the data layer (config/db.ts) can register them all at start-up.\n' + index.join('\n') + '\n',
);
