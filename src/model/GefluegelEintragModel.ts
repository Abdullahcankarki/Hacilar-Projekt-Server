import { Schema, model, Types } from "mongoose";

export interface IGefluegelEintrag {
  datum: Date;
  zerlegerId: Types.ObjectId;
  zerlegerName: string;
  lieferantId: Types.ObjectId;
  lieferantName: string;
  kisten: number;
  kg: number;
}

const gefluegelEintragSchema = new Schema<IGefluegelEintrag>(
  {
    datum: { type: Date, required: true },
    zerlegerId: { type: Schema.Types.ObjectId, ref: "GefluegelZerleger", required: true },
    zerlegerName: { type: String, required: true },
    lieferantId: { type: Schema.Types.ObjectId, ref: "GefluegelLieferant", required: true },
    lieferantName: { type: String, required: true },
    kisten: { type: Number, required: true, min: 0 },
    kg: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

gefluegelEintragSchema.index(
  { datum: 1, zerlegerId: 1, lieferantId: 1 },
  { unique: true }
);

export const GefluegelEintrag = model<IGefluegelEintrag>(
  "GefluegelEintrag",
  gefluegelEintragSchema
);
