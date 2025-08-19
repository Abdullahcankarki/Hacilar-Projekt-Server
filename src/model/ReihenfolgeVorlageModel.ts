import mongoose, { Document, Schema, Model } from "mongoose";

export interface KundenReihenfolge {
  kundeId: string;
  position: number;
}

export interface ReihenfolgeVorlageDoc extends Document {
  name: string;
  region: string;
  tage?: string[];
  kundenReihenfolge: KundenReihenfolge[];
  aktiv: boolean;
  bemerkung?: string;
  createdAt: Date;
  updatedAt: Date;
}

const KundenReihenfolgeSchema = new Schema<KundenReihenfolge>({
  kundeId: { type: String, required: true },
  position: { type: Number, required: true },
});

const ReihenfolgeVorlageSchema = new Schema<ReihenfolgeVorlageDoc>(
  {
    name: { type: String, required: true },
    region: { type: String, required: true },
    tage: [{ type: String }],
    kundenReihenfolge: { type: [KundenReihenfolgeSchema], required: true },
    aktiv: { type: Boolean, default: true },
    bemerkung: { type: String },
  },
  { timestamps: true }
);

export const ReihenfolgeVorlage: Model<ReihenfolgeVorlageDoc> = mongoose.model<ReihenfolgeVorlageDoc>(
  "ReihenfolgeVorlage",
  ReihenfolgeVorlageSchema
);
