import { Schema, model, Types } from "mongoose";

export interface IPuteEintrag {
  datum: Date;
  kategorie: "pute_fluegel" | "pute_keule";
  zerlegerId: Types.ObjectId;
  zerlegerName: string;
  mitKnochen: number;
  ohneKnochen: number;
}

const puteEintragSchema = new Schema<IPuteEintrag>(
  {
    datum: { type: Date, required: true },
    kategorie: { type: String, required: true, enum: ["pute_fluegel", "pute_keule"] },
    zerlegerId: { type: Schema.Types.ObjectId, ref: "GefluegelZerleger", required: true },
    zerlegerName: { type: String, required: true },
    mitKnochen: { type: Number, required: true, min: 0 },
    ohneKnochen: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

puteEintragSchema.index(
  { datum: 1, kategorie: 1, zerlegerId: 1 },
  { unique: true }
);

export const PuteEintrag = model<IPuteEintrag>(
  "PuteEintrag",
  puteEintragSchema
);
