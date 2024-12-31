import { Schema, model} from "mongoose";

export interface IKunde{
    name: string; // Name des Kunden
    kundennr: string;
    password: string //Password
    email: string; // E-Mail des Kunden
    adresse: string; // Adresse des Kunden
    telefon: string; // Telefonnummer des Kunden
    createdAt: Date; // Erstellungsdatum
    updatedAt: Date; // Aktualisierungsdatum
}

const kundeSchema = new Schema<IKunde>({
    name: {type: String, required: true},
    kundennr: {type: String, required: true, unique: true},
    password: {type: String, required: true},
    email: { type: String, required: true, unique: true },
    adresse: { type: String, required: true },
    telefon: { type: String, required: false },
  },
  { timestamps: true }
)

export const Kunde = model<IKunde>("Kunde", kundeSchema);