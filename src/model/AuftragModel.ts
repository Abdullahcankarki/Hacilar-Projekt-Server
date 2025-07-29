import { Document, Schema, Types, model } from "mongoose";

export interface IAuftrag extends Document {
  auftragsnummer: string;
  kunde: Types.ObjectId; // Referenz zu Kunde-Model
  artikelPosition: Types.ObjectId[]; // Array von Referenzen zu ArtikelPositionen
  status: 'offen' | 'in Bearbeitung' | 'abgeschlossen' | 'storniert'; // Auftragsstatus
  lieferdatum: Date; // Gewünschtes Lieferdatum
  bemerkungen: string; // Optionale Bemerkungen
  bearbeiter: string;
  gesamtPaletten: number;
  kommissioniertVon?: Types.ObjectId;
  kommissioniertVonName?: string;
  kontrolliertVon?: Types.ObjectId;
  kontrolliertVonName?: string;
  kommissioniertStatus?: 'offen' | 'gestartet' | 'fertig';
  kontrolliertStatus?: 'offen' | 'in Kontrolle' | 'geprüft';
  kommissioniertStartzeit?: Date;
  kommissioniertEndzeit?: Date;
  kontrolliertZeit?: Date;
  createdAt: Date; // Erstellungsdatum
  updatedAt: Date; // Aktualisierungsdatum
}

const auftragSchema = new Schema<IAuftrag>({
  auftragsnummer: { type: String, default: "0"},
  kunde: { type: Schema.Types.ObjectId, ref: 'Kunde', required: true },
  artikelPosition: [{ type: Schema.Types.ObjectId, ref: 'ArtikelPosition'}],
  status: {
    type: String,
    enum: ['offen', 'in Bearbeitung', 'abgeschlossen', 'storniert'],
    default: 'offen',
  },
  lieferdatum: { type: Date, required: false },
  bemerkungen: { type: String, required: false },
  bearbeiter: { type: String, required: false },
  gesamtPaletten: { type: Number, required: false },
  kommissioniertVon: { type: Schema.Types.ObjectId, ref: 'User' },
  kommissioniertVonName: { type: String },
  kontrolliertVon: { type: Schema.Types.ObjectId, ref: 'User' },
  kontrolliertVonName: { type: String },
  kommissioniertStatus: { type: String, enum: ['offen', 'gestartet', 'fertig']},
  kontrolliertStatus: { type: String, enum: ['offen', 'in Kontrolle', 'geprüft']},
  kommissioniertStartzeit: { type: Date },
  kommissioniertEndzeit: { type: Date },
  kontrolliertZeit: { type: Date },
}, { timestamps: true });

export const Auftrag = model<IAuftrag>("Auftrag", auftragSchema);