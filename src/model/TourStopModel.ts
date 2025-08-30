// backend/src/model/TourStopModel.ts
import { Schema, model, Types, Document } from "mongoose";

export type StopStatus =
  | "offen"
  | "unterwegs"
  | "zugestellt"
  | "teilweise"
  | "fehlgeschlagen";
export type FehlgrundEnum =
  | "KUNDE_NICHT_ERREICHBAR"
  | "ANNAHME_VERWEIGERT"
  | "FALSCH_ADRESSE"
  | "NICHT_RECHTZEITIG"
  | "WARE_BESCHAEDIGT"
  | "SONSTIGES";

export interface TourStopDoc extends Document {
  _id: Types.ObjectId;
  tourId: Types.ObjectId; // ref: Tour
  auftragId: Types.ObjectId; // ref: Auftrag (1 Auftrag = 1 Stop)
  kundeId: Types.ObjectId; // ref: Kunde (denormalisiert)
  kundeName?: string;
  kundeAdress?: string;
  position: number; // 1..n
  gewichtKg?: number | null; // optional, Fallback aus Auftrag
  status: StopStatus;
  fehlgrund?: { code?: FehlgrundEnum; text?: string };
  // Proof (ohne Fotos):
  signaturPngBase64?: string | null;
  signTimestampUtc?: string | null;
  signedByName?: string | null;
  // Leergut Mitnahme (Stop-Ebene, unabhängig von artikelbezogenem Leergut):
  leergutMitnahme?: { art: string; anzahl: number; gewichtKg?: number }[];
  abgeschlossenAm?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const TourStopSchema = new Schema<TourStopDoc>(
  {
    tourId: {
      type: Schema.Types.ObjectId,
      ref: "Tour",
      required: true,
      index: true,
    },
    auftragId: {
      type: Schema.Types.ObjectId,
      ref: "Auftrag",
      required: true,
      unique: true,
    },
    kundeId: {
      type: Schema.Types.ObjectId,
      ref: "Kunde",
      required: true,
      index: true,
    },
    kundeName: { type: String },
    kundeAdress: { type: String },
    position: { type: Number, required: true }, // Unique zusammen mit tourId, s.u.
    gewichtKg: { type: Number, default: null },
    status: {
      type: String,
      enum: ["offen", "unterwegs", "zugestellt", "teilweise", "fehlgeschlagen"],
      default: "offen",
      index: true,
    },
    fehlgrund: {
      code: {
        type: String,
        enum: [
          "KUNDE_NICHT_ERREICHBAR",
          "ANNAHME_VERWEIGERT",
          "FALSCH_ADRESSE",
          "NICHT_RECHTZEITIG",
          "WARE_BESCHAEDIGT",
          "SONSTIGES",
        ],
        required: false,
      },
      text: { type: String },
    },
    signaturPngBase64: { type: String },
    signTimestampUtc: { type: String, default: null },
    signedByName: { type: String, default: null },
    leergutMitnahme: [{ art: String, anzahl: Number, gewichtKg: Number }],
    abgeschlossenAm: { type: String, default: null },
  },
  { timestamps: true }
);

// Indexe
TourStopSchema.index({ tourId: 1, position: 1 }, { unique: true }); // keine Positionskollisionen je Tour
TourStopSchema.index({ status: 1 });

// Konsistenz-Hilfen (optional, aber nützlich)
// Falls KundeName o.Ä. normalisieren willst:
TourStopSchema.pre("save", function (next) {
  if (this.isModified("kundeName") && typeof this.kundeName === "string") {
    this.kundeName = this.kundeName.trim();
  }
  next();
});

export const TourStop = model<TourStopDoc>("TourStop", TourStopSchema);
export default TourStop;
