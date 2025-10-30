// backend/src/services/ChargeService.ts
import { FilterQuery } from "mongoose";
import { ChargeModel } from "../../model/ChargeModel";
import { ArtikelModel } from "../../model/ArtikelModel";
import { ChargeResource } from "src/Resources";

/* --------------------------------- Helpers -------------------------------- */

function toISODate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

function parseISODateRequired(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error("Ungültiges Datum: " + s);
  return d;
}

function normalizeBool(v: boolean | undefined): boolean {
  return !!v;
}

async function denormArtikel(artikelId: string): Promise<{
  artikelName?: string;
  artikelNummer?: string;
}> {
  const a = await ArtikelModel.findById(artikelId).select({
    name: 1,
    artikelNummer: 1,
  });
  return a
    ? { artikelName: a.name ?? undefined, artikelNummer: a.artikelNummer ?? undefined }
    : {};
}

function toResource(doc: any): ChargeResource {
  return {
    id: doc._id.toString(),
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    lieferantId: doc.lieferantId ? doc.lieferantId.toString() : undefined,
    mhd: toISODate(doc.mhd)?.slice(0, 10)!, // YYYY-MM-DD
    schlachtDatum: toISODate(doc.schlachtDatum)?.slice(0, 10),
    isTK: !!doc.isTK,
    createdAt: toISODate(doc.createdAt),
    updatedAt: toISODate(doc.updatedAt),
  };
}

/* ---------------------------------- CRUD ---------------------------------- */

/**
 * Neue Charge anlegen (mit denormalisiertem Artikelname/-nummer).
 */
export async function createCharge(data: {
  artikelId: string;
  mhd: string;                 // ISO YYYY-MM-DD
  schlachtDatum?: string;      // ISO YYYY-MM-DD
  isTK: boolean;
  lieferantId?: string;
}): Promise<ChargeResource> {
  const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);

  const doc = await new ChargeModel({
    artikelId: data.artikelId,
    artikelName,
    artikelNummer,
    lieferantId: data.lieferantId ?? undefined,
    mhd: parseISODateRequired(data.mhd),
    schlachtDatum: data.schlachtDatum ? parseISODateRequired(data.schlachtDatum) : undefined,
    isTK: normalizeBool(data.isTK),
  }).save();

  return toResource(doc);
}

/**
 * Eine Charge laden.
 */
export async function getChargeById(id: string): Promise<ChargeResource | null> {
  const doc = await ChargeModel.findById(id);
  return doc ? toResource(doc) : null;
}

/**
 * Chargen auflisten (Filter + Pagination).
 */
export async function listCharges(params?: {
  artikelId?: string;
  isTK?: boolean;
  mhdFrom?: string; // inklusiv
  mhdTo?: string;   // inklusiv
  q?: string;       // sucht in artikelName/Nummer und Charge-ID
  page?: number;    // 1-basiert
  limit?: number;   // default = all (wie im FahrzeugService)
}): Promise<{
  items: ChargeResource[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, params?.page ?? 1);
  const totalDocsAll = await ChargeModel.estimatedDocumentCount();
  const limit =
    params?.limit !== undefined
      ? Math.min(200, Math.max(1, params?.limit ?? 50))
      : totalDocsAll;
  const skip = (page - 1) * limit;

  const filter: FilterQuery<any> = {};
  if (params?.artikelId) filter.artikelId = params.artikelId;
  if (typeof params?.isTK === "boolean") filter.isTK = params.isTK;

  if (params?.mhdFrom || params?.mhdTo) {
    filter.mhd = {};
    if (params.mhdFrom) filter.mhd.$gte = parseISODateRequired(params.mhdFrom);
    if (params.mhdTo) {
      // inklusiv: Ende des Tages
      const end = new Date(params.mhdTo);
      end.setHours(23, 59, 59, 999);
      filter.mhd.$lte = end;
    }
  }

  if (params?.q) {
    const q = params.q.trim();
    // Sucht in artikelName, artikelNummer, und erlaubt Suche via ObjectId-String
    filter.$or = [
      { artikelName: { $regex: q, $options: "i" } },
      { artikelNummer: { $regex: q, $options: "i" } },
      { _id: q.match(/^[a-f0-9]{24}$/i) ? q : undefined }, // einfacher ID-Match
    ].filter(Boolean) as any[];
  }

  const [docs, total] = await Promise.all([
    ChargeModel.find(filter)
      .sort({ mhd: 1, createdAt: 1 })
      .skip(skip)
      .limit(limit),
    ChargeModel.countDocuments(filter),
  ]);

  return {
    items: docs.map(toResource),
    total,
    page,
    limit,
  };
}

/**
 * Charge aktualisieren (nur übergebene Felder).
 * Bei Artikelwechsel wird der Artikel-Name/Nummer neu denormalisiert.
 */
export async function updateCharge(
  id: string,
  patch: Partial<{
    artikelId: string;
    mhd: string;
    schlachtDatum: string;
    isTK: boolean;
    lieferantId: string;
  }>
): Promise<ChargeResource> {
  const update: any = {};

  // Wenn artikelId wechselt, denormalisierte Felder neu befüllen
  if (patch.artikelId !== undefined) {
    update.artikelId = patch.artikelId;
    const { artikelName, artikelNummer } = await denormArtikel(patch.artikelId);
    update.artikelName = artikelName ?? null;
    update.artikelNummer = artikelNummer ?? null;
  }

  if (patch.mhd !== undefined) update.mhd = parseISODateRequired(patch.mhd);
  if (patch.schlachtDatum !== undefined)
    update.schlachtDatum = patch.schlachtDatum
      ? parseISODateRequired(patch.schlachtDatum)
      : null;
  if (patch.isTK !== undefined) update.isTK = normalizeBool(patch.isTK);
  if (patch.lieferantId !== undefined) update.lieferantId = patch.lieferantId ?? null;

  const doc = await ChargeModel.findByIdAndUpdate(id, update, { new: true });
  if (!doc) throw new Error("Charge nicht gefunden");

  return toResource(doc);
}

/**
 * Charge löschen.
 * Hinweis: Nur zulässig, wenn keine Bewegungen darauf referenzieren (Prüfung optional hier).
 */
export async function deleteCharge(id: string): Promise<void> {
  const res = await ChargeModel.findByIdAndDelete(id);
  if (!res) throw new Error("Charge nicht gefunden");
}