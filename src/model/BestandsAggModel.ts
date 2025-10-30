import { Schema, model, Types } from "mongoose";
import { Lagerbereich } from "./BewegungsModel";

export interface BestandAggDoc {
  artikelId: Types.ObjectId;
  artikelName?: string;
  artikelNummer?: string;
  chargeId?: Types.ObjectId;
  lagerbereich: Lagerbereich;
  verfuegbar: number;
  reserviert: number;
  unterwegs: number;
  updatedAt?: Date;
}

const BestandAggSchema = new Schema<BestandAggDoc>({
  artikelId: { type: Schema.Types.ObjectId, ref: "Artikel", required: true, index: true },
  artikelName: String,
  artikelNummer: String,
  chargeId: { type: Schema.Types.ObjectId, ref: "Charge", index: true },
  lagerbereich: { type: String, enum: ["TK","NON_TK"], required: true, index: true },
  verfuegbar: { type: Number, default: 0 },
  reserviert: { type: Number, default: 0 },
  unterwegs: { type: Number, default: 0 },
  updatedAt: { type: Date, default: () => new Date() },
}, { versionKey: false });

BestandAggSchema.index({ artikelId: 1, chargeId: 1 }, { unique: false });

export const BestandAggModel = model<BestandAggDoc>("BestandAgg", BestandAggSchema);