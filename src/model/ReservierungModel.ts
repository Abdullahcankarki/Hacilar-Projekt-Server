import { Schema, model, Types } from "mongoose";

export type ReservierungStatus = "AKTIV" | "ERFUELLT" | "AUFGELOEST";

export interface ReservierungDoc {
  artikelId: Types.ObjectId;
  artikelName?: string;
  artikelNummer?: string;
  auftragId: Types.ObjectId;
  kundeName?: string;
  lieferDatumText?: string;
  lieferDatum: Date;
  chargeId?: Types.ObjectId;
  menge: number;
  status: ReservierungStatus;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const ReservierungSchema = new Schema<ReservierungDoc>({
  artikelId: { type: Schema.Types.ObjectId, ref: "Artikel", required: true, index: true },
  artikelName: String,
  artikelNummer: String,
  auftragId: { type: Schema.Types.ObjectId, ref: "Auftrag", required: true, index: true },
  kundeName: String,
  lieferDatumText: String,
  lieferDatum: { type: Date, required: true, index: true },
  chargeId: { type: Schema.Types.ObjectId, ref: "Charge" },
  menge: { type: Number, required: true, min: 0.001 },
  status: { type: String, enum: ["AKTIV","ERFUELLT","AUFGELOEST"], default: "AKTIV", index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "Mitarbeiter" },
}, { timestamps: true });

ReservierungSchema.index({ artikelId: 1, lieferDatum: 1, status: 1 });

export const ReservierungModel = model<ReservierungDoc>("Reservierung", ReservierungSchema);