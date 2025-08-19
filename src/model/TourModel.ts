import { Schema, model, Types, Document, Model, ClientSession } from "mongoose";

export type TourStatus = "geplant" | "laufend" | "abgeschlossen" | "archiviert";

export interface TourDoc extends Document {
  _id: Types.ObjectId;
  datum: Date;
  region: string;
  name?: string;
  fahrzeugId?: Types.ObjectId | null;
  fahrerId?: Types.ObjectId | null;
  maxGewichtKg?: number | null;
  belegtesGewichtKg: number;
  status: TourStatus;
  reihenfolgeVorlageId?: Types.ObjectId | null;
  isStandard?: boolean;
  overCapacityFlag?: boolean;
  parentTourId?: Types.ObjectId | null;
  splitIndex?: number | null;
  archiviertAm?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const TourSchema = new Schema<TourDoc, TourModel>(
  {
    datum: { type: Date, required: true, index: true },
    region: { type: String, required: true, index: true },
    name: { type: String },
    fahrzeugId: { type: Schema.Types.ObjectId, ref: "Fahrzeug", default: null, index: true },
    fahrerId: { type: Schema.Types.ObjectId, ref: "Mitarbeiter", default: null, index: true },
    maxGewichtKg: { type: Number, default: null },
    belegtesGewichtKg: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ["geplant", "laufend", "abgeschlossen", "archiviert"], default: "geplant", index: true },
    reihenfolgeVorlageId: { type: Schema.Types.ObjectId, ref: "ReihenfolgeVorlage", default: null },
    isStandard: { type: Boolean, default: false, index: true },
    overCapacityFlag: { type: Boolean, default: false },
    parentTourId: { type: Schema.Types.ObjectId, ref: "Tour", default: null, index: true },
    splitIndex: { type: Number, default: null },
    archiviertAm: { type: String, default: null },
  },
  { timestamps: true }
);

// --- Indexes ---
TourSchema.index({ datum: 1, region: 1 }); // mehrere Touren erlaubt
// Genau eine Standard-Tour pro Tag/Region:
TourSchema.index(
  { datum: 1, region: 1, isStandard: 1 },
  { unique: true, partialFilterExpression: { isStandard: true }, name: "uniq_standard_per_day_region" }
);
TourSchema.index({ status: 1 });
TourSchema.index({ createdAt: 1 });

// --- Normalization hooks ---
TourSchema.pre("save", function (next) {
  if (this.isModified("region") && typeof this.region === "string") {
    this.region = this.region.trim().toLowerCase();
  }
  next();
});

// --- Model interface for statics ---
export interface TourModel extends Model<TourDoc> {
  findOrCreateStandard(
    datum: Date,
    region: string,
    opts?: { session?: ClientSession; normalizeDate?: boolean }
  ): Promise<TourDoc>;
}

// Tagesbeginn normalisieren (UTC – bei Bedarf auf Europe/Berlin umstellen)
function normalizeTourDate(d: Date): Date {
  const n = new Date(d);
  n.setUTCHours(0, 0, 0, 0);
  return n;
}

TourSchema.static(
  "findOrCreateStandard",
  async function (
    this: TourModel, // <<< wichtig
    datum: Date,
    region: string,
    opts?: { session?: ClientSession; normalizeDate?: boolean }
  ): Promise<TourDoc> {
    const session = opts?.session;
    const date = opts?.normalizeDate === false ? new Date(datum) : normalizeTourDate(datum);
    const normalizedRegion = (region || "").trim().toLowerCase();

    const doc = await this.findOneAndUpdate(
      { datum: date, region: normalizedRegion, isStandard: true },
      {
        $setOnInsert: {
          datum: date,
          region: normalizedRegion,
          belegtesGewichtKg: 0,
          status: "geplant",
          isStandard: true,
        },
      },
      {
        new: true,
        upsert: true,
        session,
        setDefaultsOnInsert: true,
      }
    );

    return doc as TourDoc;
  }
);

export const Tour = model<TourDoc, TourModel>("Tour", TourSchema);
export default Tour;
