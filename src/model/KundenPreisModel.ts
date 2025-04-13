import { Schema, model, Document, Types } from 'mongoose';

export interface IKundenPreis extends Document {
  artikel: Types.ObjectId;  // Referenz zum Artikel
  customer: Types.ObjectId; // Referenz zum Kunden
  aufpreis: number;         // Aufpreis für diesen Kunden
}

const KundenPreisSchema = new Schema<IKundenPreis>({
  artikel: { type: Schema.Types.ObjectId, ref: 'Artikel', required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Kunde', required: true },
  aufpreis: { type: Number, required: true },
});

export const KundenPreisModel = model<IKundenPreis>('KundenPreis', KundenPreisSchema);