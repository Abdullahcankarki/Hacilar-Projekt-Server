import { Schema, model } from "mongoose";

export interface ILeergutImport {
  datum: Date;
  anzahlDateien: number;
  anzahlKunden: number;
}

const leergutImportSchema = new Schema<ILeergutImport>(
  {
    datum: { type: Date, required: true, default: Date.now },
    anzahlDateien: { type: Number, required: true, min: 0 },
    anzahlKunden: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

leergutImportSchema.index({ datum: -1 });

export const LeergutImport = model<ILeergutImport>(
  "LeergutImport",
  leergutImportSchema
);
