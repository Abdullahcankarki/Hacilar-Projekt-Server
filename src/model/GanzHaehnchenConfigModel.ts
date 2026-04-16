import { Schema, model } from "mongoose";

export interface IGanzHaehnchenConfig {
  key: "singleton";
  sollBrust: number;
  sollKeule: number;
  sollFluegel: number;
}

const ganzHaehnchenConfigSchema = new Schema<IGanzHaehnchenConfig>({
  key: { type: String, required: true, unique: true, default: "singleton" },
  sollBrust: { type: Number, required: true, min: 0, max: 1, default: 0.436 },
  sollKeule: { type: Number, required: true, min: 0, max: 1, default: 0.358 },
  sollFluegel: { type: Number, required: true, min: 0, max: 1, default: 0.087 },
});

export const GanzHaehnchenConfig = model<IGanzHaehnchenConfig>(
  "GanzHaehnchenConfig",
  ganzHaehnchenConfigSchema
);
