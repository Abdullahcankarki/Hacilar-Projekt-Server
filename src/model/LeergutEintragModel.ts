import { Schema, model, Types } from "mongoose";

export interface ILeergutEintrag {
  importId: Types.ObjectId;
  importDatum: Date;
  kundennr: string;
  kunde: string;
  artikel: string;
  alterBestand: number;
}

const leergutEintragSchema = new Schema<ILeergutEintrag>(
  {
    importId: { type: Schema.Types.ObjectId, ref: "LeergutImport", required: true },
    importDatum: { type: Date, required: true },
    kundennr: { type: String, required: true },
    kunde: { type: String, required: true },
    artikel: { type: String, required: true },
    alterBestand: { type: Number, required: true },
  },
  { timestamps: true }
);

leergutEintragSchema.index({ importId: 1 });
leergutEintragSchema.index({ importDatum: -1, kundennr: 1 });

export const LeergutEintrag = model<ILeergutEintrag>(
  "LeergutEintrag",
  leergutEintragSchema
);
