// Shared counters: gapless document numbers and the id sequences that replace auto-increment.
// Mongoose schemas for the existing MongoDB collections. Stored field names stay snake_case (the data is
// unchanged); each path has a camelCase alias, which is the name the services and the API use.
import { Model, model, models, Schema } from 'mongoose';

export interface DocCounter {
  key: string;
  value: number;
}

export const DocCounterSchema = new Schema(
  {
    _id: { type: String, alias: 'key' },
    value: { type: Schema.Types.Int32 },
  },
  { collection: 'doc_counter', versionKey: false, id: false, strict: 'throw' },
);
export const DocCounterModel = (models.DocCounter as Model<DocCounter>) ?? model<DocCounter>('DocCounter', DocCounterSchema);

export interface Sequence {
  name: string;
  value: number;
}

export const SequenceSchema = new Schema(
  {
    _id: { type: String, alias: 'name' },
    value: { type: Schema.Types.Int32 },
  },
  { collection: '_seq', versionKey: false, id: false, strict: 'throw' },
);
export const SequenceModel = (models.Sequence as Model<Sequence>) ?? model<Sequence>('Sequence', SequenceSchema);
