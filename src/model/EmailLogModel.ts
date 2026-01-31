import { Schema, model, Types } from "mongoose";

export interface IEmailLog {
  empfaenger: string[];
  betreff: string;
  typ: "auftragsbestaetigung" | "fehlmengen" | "lieferschein" | "angebot";
  status: "gesendet" | "fehlgeschlagen";
  fehler?: string;
  auftragId?: Types.ObjectId;
  auftragNummer?: string;
  kundenName?: string;
  belegTyp?: string;
  messageId?: string;
  pdfBase64?: string;
  pdfFilename?: string;
}

const emailLogSchema = new Schema<IEmailLog>(
  {
    empfaenger: { type: [String], required: true },
    betreff: { type: String, required: true },
    typ: {
      type: String,
      enum: ["auftragsbestaetigung", "fehlmengen", "lieferschein", "angebot"],
      required: true,
    },
    status: {
      type: String,
      enum: ["gesendet", "fehlgeschlagen"],
      required: true,
    },
    fehler: { type: String },
    auftragId: { type: Schema.Types.ObjectId, ref: "Auftrag" },
    auftragNummer: { type: String },
    kundenName: { type: String },
    belegTyp: { type: String },
    messageId: { type: String },
    pdfBase64: { type: String },
    pdfFilename: { type: String },
  },
  { timestamps: true }
);

emailLogSchema.index({ createdAt: -1 });
emailLogSchema.index({ typ: 1 });
emailLogSchema.index({ status: 1 });

export const EmailLog = model<IEmailLog>("EmailLog", emailLogSchema);
