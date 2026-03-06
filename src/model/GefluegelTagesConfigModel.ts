import { Schema, model } from "mongoose";

export interface IGefluegelTagesConfig {
  datum: Date;
  hiddenLieferanten: string[];
}

const gefluegelTagesConfigSchema = new Schema<IGefluegelTagesConfig>({
  datum: { type: Date, required: true, unique: true },
  hiddenLieferanten: { type: [String], default: [] },
});

export const GefluegelTagesConfig = model<IGefluegelTagesConfig>(
  "GefluegelTagesConfig",
  gefluegelTagesConfigSchema
);
