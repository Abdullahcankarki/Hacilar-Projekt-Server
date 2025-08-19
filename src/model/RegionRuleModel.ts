import mongoose, { Document, Schema, Model } from 'mongoose';

export interface RegionRuleDoc extends Document {
  region: string;
  erlaubteTage: string[];
  maxTourenProTag?: number;
  aktiv: boolean;
  bemerkung?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RegionRuleSchema = new Schema<RegionRuleDoc>(
  {
    region: { type: String, required: true },
    erlaubteTage: { type: [String], required: true },
    maxTourenProTag: { type: Number },
    aktiv: { type: Boolean, default: true },
    bemerkung: { type: String },
  },
  { timestamps: true }
);

export const RegionRule: Model<RegionRuleDoc> = mongoose.model<RegionRuleDoc>('RegionRule', RegionRuleSchema);