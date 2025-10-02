import { Schema, Types, model} from "mongoose";

export interface IKunde{
    name: string; // Name des Kunden
    kundenNummer?: string;
    password: string //Password
    email: string; // E-Mail des Kunden
    adresse: string; // Adresse des Kunden
    telefon?: string; // Telefonnummer des Kunden
    createdAt: Date; // Erstellungsdatum
    updatedAt: Date; // Aktualisierungsdatum
    favoriten?: Types.ObjectId[];
    lieferzeit?: string;
    ustId?: string;
    handelsregisterNr?: string;
    ansprechpartner?: string;
    website?: string;
    branchenInfo?: string;
    region?: string;
    kategorie?: string;
    isApproved: boolean;
    gewerbeDateiUrl: string;
    zusatzDateiUrl?: string;
    // E-Mail-Empfänger für Belegversand (Phase 4)
    emailRechnung?: string;
    emailLieferschein?: string;
    emailBuchhaltung?: string;
    emailSpedition?: string;
}

const kundeSchema = new Schema<IKunde>({
    name: {type: String, required: true},
    kundenNummer: {type: String, unique: true},
    password: {type: String, required: true},
    email: { type: String, required: true, unique: true },
    adresse: { type: String, required: true },
    telefon: { type: String, required: false },
    favoriten: [{ type: Schema.Types.ObjectId, ref: "Artikel" }],
    lieferzeit: { type: String},
    ustId: { type: String },
    handelsregisterNr: { type: String },
    ansprechpartner: { type: String },
    website: { type: String },
    branchenInfo: { type: String },
    region: { type: String },
    kategorie: { type: String },
    isApproved: { type: Boolean, default: false },
    gewerbeDateiUrl: { type: String },
    zusatzDateiUrl: { type: String },
    // E-Mail-Empfänger für Belegversand (Phase 4)
    emailRechnung: { type: String },
    emailLieferschein: { type: String },
    emailBuchhaltung: { type: String },
    emailSpedition: { type: String },
  },
  { timestamps: true }
)

export const Kunde = model<IKunde>("Kunde", kundeSchema);