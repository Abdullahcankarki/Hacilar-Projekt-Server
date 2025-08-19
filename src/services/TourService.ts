// backend/src/services/TourService.ts
import mongoose, { FilterQuery, Types } from "mongoose";
import { Tour } from "../model/TourModel";
import { TourStop } from "../model/TourStopModel";
import { Auftrag } from "../model/AuftragModel";
import { Fahrzeug } from "../model/FahrzeugModel";
import { recomputeTourWeight, updateOverCapacityFlag } from "./tour-hooksService"; // falls anderer Pfad: anpassen
import { TourResource, TourStatus } from "src/Resources";


/* --------------------------------- Helpers -------------------------------- */

function normalizeRegion(v?: string | null): string {
  return (v ?? "").trim();
}

// Tagesbeginn (UTC). Falls du Europe/Berlin willst, passe hier an.
function normalizeTourDate(d: Date | string): Date {
  const n = new Date(d);
  n.setUTCHours(0, 0, 0, 0);
  return n;
}

function toResource(doc: any): TourResource {
  return {
    id: doc._id.toString(),
    datum: doc.datum,
    region: doc.region,
    name: doc.name ?? undefined,
    fahrzeugId: doc.fahrzeugId ? String(doc.fahrzeugId) : undefined,
    fahrerId: doc.fahrerId ? String(doc.fahrerId) : undefined,
    maxGewichtKg: doc.maxGewichtKg ?? undefined,
    belegtesGewichtKg: doc.belegtesGewichtKg ?? 0,
    status: doc.status,
    reihenfolgeVorlageId: doc.reihenfolgeVorlageId ? String(doc.reihenfolgeVorlageId) : undefined,
    isStandard: !!doc.isStandard,
    overCapacityFlag: !!doc.overCapacityFlag,
    parentTourId: doc.parentTourId ? String(doc.parentTourId) : undefined,
    splitIndex: doc.splitIndex ?? undefined,
    archiviertAm: doc.archiviertAm ?? undefined,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
  };
}

/* ---------------------------------- CREATE --------------------------------- */

export async function createTour(data: {
  datum: Date | string;
  region: string;
  name?: string;
  fahrzeugId?: string;
  fahrerId?: string;
  maxGewichtKg?: number;
  status?: TourStatus;
  reihenfolgeVorlageId?: string;
  isStandard?: boolean;
  parentTourId?: string;
  splitIndex?: number;
}): Promise<TourResource> {
  const doc = await new Tour({
    datum: normalizeTourDate(data.datum),
    region: normalizeRegion(data.region),
    name: data.name?.trim(),
    fahrzeugId: data.fahrzeugId ? new Types.ObjectId(data.fahrzeugId) : null,
    fahrerId: data.fahrerId ? new Types.ObjectId(data.fahrerId) : null,
    maxGewichtKg: typeof data.maxGewichtKg === "number" ? data.maxGewichtKg : null,
    belegtesGewichtKg: 0,
    status: data.status ?? "geplant",
    reihenfolgeVorlageId: data.reihenfolgeVorlageId ? new Types.ObjectId(data.reihenfolgeVorlageId) : null,
    isStandard: !!data.isStandard,
    overCapacityFlag: false,
    parentTourId: data.parentTourId ? new Types.ObjectId(data.parentTourId) : null,
    splitIndex: typeof data.splitIndex === "number" ? data.splitIndex : null,
    archiviertAm: null,
  }).save();

  // Kapazitätsflag initial prüfen (falls maxGewichtKg gesetzt oder Fahrzeug verknüpft)
  await updateOverCapacityFlag(String(doc._id));

  return toResource(doc);
}

/* ----------------------------------- READ ---------------------------------- */

export async function getTourById(id: string): Promise<TourResource | null> {
  const doc = await Tour.findById(id);
  return doc ? toResource(doc) : null;
}

/* ---------------------------------- LIST ----------------------------------- */

