// backend/src/services/FahrzeugService.ts
import mongoose, { FilterQuery } from "mongoose";
import { Fahrzeug as FahrzeugModel } from "../model/FahrzeugModel";
import { Tour } from "../model/TourModel";
import { FahrzeugResource } from "src/Resources";

/* --------------------------------- Helpers -------------------------------- */

function normalizeKennzeichen(v?: string | null): string {
  return (v ?? "").trim().toUpperCase();
}

function normalizeText(v?: string | null): string | undefined {
  const s = (v ?? "").trim();
  return s.length ? s : undefined;
}

function normalizeRegionen(arr?: string[] | null): string[] | undefined {
  if (!arr || !Array.isArray(arr)) return undefined;
  const cleaned = arr
    .map((x) => (x ?? "").trim())
    .filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function toResource(doc: any): FahrzeugResource {
  return {
    id: doc._id.toString(),
    kennzeichen: doc.kennzeichen,
    name: doc.name ?? undefined,
    maxGewichtKg: doc.maxGewichtKg,
    aktiv: !!doc.aktiv,
    regionen: doc.regionen ?? undefined,
    samsaraVehicleId: doc.samsaraVehicleId ?? undefined,
    bemerkung: doc.bemerkung ?? undefined,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
  };
}

/* ---------------------------------- CRUD ---------------------------------- */

/**
 * Neues Fahrzeug anlegen.
 */
export async function createFahrzeug(data: {
  kennzeichen: string;
  name?: string;
  maxGewichtKg: number;
  aktiv?: boolean;
  regionen?: string[];
  samsaraVehicleId?: string;
  bemerkung?: string;
}): Promise<FahrzeugResource> {
  const doc = await new FahrzeugModel({
    kennzeichen: normalizeKennzeichen(data.kennzeichen),
    name: normalizeText(data.name),
    maxGewichtKg: Number(data.maxGewichtKg),
    aktiv: data.aktiv ?? true,
    regionen: normalizeRegionen(data.regionen),
    samsaraVehicleId: normalizeText(data.samsaraVehicleId),
    bemerkung: normalizeText(data.bemerkung),
  }).save();

  return toResource(doc);
}

/**
 * Ein Fahrzeug laden.
 */
export async function getFahrzeugById(id: string): Promise<FahrzeugResource | null> {
  const doc = await FahrzeugModel.findById(id);
  return doc ? toResource(doc) : null;
}

/**
 * Fahrzeuge auflisten (optionale Filter + einfache Pagination).
 */
export async function listFahrzeuge(params?: {
  aktiv?: boolean;
  region?: string;     // enthält region string
  q?: string;          // Volltext: kennzeichen / name
  page?: number;       // 1-basiert
  limit?: number;      // default 50
}): Promise<{ items: FahrzeugResource[]; total: number; page: number; limit: number; }> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  const skip = (page - 1) * limit;

  const filter: FilterQuery<any> = {};
  if (typeof params?.aktiv === "boolean") filter.aktiv = params.aktiv;
  if (params?.region) filter.regionen = { $in: [params.region.trim()] };

  if (params?.q) {
    const q = params.q.trim();
    filter.$or = [
      { kennzeichen: { $regex: q, $options: "i" } },
      { name: { $regex: q, $options: "i" } },
      { bemerkung: { $regex: q, $options: "i" } },
    ];
  }

  const [docs, total] = await Promise.all([
    FahrzeugModel.find(filter).sort({ aktiv: -1, name: 1 }).skip(skip).limit(limit),
    FahrzeugModel.countDocuments(filter),
  ]);

  return {
    items: docs.map(toResource),
    total,
    page,
    limit,
  };
}

/**
 * Fahrzeug aktualisieren (nur übergebene Felder).
 */
export async function updateFahrzeug(
  id: string,
  patch: Partial<Pick<
    FahrzeugResource,
    "kennzeichen" | "name" | "maxGewichtKg" | "aktiv" | "regionen" | "samsaraVehicleId" | "bemerkung"
  >>
): Promise<FahrzeugResource> {
  const update: any = {};

  if (patch.kennzeichen !== undefined) update.kennzeichen = normalizeKennzeichen(patch.kennzeichen);
  if (patch.name !== undefined) update.name = normalizeText(patch.name) ?? null;
  if (patch.maxGewichtKg !== undefined) update.maxGewichtKg = Number(patch.maxGewichtKg);
  if (patch.aktiv !== undefined) update.aktiv = !!patch.aktiv;
  if (patch.regionen !== undefined) update.regionen = normalizeRegionen(patch.regionen) ?? [];
  if (patch.samsaraVehicleId !== undefined) update.samsaraVehicleId = normalizeText(patch.samsaraVehicleId) ?? null;
  if (patch.bemerkung !== undefined) update.bemerkung = normalizeText(patch.bemerkung) ?? null;

  const doc = await FahrzeugModel.findByIdAndUpdate(id, update, { new: true });
  if (!doc) throw new Error("Fahrzeug nicht gefunden");

  return toResource(doc);
}

/**
 * Fahrzeug löschen.
 * Zusätzlich werden in Touren Referenzen auf dieses Fahrzeug entfernt (unset),
 * damit keine toten Referenzen bleiben.
 */
export async function deleteFahrzeug(id: string): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const deleted = await FahrzeugModel.findByIdAndDelete(id).session(session);
      if (!deleted) throw new Error("Fahrzeug nicht gefunden");

      // Referenzen in Touren entfernen (fahrzeugId, maxGewicht ggf. unberührt)
      await Tour.updateMany(
        { fahrzeugId: deleted._id },
        { $set: { fahrzeugId: null } },
        { session }
      );
      // Optional: OverCapacity-Flags der betroffenen Touren neu setzen
      // (nur sinnvoll, wenn maxGewicht aus Fahrzeug gelesen wurde)
      // Wenn du hier eine Utility wie updateOverCapacityFlag hast, kannst du
      // die betroffenen Touren nachziehen. Für Performance lassen wir es hier weg.
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Alle Fahrzeuge löschen.
 * Achtung: setzt in allen Touren fahrzeugId auf null.
 */
export async function deleteAllFahrzeuge(): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Alle Fahrzeug-IDs sammeln, um danach Referenzen zu nullen
      const fahrzeuge = await FahrzeugModel.find({}, { _id: 1 }).session(session);
      const ids = fahrzeuge.map((f) => f._id);

      await FahrzeugModel.deleteMany({}).session(session);

      if (ids.length) {
        await Tour.updateMany(
          { fahrzeugId: { $in: ids } },
          { $set: { fahrzeugId: null } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
}
