import { Schema, model, Types } from "mongoose";

export interface ChargeDoc {
  artikelId: Types.ObjectId;
  artikelName?: string;
  artikelNummer?: string;
  lieferantId?: Types.ObjectId;
  mhd: Date;
  schlachtDatum?: Date;
  isTK: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ChargeSchema = new Schema<ChargeDoc>({
  artikelId: { type: Schema.Types.ObjectId, ref: "Artikel", required: true, index: true },
  artikelName: String,
  artikelNummer: String,
  lieferantId: { type: Schema.Types.ObjectId, ref: "Lieferant", index: true },
  mhd: { type: Date, required: true, index: true },
  schlachtDatum: Date,
  isTK: { type: Boolean, required: true },
}, { timestamps: true });

ChargeSchema.index({ artikelId: 1, mhd: 1 }); // häufige Query für „bald fällig“

export const ChargeModel = model<ChargeDoc>("Charge", ChargeSchema);