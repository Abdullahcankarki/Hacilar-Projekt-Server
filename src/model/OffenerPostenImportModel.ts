import { Schema, model } from "mongoose";

export interface IOffenerPostenImport {
  datum: Date;
  berichtsDatum: Date;
  dateiname: string;
  anzahlPosten: number;
  gesamtBetrag: number;
}

const offenerPostenImportSchema = new Schema<IOffenerPostenImport>(
  {
    datum: { type: Date, required: true, default: Date.now },
    berichtsDatum: { type: Date, required: true },
    dateiname: { type: String, required: true },
    anzahlPosten: { type: Number, required: true, min: 0 },
    gesamtBetrag: { type: Number, required: true },
  },
  { timestamps: true }
);

offenerPostenImportSchema.index({ datum: -1 });

export const OffenerPostenImport = model<IOffenerPostenImport>(
  "OffenerPostenImport",
  offenerPostenImportSchema
);
