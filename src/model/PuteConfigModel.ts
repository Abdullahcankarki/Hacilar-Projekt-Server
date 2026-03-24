import { Schema, model } from "mongoose";

export interface IPuteConfig {
  kategorie: "pute_fluegel" | "pute_keule";
  sollProzent: number; // Zielwert (z.B. 0.65 = 65%)
}

const puteConfigSchema = new Schema<IPuteConfig>({
  kategorie: { type: String, required: true, enum: ["pute_fluegel", "pute_keule"], unique: true },
  sollProzent: { type: Number, required: true, min: 0, max: 1 },
});

export const PuteConfig = model<IPuteConfig>(
  "PuteConfig",
  puteConfigSchema
);
