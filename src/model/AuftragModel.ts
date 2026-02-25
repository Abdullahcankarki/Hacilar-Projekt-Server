import { Document, Schema, Types, model } from "mongoose";

export interface IAuftrag extends Document {
  auftragsnummer: string;
  kunde: Types.ObjectId; // Referenz zu Kunde-Model
  kundeName: string;
  artikelPosition: Types.ObjectId[]; // Array von Referenzen zu ArtikelPositionen
  status: "offen" | "in Bearbeitung" | "abgeschlossen" | "storniert"; // Auftragsstatus
  lieferdatum: Date; // Gewünschtes Lieferdatum
  bemerkungen: string; // Optionale Bemerkungen
  bearbeiter: string;
  gewicht: number;
  gesamtPaletten: number;
  gesamtBoxen: number;
  kommissioniertVon?: Types.ObjectId;
  kommissioniertVonName?: string;
  kontrolliertVon?: Types.ObjectId;
  kontrolliertVonName?: string;
  kommissioniertStatus?: "offen" | "gestartet" | "fertig";
  kontrolliertStatus?: "offen" | "in Kontrolle" | "geprüft";
  kommissioniertStartzeit?: Date;
  kommissioniertEndzeit?: Date;
  kontrolliertZeit?: Date;
  beladeStatus?: "offen" | "beladen";
  beladeVon?: Types.ObjectId;
  beladeVonName?: string;
  beladeZeit?: Date;
  fahrer?: string;
  fahrzeug?: string;
  createdAt: Date; // Erstellungsdatum
  updatedAt: Date; // Aktualisierungsdatum
  tourId?: Types.ObjectId | null;
  tourStopId?: Types.ObjectId | null;

  // ==== Belegwesen (Phase 4) ====
  lieferscheinNummer?: string;
  rechnungsNummer?: string;
  gutschriftNummern?: string[];        // mehrere Gutschriften möglich
  preisdifferenzNummern?: string[];    // mehrere Preisdifferenzen möglich

  zahlstatus?: "offen" | "teilweise" | "bezahlt";
  offenBetrag?: number;
  zahlungsDatum?: Date;

  belegListe?: Schema.Types.Mixed[];          // Array für Beleg-Metadaten
  emailLogs?: Schema.Types.Mixed[];           // Versand-Historie
}

const auftragSchema = new Schema<IAuftrag>(
  {
    auftragsnummer: { type: String, default: "0" },
    kunde: { type: Schema.Types.ObjectId, ref: "Kunde", required: true },
    kundeName: { type: String, required: false},
    artikelPosition: [{ type: Schema.Types.ObjectId, ref: "ArtikelPosition" }],
    status: {
      type: String,
      enum: ["offen", "in Bearbeitung", "abgeschlossen", "storniert"],
      default: "offen",
    },
    lieferdatum: { type: Date, required: false },
    bemerkungen: { type: String, required: false },
    bearbeiter: { type: String, required: false },
    gewicht: { type: Number },
    gesamtPaletten: { type: Number, required: false },
    gesamtBoxen: { type: Number, required: false },
    kommissioniertVon: { type: Schema.Types.ObjectId, ref: "User" },
    kommissioniertVonName: { type: String },
    kontrolliertVon: { type: Schema.Types.ObjectId, ref: "User" },
    kontrolliertVonName: { type: String },
    kommissioniertStatus: {
      type: String,
      enum: ["offen", "gestartet", "fertig"],
    },
    kontrolliertStatus: {
      type: String,
      enum: ["offen", "in Kontrolle", "geprüft"],
    },
    kommissioniertStartzeit: { type: Date },
    kommissioniertEndzeit: { type: Date },
    kontrolliertZeit: { type: Date },
    beladeStatus: {
      type: String,
      enum: ["offen", "beladen"],
    },
    beladeVon: { type: Schema.Types.ObjectId, ref: "User" },
    beladeVonName: { type: String },
    beladeZeit: { type: Date },
    fahrer: { type: String },
    fahrzeug: { type: String },
    tourId: { type: Schema.Types.ObjectId, ref: "Tour" },
    tourStopId: { type: Schema.Types.ObjectId, ref: "TourStop" },

    // ==== Belegwesen (Phase 4) ====
    lieferscheinNummer: { type: String },
    rechnungsNummer: { type: String },
    gutschriftNummern: [{ type: String }],
    preisdifferenzNummern: [{ type: String }],

    zahlstatus: { type: String, enum: ["offen", "teilweise", "bezahlt"] },
    offenBetrag: { type: Number },
    zahlungsDatum: { type: Date },

    belegListe: { type: [Schema.Types.Mixed], default: [] },
    emailLogs: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

export const Auftrag = model<IAuftrag>("Auftrag", auftragSchema);
