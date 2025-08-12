import mongoose, { Schema, Types, model } from "mongoose";

export interface IArtikelPosition {
  artikel: Types.ObjectId; // Artikel-ID (Referenz zu Artikel)
  artikelName: string;
  menge: number; // Menge des Artikels
  einheit: "kg" | "stück" | "kiste" | "karton"; // Einheit der Menge
  einzelpreis: number; // Kilopreis für den Kunden
  gesamtgewicht: number; // Gesamtgewicht (berechnet)
  gesamtpreis: number; // Gesamtpreis (berechnet)
  zerlegung: boolean;
  vakuum: boolean;
  bemerkung: string;
  zerlegeBemerkung: string;
  kommissioniertMenge?: number;
  kommissioniertEinheit?: "kg" | "stück" | "kiste" | "karton";
  kommissioniertBemerkung?: string;
  kommissioniertVon?: Types.ObjectId;
  kommissioniertVonName?: string;
  kommissioniertAm?: Date;
  kontrolliert?: boolean;
  kontrolliertVon?: Types.ObjectId;
  kontrolliertVonName?: string;
  kontrolliertAm?: Date;
  leergut?: {
    leergutArt: string;
    leergutAnzahl: number;
    leergutGewicht: number;
  }[];
  bruttogewicht?: number;
  nettogewicht?: number;
  chargennummern?: string[];
  erfassungsModus?: "GEWICHT" | "KARTON" | "STÜCK";
}

const artikelPositionSchema = new Schema<IArtikelPosition>({
  artikel: { type: Schema.Types.ObjectId, ref: "Artikel" },
  artikelName: { type: String },
  menge: { type: Number },
  einheit: {
    type: String,
    enum: ["kg", "stück", "kiste", "karton"],
    default: "stück",
  },
  einzelpreis: { type: Number },
  gesamtgewicht: { type: Number },
  gesamtpreis: { type: Number },
  zerlegung: { type: Boolean },
  vakuum: { type: Boolean },
  bemerkung: { type: String },
  zerlegeBemerkung: { type: String },
  kommissioniertMenge: { type: Number },
  kommissioniertEinheit: {
    type: String,
    enum: ["kg", "stück", "kiste", "karton"],
  },
  kommissioniertBemerkung: { type: String },
  kommissioniertVon: { type: Schema.Types.ObjectId },
  kommissioniertVonName: { type: String },
  kommissioniertAm: { type: Date },
  kontrolliert: { type: Boolean },
  kontrolliertVon: { type: Schema.Types.ObjectId },
  kontrolliertVonName: { type: String },
  kontrolliertAm: { type: Date },
  leergut: [
    {
      leergutArt: { type: String },
      leergutAnzahl: { type: Number },
      leergutGewicht: { type: Number },
    },
  ],
  bruttogewicht: { type: Number },
  nettogewicht: { type: Number },
  chargennummern: [{ type: String }],
    erfassungsModus: { type: String, enum: ['GEWICHT', 'KARTON', 'STÜCK'], default: 'GEWICHT' }
});

artikelPositionSchema.pre(
  ["save", "findOneAndUpdate", "updateOne", "updateMany"],
  async function (next) {
    const position = this as IArtikelPosition;

    // Artikel-Daten laden, um Gewicht je Einheit zu bestimmen
    const Artikel = mongoose.model("Artikel");
    const artikelData: any = await Artikel.findById(position.artikel);

    if (!artikelData) {
      throw new Error("Artikel nicht gefunden.");
    }

    // Gewicht pro Einheit aus Artikel-Daten basierend auf der Einheit holen
    const { gewichtProStück, gewichtProKiste, gewichtProKarton } = artikelData;
    let gewichtProEinheit: number;

    switch (position.einheit) {
      case "stück":
        gewichtProEinheit = gewichtProStück;
        break;
      case "kiste":
        gewichtProEinheit = gewichtProKiste;
        break;
      case "karton":
        gewichtProEinheit = gewichtProKarton;
        break;
      case "kg":
        gewichtProEinheit = 1; // Für kg ist das Gewicht direkt gegeben
        break;
      default:
        throw new Error("Ungültige Einheit.");
    }

    // Berechnung Gesamtgewicht und Gesamtpreis
    position.gesamtgewicht = position.menge * gewichtProEinheit;
    position.gesamtpreis = position.gesamtgewicht * position.einzelpreis;

    next();
  }
);

export const ArtikelPosition = model<IArtikelPosition>(
  "ArtikelPosition",
  artikelPositionSchema
);
