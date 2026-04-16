import { Schema, model, Types } from "mongoose";

export interface IGanzHaehnchenEintrag {
  datum: Date;
  zerlegerId: Types.ObjectId;
  zerlegerName: string;
  anzahlKisten: number;
  gewichtGesamt: number;
  brust: number;
  keule: number;
  fluegel: number;
  kosten?: string;
}

const ganzHaehnchenEintragSchema = new Schema<IGanzHaehnchenEintrag>(
  {
    datum: { type: Date, required: true },
    zerlegerId: { type: Schema.Types.ObjectId, ref: "GefluegelZerleger", required: true },
    zerlegerName: { type: String, required: true },
    anzahlKisten: { type: Number, required: true, min: 0, default: 0 },
    gewichtGesamt: { type: Number, required: true, min: 0, default: 0 },
    brust: { type: Number, required: true, min: 0, default: 0 },
    keule: { type: Number, required: true, min: 0, default: 0 },
    fluegel: { type: Number, required: true, min: 0, default: 0 },
    kosten: { type: String },
  },
  { timestamps: true }
);

ganzHaehnchenEintragSchema.index(
  { datum: 1, zerlegerId: 1 },
  { unique: true }
);

export const GanzHaehnchenEintrag = model<IGanzHaehnchenEintrag>(
  "GanzHaehnchenEintrag",
  ganzHaehnchenEintragSchema
);
