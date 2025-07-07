import { Schema, model, Document } from 'mongoose';

export interface IZerlegeArtikelPosition {
  artikelPositionId: string;
  artikelName: string;
  status: 'offen' | 'erledigt';
  menge?: number;
  bemerkung?: string;
  erledigtAm?: Date;
}

export interface IZerlegeAuftrag extends Document {
  auftragId: string;
  kundenName: string;
  artikelPositionen: IZerlegeArtikelPosition[];
  zerlegerId?: string;
  zerlegerName?: string;
  erstelltAm: Date;
  archiviert: boolean;
}

const ZerlegeArtikelPositionSchema = new Schema<IZerlegeArtikelPosition>({
  artikelPositionId: { type: String, required: true },
  artikelName: { type: String },
  status: { type: String, enum: ['offen', 'erledigt'], required: true },
  menge: { type: Number },
  bemerkung: { type: String },
  erledigtAm: { type: Date }
});

const ZerlegeAuftragSchema = new Schema<IZerlegeAuftrag>({
  auftragId: { type: String, required: true },
  kundenName: { type: String, required: true },
  artikelPositionen: { type: [ZerlegeArtikelPositionSchema], required: true },
  zerlegerId: { type: String },
  zerlegerName: { type: String },
  erstelltAm: { type: Date, required: true },
  archiviert: { type: Boolean, default: false }
});

export const ZerlegeAuftragModel = model<IZerlegeAuftrag>('ZerlegeAuftrag', ZerlegeAuftragSchema);