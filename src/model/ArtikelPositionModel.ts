import mongoose, { Schema, Types, model } from "mongoose";

export interface IArtikelPosition {
  artikel: Types.ObjectId; // Artikel-ID (Referenz zu Artikel)
  artikelName: string;
  menge: number; // Menge des Artikels
  einheit: 'kg' | 'stück' | 'kiste' | 'karton'; // Einheit der Menge
  einzelpreis: number; // Kilopreis für den Kunden
  gesamtgewicht: number; // Gesamtgewicht (berechnet)
  gesamtpreis: number; // Gesamtpreis (berechnet)
  zerlegung: boolean;
  vakuum: boolean;
  bemerkung: string;
  zerlegeBemerkung: string,
}

const artikelPositionSchema = new Schema<IArtikelPosition>({
  artikel: { type: Schema.Types.ObjectId, ref: 'Artikel' },
  artikelName: {type: String},
  menge: { type: Number },
  einheit: {
    type: String,
    enum: ['kg', 'stück', 'kiste', 'karton'],
    default: 'stück',
  },
  einzelpreis: { type: Number},
  gesamtgewicht: { type: Number },
  gesamtpreis: { type: Number},
  zerlegung: { type: Boolean },
  vakuum: { type: Boolean },
  bemerkung: { type: String },
  zerlegeBemerkung: { type: String }
});

artikelPositionSchema.pre(['save', 'findOneAndUpdate', 'updateOne', 'updateMany'], async function (next) {
  const position = this as IArtikelPosition;

  // Artikel-Daten laden, um Gewicht je Einheit zu bestimmen
  const Artikel = mongoose.model('Artikel');
  const artikelData: any = await Artikel.findById(position.artikel);

  if (!artikelData) {
    throw new Error('Artikel nicht gefunden.');
  }

  // Gewicht pro Einheit aus Artikel-Daten basierend auf der Einheit holen
  const { gewichtProStück, gewichtProKiste, gewichtProKarton } = artikelData;
  let gewichtProEinheit: number;

  switch (position.einheit) {
    case 'stück':
      gewichtProEinheit = gewichtProStück;
      break;
    case 'kiste':
      gewichtProEinheit = gewichtProKiste;
      break;
    case 'karton':
      gewichtProEinheit = gewichtProKarton;
      break;
    case 'kg':
      gewichtProEinheit = 1; // Für kg ist das Gewicht direkt gegeben
      break;
    default:
      throw new Error('Ungültige Einheit.');
  }

  // Berechnung Gesamtgewicht und Gesamtpreis
  position.gesamtgewicht = position.menge * gewichtProEinheit;
  position.gesamtpreis = position.gesamtgewicht * position.einzelpreis;

  next();
});

export const ArtikelPosition = model<IArtikelPosition>("ArtikelPosition", artikelPositionSchema);