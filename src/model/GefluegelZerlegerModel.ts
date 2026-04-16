import { Schema, model } from "mongoose";

export type ZerlegerKategorie =
  | "haehnchen"
  | "pute_fluegel"
  | "pute_keule"
  | "ganz_haehnchen"
  | "brust";

export interface IGefluegelZerleger {
  name: string;
  kategorien: ZerlegerKategorie[];
  aktiv: boolean;
  reihenfolge: number;
}

const gefluegelZerlegerSchema = new Schema<IGefluegelZerleger>({
  name: { type: String, required: true, unique: true },
  kategorien: {
    type: [String],
    enum: ["haehnchen", "pute_fluegel", "pute_keule", "ganz_haehnchen", "brust"],
    default: ["haehnchen"],
  },
  aktiv: { type: Boolean, default: true },
  reihenfolge: { type: Number, default: 0 },
});

export const GefluegelZerleger = model<IGefluegelZerleger>(
  "GefluegelZerleger",
  gefluegelZerlegerSchema
);
