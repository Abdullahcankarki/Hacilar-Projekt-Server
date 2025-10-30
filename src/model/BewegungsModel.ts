import { Schema, model, Types } from "mongoose";

export type Lagerbereich = "TK" | "NON_TK";
export type BewegungsTyp =
  | "WARENEINGANG" | "WARENAUSGANG" | "RESERVIERUNG" | "RESERVIERUNG_AUFLOESEN"
  | "KOMMISSIONIERUNG" | "MULL" | "INVENTUR_KORREKTUR"
  | "UMBUCHUNG_HIN" | "UMBUCHUNG_WEG"
  | "RUECKLIEFERUNG_KUNDE" | "RUECKLIEFERUNG_LIEFERANT"
  | "ANLIEFERUNG_ERFASST" | "ANLIEFERUNG_ERLEDIGT";

export interface BewegungDoc {
  timestamp: Date;
  userId?: Types.ObjectId;
  typ: BewegungsTyp;
  artikelId: Types.ObjectId;
  artikelName?: string;
  artikelNummer?: string;
  kundeName?: string;
  lieferDatum?: Date;
  chargeId?: Types.ObjectId;
  menge: number;
  lagerbereich: Lagerbereich;
  auftragId?: Types.ObjectId;
  lieferscheinId?: Types.ObjectId;
  gutschriftId?: Types.ObjectId;
  notiz?: string;
  mhd?: Date;
  schlachtDatum?: Date;
  isTK?: boolean;
}

const BewegungSchema = new Schema<BewegungDoc>({
  timestamp: { type: Date, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "Mitarbeiter" },
  typ: { type: String, required: true, index: true },
  artikelId: { type: Schema.Types.ObjectId, ref: "Artikel", required: true, index: true },
  artikelName: String,
  artikelNummer: String,
  kundeName: String,
  lieferDatum: Date,
  chargeId: { type: Schema.Types.ObjectId, ref: "Charge" },
  menge: { type: Number, required: true },
  lagerbereich: { type: String, enum: ["TK","NON_TK"], required: true, index: true },
  auftragId: { type: Schema.Types.ObjectId, ref: "Auftrag" },
  lieferscheinId: { type: Schema.Types.ObjectId },
  gutschriftId: { type: Schema.Types.ObjectId },
  notiz: String,
  mhd: Date,
  schlachtDatum: Date,
  isTK: Boolean,
}, { _id: true });

BewegungSchema.index({ artikelId: 1, chargeId: 1, timestamp: 1 });

export const BewegungModel = model<BewegungDoc>("Bewegung", BewegungSchema);