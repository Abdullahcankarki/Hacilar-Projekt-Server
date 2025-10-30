import { Schema, model } from "mongoose";

export interface IdempotencyKeyDoc {
  key: string;
  createdAt: Date;
}
const IdempotencyKeySchema = new Schema<IdempotencyKeyDoc>({
  key: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: () => new Date() },
});
export const IdempotencyKeyModel = model<IdempotencyKeyDoc>("InventoryIdempotencyKey", IdempotencyKeySchema);