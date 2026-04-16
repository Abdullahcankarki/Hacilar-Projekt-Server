import { Schema, model } from "mongoose";

export interface IBrustConfig {
  key: "singleton";
  sollMitHaut: number;
  sollOhneHaut: number;
  sollHaut: number;
}

const brustConfigSchema = new Schema<IBrustConfig>({
  key: { type: String, required: true, unique: true, default: "singleton" },
  sollMitHaut: { type: Number, required: true, min: 0, max: 1, default: 0.9 },
  sollOhneHaut: { type: Number, required: true, min: 0, max: 1, default: 0.81 },
  sollHaut: { type: Number, required: true, min: 0, max: 1, default: 0.09 },
});

export const BrustConfig = model<IBrustConfig>(
  "BrustConfig",
  brustConfigSchema
);
