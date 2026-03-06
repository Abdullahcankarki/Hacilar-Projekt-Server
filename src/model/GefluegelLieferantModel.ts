import { Schema, model } from "mongoose";

export interface IGefluegelLieferant {
  name: string;
  sollProzent: number;
  ekProKg: number;
  zerlegungskostenProKiste: number;
  kistenGewichtKg: number;
  aktiv: boolean;
  reihenfolge: number;
}

const gefluegelLieferantSchema = new Schema<IGefluegelLieferant>({
  name: { type: String, required: true, unique: true },
  sollProzent: { type: Number, required: true },
  ekProKg: { type: Number, required: true },
  zerlegungskostenProKiste: { type: Number, required: true, default: 1.5 },
  kistenGewichtKg: { type: Number, required: true, default: 10 },
  aktiv: { type: Boolean, default: true },
  reihenfolge: { type: Number, default: 0 },
});

export const GefluegelLieferant = model<IGefluegelLieferant>(
  "GefluegelLieferant",
  gefluegelLieferantSchema
);
