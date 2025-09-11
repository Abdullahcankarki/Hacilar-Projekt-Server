// backend/src/services/TourService.ts
import mongoose, { FilterQuery, Types } from "mongoose";
import { Tour } from "../model/TourModel";
import { TourStop } from "../model/TourStopModel";
import { Auftrag } from "../model/AuftragModel";
import { Fahrzeug } from "../model/FahrzeugModel";
import { recomputeTourWeight, updateOverCapacityFlag } from "./tour-hooksService"; // falls anderer Pfad: anpassen
import { DateTime } from "luxon";
import { TourResource, TourStatus } from "src/Resources";


/* --------------------------------- Helpers -------------------------------- */

function normalizeRegion(v?: string | null): string {
  return (v ?? "").trim();
}

// Tagesbeginn in Europe/Berlin, robust gegen verschiedene Eingabeformate
function normalizeTourDate(d: Date | string): Date {
  const Z = "Europe/Berlin" as const;
  let dt = d instanceof Date ? DateTime.fromJSDate(d, { zone: Z }) : DateTime.fromISO(String(d), { zone: Z });
  if (!dt.isValid) dt = DateTime.fromFormat(String(d), "dd.LL.yyyy", { zone: Z });
  if (!dt.isValid) dt = DateTime.fromFormat(String(d), "yyyyLLdd", { zone: Z });
  if (!dt.isValid) {
    const js = new Date(String(d));
    if (!Number.isNaN(js.valueOf())) dt = DateTime.fromJSDate(js, { zone: Z });
  }
  if (!dt.isValid) return new Date(NaN);
  // Start of local day, then convert to UTC Date for storage/query
  const startLocal = dt.startOf("day");
  return new Date(startLocal.toUTC().toISO());
}

function toISODateBerlinFromDoc(d: any): string | undefined {
  if (!d) return undefined;
  const Z = "Europe/Berlin" as const;
  // Case A: native Date
  if (d instanceof Date && !Number.isNaN(d.valueOf())) {
    const dt = DateTime.fromJSDate(d, { zone: Z });
    return dt.isValid ? dt.toISODate() ?? undefined : undefined;
  }
  // Case B: Mongoose Date-like (e.g., doc.get("datum"))
  try {
    const asDate = new Date(d as any);
    if (!Number.isNaN(asDate.valueOf())) {
      const dt = DateTime.fromJSDate(asDate, { zone: Z });
      return dt.isValid ? dt.toISODate() ?? undefined : undefined;
    }
  } catch {}
  // Case C: ISO date string already
  if (typeof d === "string") {
    const iso = DateTime.fromISO(d, { zone: Z });
    if (iso.isValid) return iso.toISODate() ?? undefined;
  }
  return undefined;
}

function getBerlinISODateInput(d: Date | string): string | undefined {
  // If already YYYY-MM-DD, trust and return
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
  // Otherwise reuse existing converter
  return toISODateBerlinFromDoc(d as any);
}

function toResource(doc: any): TourResource {
  return {
    id: doc._id.toString(),
    datum: (doc.datum instanceof Date) ? doc.datum : new Date(doc.datum),
    datumIso: doc.datumIso ?? toISODateBerlinFromDoc(doc.datum),
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
  const datumIso = getBerlinISODateInput(data.datum);
  const doc = await new Tour({
    datum: normalizeTourDate(data.datum),
    datumIso: datumIso ?? null,
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
    // Prefer string range on datumIso (robust, TZ-agnostic)
    const directFrom = typeof params?.dateFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom.trim())
      ? params.dateFrom.trim()
      : undefined;
    const directTo = typeof params?.dateTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo.trim())
      ? params.dateTo.trim()
      : undefined;

    const Z = "Europe/Berlin" as const;
    const fromLocal = directFrom
      ? DateTime.fromISO(directFrom, { zone: Z })
      : (params?.dateFrom ? DateTime.fromISO(String(params.dateFrom), { zone: Z }).startOf("day") : null);
    const toLocal = directTo
      ? DateTime.fromISO(directTo, { zone: Z })
      : (params?.dateTo ? DateTime.fromISO(String(params.dateTo), { zone: Z }).endOf("day") : null);

    const fromUtc = fromLocal && fromLocal.isValid ? fromLocal.toUTC() : null;
    const toUtc = toLocal && toLocal.isValid ? toLocal.toUTC() : null;

    // Bounds for legacy Date storage
    const dateBoundsDate: any = {
      ...(fromUtc ? { $gte: new Date(fromUtc.toISO()) } : {}),
      ...(toUtc ? { $lte: new Date(toUtc.toISO()) } : {}),
    };

    // Bounds for string storage (YYYY-MM-DD). If user supplied direct YYYY-MM-DD, use directly.
    const fromStr = directFrom ?? (fromLocal && fromLocal.isValid ? fromLocal.toFormat("yyyy-LL-dd") : undefined);
    const toStr   = directTo   ?? (toLocal   && toLocal.isValid   ? toLocal.toFormat("yyyy-LL-dd") : undefined);
    const dateBoundsString: any = {
      ...(fromStr ? { $gte: fromStr } : {}),
      ...(toStr ? { $lte: toStr } : {}),
    };

    // Prefer filtering on datumIso if available, but keep backward-compatible $or
    const or: any[] = [];
    if (Object.keys(dateBoundsString).length) {
      or.push({ datumIso: dateBoundsString });
    }
    if (Object.keys(dateBoundsDate).length) {
      or.push({ datum: dateBoundsDate });
    }

    if (or.length === 1) {
      Object.assign(filter, or[0]);
    } else if (or.length > 1) {
      (filter as any).$or = or;
    }
  }

  if (params?.region) filter.region = normalizeRegion(params.region);
  if (params?.fahrzeugId) filter.fahrzeugId = new Types.ObjectId(params.fahrzeugId);
  if (params?.fahrerId) filter.fahrerId = new Types.ObjectId(params.fahrerId);
  if (typeof params?.isStandard === "boolean") filter.isStandard = params.isStandard;

  if (params?.status) {
    const raw = params.status as any;
    const arr = Array.isArray(raw)
      ? raw
      : String(raw)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    if (arr.length <= 1) {
      filter.status = arr.length === 1 ? arr[0] : raw;
    } else {
      filter.status = { $in: arr };
    }
  }

  if (params?.q) {
    filter.name = { $regex: params.q.trim(), $options: "i" };
  }

  let sort: any = { datum: 1, splitIndex: 1, createdAt: 1 };
  if (params?.sort === "datumDesc") sort = { datum: -1, splitIndex: 1, createdAt: 1 };
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

  if (patch.datum !== undefined) {
    update.datum = normalizeTourDate(patch.datum as any);
    const iso = getBerlinISODateInput(patch.datum as any);
    update.datumIso = iso ?? null;
  }
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

export async function backfillTourDatumIso(): Promise<{ updated: number }> {
  const cursor = Tour.find({ $or: [ { datumIso: { $exists: false } }, { datumIso: null }, { datumIso: "" } ] }, { _id: 1, datum: 1 }).cursor();
  let updated = 0;
  for await (const doc of cursor as any) {
    const iso = toISODateBerlinFromDoc(doc.datum);
    await Tour.updateOne({ _id: doc._id }, { $set: { datumIso: iso ?? null } });
    updated++;
  }
  return { updated };
}
