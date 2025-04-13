import { Document, Schema, Types, model } from "mongoose";

export interface IAuftrag extends Document {
  kunde: Types.ObjectId; // Referenz zu Kunde-Model
  artikelPosition: Types.ObjectId[]; // Array von Referenzen zu ArtikelPositionen
  status: 'offen' | 'in Bearbeitung' | 'abgeschlossen' | 'storniert'; // Auftragsstatus
  lieferdatum: Date; // Gewünschtes Lieferdatum
  bemerkungen: string; // Optionale Bemerkungen
  createdAt: Date; // Erstellungsdatum
  updatedAt: Date; // Aktualisierungsdatum
}

const auftragSchema = new Schema<IAuftrag>({
  kunde: { type: Schema.Types.ObjectId, ref: 'Kunde', required: true },
  artikelPosition: [{ type: Schema.Types.ObjectId, ref: 'ArtikelPosition'}],
  status: {
    type: String,
    enum: ['offen', 'in Bearbeitung', 'abgeschlossen', 'storniert'],
    default: 'offen',
  },
  lieferdatum: { type: Date, required: false },
  bemerkungen: { type: String, required: false },
}, { timestamps: true });

export const Auftrag = model<IAuftrag>("Auftrag", auftragSchema);