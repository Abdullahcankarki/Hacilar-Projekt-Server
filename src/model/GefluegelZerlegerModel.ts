import { Schema, model } from "mongoose";

export interface IGefluegelZerleger {
  name: string;
  aktiv: boolean;
  reihenfolge: number;
}

const gefluegelZerlegerSchema = new Schema<IGefluegelZerleger>({
  name: { type: String, required: true, unique: true },
  aktiv: { type: Boolean, default: true },
  reihenfolge: { type: Number, default: 0 },
});

export const GefluegelZerleger = model<IGefluegelZerleger>(
  "GefluegelZerleger",
  gefluegelZerlegerSchema
);
