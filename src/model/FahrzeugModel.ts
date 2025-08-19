

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface FahrzeugDoc extends Document {
  name: string;
  kennzeichen: string;
  maxGewichtKg: number;
  samsaraVehicleId?: string;
  aktiv: boolean;
  bemerkung?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FahrzeugSchema = new Schema<FahrzeugDoc>(
  {
    name: { type: String, required: true },
    kennzeichen: { type: String, required: true, unique: true },
    maxGewichtKg: { type: Number, required: true },
    samsaraVehicleId: { type: String },
    aktiv: { type: Boolean, default: true },
    bemerkung: { type: String },
  },
  { timestamps: true }
);

// Unique index on kennzeichen (redundant with unique:true, but explicit for clarity)
FahrzeugSchema.index({ kennzeichen: 1 }, { unique: true });

export const Fahrzeug: Model<FahrzeugDoc> = mongoose.model<FahrzeugDoc>('Fahrzeug', FahrzeugSchema);