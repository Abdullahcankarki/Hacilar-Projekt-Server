import { Schema, model, Types } from "mongoose";

export interface IOffenerPosten {
  importId: Types.ObjectId;
  importDatum: Date;
  berichtsDatum: Date;
  kontonr: string;
  kunde: string;
  buchNr: string;
  datum: Date;
  reNr: string;
  betrag: number;
  tageOffen: number;
  mahndatum?: Date;
  stufe: string;
}

const offenerPostenSchema = new Schema<IOffenerPosten>(
  {
    importId: { type: Schema.Types.ObjectId, ref: "OffenerPostenImport", required: true },
    importDatum: { type: Date, required: true },
    berichtsDatum: { type: Date, required: true },
    kontonr: { type: String, required: true },
    kunde: { type: String, required: true },
    buchNr: { type: String, required: true },
    datum: { type: Date, required: true },
    reNr: { type: String, required: true },
    betrag: { type: Number, required: true },
    tageOffen: { type: Number, required: true },
    mahndatum: { type: Date },
    stufe: { type: String, default: "0" },
  },
  { timestamps: true }
);

offenerPostenSchema.index({ importId: 1 });
offenerPostenSchema.index({ importDatum: -1, kontonr: 1 });

export const OffenerPosten = model<IOffenerPosten>(
  "OffenerPosten",
  offenerPostenSchema
);
