import { Schema, model } from "mongoose";

export interface ILeergutBuchung {
  kundennr: string;
  kunde: string;
  filename: string;
  pdfBase64: string;
  uploadDatum: Date;
}

const leergutBuchungSchema = new Schema<ILeergutBuchung>(
  {
    kundennr: { type: String, required: true },
    kunde: { type: String, required: true },
    filename: { type: String, required: true },
    pdfBase64: { type: String, required: true },
    uploadDatum: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

leergutBuchungSchema.index({ kundennr: 1 });

export const LeergutBuchung = model<ILeergutBuchung>(
  "LeergutBuchung",
  leergutBuchungSchema
);