export async function listTours(params?: {
  dateFrom?: string | Date;
  dateTo?: string | Date;
  region?: string;
  status?: TourStatus | TourStatus[];
  fahrzeugId?: string;
  fahrerId?: string;
  isStandard?: boolean;
  q?: string;         // sucht im Namen
  page?: number;
  limit?: number;
  sort?: "datumAsc" | "datumDesc" | "createdDesc";
}): Promise<{ items: TourResource[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  const skip = (page - 1) * limit;

  const filter: FilterQuery<any> = {};

  if (params?.dateFrom || params?.dateTo) {
    filter.datum = {};
    if (params.dateFrom) (filter.datum as any).$gte = normalizeTourDate(params.dateFrom);
    if (params.dateTo) (filter.datum as any).$lte = normalizeTourDate(params.dateTo);
  }

  if (params?.region) filter.region = normalizeRegion(params.region);
  if (params?.fahrzeugId) filter.fahrzeugId = new Types.ObjectId(params.fahrzeugId);
  if (params?.fahrerId) filter.fahrerId = new Types.ObjectId(params.fahrerId);
  if (typeof params?.isStandard === "boolean") filter.isStandard = params.isStandard;

  if (params?.status) {
    if (Array.isArray(params.status)) filter.status = { $in: params.status };
    else filter.status = params.status;
  }

  if (params?.q) {
    filter.name = { $regex: params.q.trim(), $options: "i" };
  }

  let sort: any = { datum: 1, splitIndex: 1 };
  if (params?.sort === "datumDesc") sort = { datum: -1, splitIndex: 1 };
  if (params?.sort === "createdDesc") sort = { createdAt: -1 };

  const [docs, total] = await Promise.all([
    Tour.find(filter).sort(sort).skip(skip).limit(limit),
    Tour.countDocuments(filter),
  ]);

  return {
    items: docs.map(toResource),
    total,
    page,
    limit,
  };
}

/* ---------------------------------- UPDATE --------------------------------- */

export async function updateTour(
  id: string,
  patch: Partial<Pick<
    TourResource,
    "datum" | "region" | "name" | "fahrzeugId" | "fahrerId" |
    "maxGewichtKg" | "status" | "reihenfolgeVorlageId" |
    "isStandard" | "parentTourId" | "splitIndex" | "archiviertAm"
  >>
): Promise<TourResource> {
  const update: any = {};

  if (patch.datum !== undefined) update.datum = normalizeTourDate(patch.datum as any);
  if (patch.region !== undefined) update.region = normalizeRegion(patch.region);
  if (patch.name !== undefined) update.name = patch.name?.trim() ?? null;

  if (patch.fahrzeugId !== undefined)
    update.fahrzeugId = patch.fahrzeugId ? new Types.ObjectId(patch.fahrzeugId) : null;

  if (patch.fahrerId !== undefined)
    update.fahrerId = patch.fahrerId ? new Types.ObjectId(patch.fahrerId) : null;

  if (patch.maxGewichtKg !== undefined)
    update.maxGewichtKg = typeof patch.maxGewichtKg === "number" ? patch.maxGewichtKg : null;

  if (patch.status !== undefined) update.status = patch.status;

  if (patch.reihenfolgeVorlageId !== undefined)
    update.reihenfolgeVorlageId = patch.reihenfolgeVorlageId ? new Types.ObjectId(patch.reihenfolgeVorlageId) : null;

  if (patch.isStandard !== undefined) update.isStandard = !!patch.isStandard;

  if (patch.parentTourId !== undefined)
    update.parentTourId = patch.parentTourId ? new Types.ObjectId(patch.parentTourId) : null;

  if (patch.splitIndex !== undefined)
    update.splitIndex = typeof patch.splitIndex === "number" ? patch.splitIndex : null;

  if (patch.archiviertAm !== undefined)
    update.archiviertAm = patch.archiviertAm ?? null;

  const doc = await Tour.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!doc) throw new Error("Tour nicht gefunden");

  // Recompute/Capacity falls fahrzeugId oder maxGewicht geändert wurden
  if (patch.fahrzeugId !== undefined || patch.maxGewichtKg !== undefined) {
    await recomputeTourWeight(String(doc._id));
    await updateOverCapacityFlag(String(doc._id));
  }

  return toResource(doc);
}

/* ------------------------------ ARCHIVE/UNARCHIVE --------------------------- */

export async function archiveTour(id: string): Promise<TourResource> {
  const nowIso = new Date().toISOString();
  const doc = await Tour.findByIdAndUpdate(
    id,
    { $set: { status: "archiviert", archiviertAm: nowIso } },
    { new: true }
  );
  if (!doc) throw new Error("Tour nicht gefunden");
  return toResource(doc);
}

export async function unarchiveTour(id: string): Promise<TourResource> {
  const doc = await Tour.findByIdAndUpdate(
    id,
    { $set: { status: "geplant", archiviertAm: null } },
    { new: true }
  );
  if (!doc) throw new Error("Tour nicht gefunden");
  return toResource(doc);
}

/* ---------------------------------- DELETE --------------------------------- */

export async function deleteTour(id: string): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const tour = await Tour.findById(id).session(session);
      if (!tour) throw new Error("Tour nicht gefunden");

      // Alle Stops holen (für Auftrags-Refs)
      const stops = await TourStop.find({ tourId: tour._id }).session(session);
      const auftragIds = Array.from(new Set(stops.map((s) => String(s.auftragId))));

      // Stops löschen
      await TourStop.deleteMany({ tourId: tour._id }).session(session);

      // Aufträge von Tour entkoppeln
      if (auftragIds.length) {
        await Auftrag.updateMany(
          { _id: { $in: auftragIds } },
          { $set: { tourId: null, tourStopId: null } },
          { session }
        );
      }

      // Tour löschen
      await Tour.deleteOne({ _id: tour._id }).session(session);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * ACHTUNG: löscht alle Touren + alle TourStops und entkoppelt alle Aufträge!
 */
export async function deleteAllTours(): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Alle Stops laden, um betroffene Aufträge zu entkoppeln
      const stops = await TourStop.find({}, { auftragId: 1 }).session(session);
      const auftragIds = Array.from(new Set(stops.map((s) => String(s.auftragId))));

      await TourStop.deleteMany({}).session(session);
      await Tour.deleteMany({}).session(session);

      if (auftragIds.length) {
        await Auftrag.updateMany(
          { _id: { $in: auftragIds } },
          { $set: { tourId: null, tourStopId: null } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
}
