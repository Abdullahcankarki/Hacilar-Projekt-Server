import { Schema, model, Document } from 'mongoose';

export interface IArtikel extends Document {
  preis: number;            // Standardpreis des Artikels
  artikelNummer: string
  name: string
  kategorie: string
  gewichtProStueck: number; // Gewicht pro Stück
  gewichtProKarton: number;  // Gewicht pro Karton
  gewichtProKiste: number;   // Gewicht pro Kiste
  bildUrl?: string;
  ausverkauft?: boolean;
}

const ArtikelSchema = new Schema<IArtikel>({
  preis: { type: Number, default: 0},
  artikelNummer: {type: String, required: true},
  name: {type: String, required: true},
  kategorie: {type: String},
  gewichtProStueck: { type: Number},
  gewichtProKarton: { type: Number},
  gewichtProKiste: { type: Number},
  bildUrl: { type: String },
  ausverkauft: {type: Boolean, default: false}
});

export const ArtikelModel = model<IArtikel>('Artikel', ArtikelSchema);