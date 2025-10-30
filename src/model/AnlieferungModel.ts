import { Schema, model, Types } from "mongoose";

export type AnlieferungStatus = "ANGEKUENDIGT" | "TEILGELIEFERT" | "ERLEDIGT";

export interface AnlieferungDoc {
  artikelId: Types.ObjectId;
  artikelName?: string;
  artikelNummer?: string;
  lieferantId?: Types.ObjectId;
  lieferantName?: string;
  chargeId?: Types.ObjectId;
  erwartetAm: Date;
  menge: number;
  status: AnlieferungStatus;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const AnlieferungSchema = new Schema<AnlieferungDoc>({
  artikelId: { type: Schema.Types.ObjectId, ref: "Artikel", required: true, index: true },
  artikelName: String,
  artikelNummer: String,
  lieferantId: { type: Schema.Types.ObjectId, ref: "Lieferant" },
  lieferantName: String,
  chargeId: { type: Schema.Types.ObjectId, ref: "Charge" },
  erwartetAm: { type: Date, required: true, index: true },
  menge: { type: Number, required: true, min: 0.001 },
  status: { type: String, enum: ["ANGEKUENDIGT","TEILGELIEFERT","ERLEDIGT"], default: "ANGEKUENDIGT", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "Mitarbeiter" },
}, { timestamps: true });

AnlieferungSchema.index({ erwartetAm: 1, status: 1 });

export const AnlieferungModel = model<AnlieferungDoc>("Anlieferung", AnlieferungSchema);