import { Schema, model, Types } from "mongoose";

export interface IBrustEintrag {
  datum: Date;
  zerlegerId: Types.ObjectId;
  zerlegerName: string;
  anzahlKisten: number;
  gewichtMitKnochen: number;
  brustMitHaut: number;
  brustOhneHaut: number;
  haut: number;
  kosten?: string;
}

const brustEintragSchema = new Schema<IBrustEintrag>(
  {
    datum: { type: Date, required: true },
    zerlegerId: { type: Schema.Types.ObjectId, ref: "GefluegelZerleger", required: true },
    zerlegerName: { type: String, required: true },
    anzahlKisten: { type: Number, required: true, min: 0, default: 0 },
    gewichtMitKnochen: { type: Number, required: true, min: 0, default: 0 },
    brustMitHaut: { type: Number, required: true, min: 0, default: 0 },
    brustOhneHaut: { type: Number, required: true, min: 0, default: 0 },
    haut: { type: Number, required: true, min: 0, default: 0 },
    kosten: { type: String },
  },
  { timestamps: true }
);

brustEintragSchema.index(
  { datum: 1, zerlegerId: 1 },
  { unique: true }
);

export const BrustEintrag = model<IBrustEintrag>(
  "BrustEintrag",
  brustEintragSchema
);
