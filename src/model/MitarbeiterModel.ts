import { Schema, model } from "mongoose";

export interface IMitarbeiter {
  name: string;
  password: string;
  email?: string;
  telefon?: string;
  abteilung?: string;
  rollen: string[]; // z. B. ["admin", "verkauf"]
  aktiv?: boolean;
  bemerkung?: string;
  eintrittsdatum?: Date;
}

const mitarbeiterSchema = new Schema<IMitarbeiter>({
  name: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: String,
  telefon: String,
  abteilung: String,
  rollen: { type: [String], required: true },
  aktiv: { type: Boolean, default: true },
  bemerkung: String,
  eintrittsdatum: Date,
});

export const Mitarbeiter = model<IMitarbeiter>("Mitarbeiter", mitarbeiterSchema);