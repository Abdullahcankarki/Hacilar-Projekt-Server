// backend/src/services/HistorieService.ts
import { FilterQuery, Types } from "mongoose";
import { BewegungModel } from "../../model/BewegungsModel";
import { ArtikelModel } from "../../model/ArtikelModel";
import { ChargeModel } from "../../model/ChargeModel";
import { BewegungResource, Lagerbereich } from "src/Resources";
import * as fs from "fs";
import * as path from "path";
import { format as csvFormat } from "@fast-csv/format";

/* --------------------------------- Helpers -------------------------------- */

function toISO(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

function endOfDay(iso?: string): Date {
  const d = iso ? new Date(iso) : new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function toResource(doc: any): BewegungResource {
  return {
    id: doc._id.toString(),
    timestamp: toISO(doc.timestamp)!,
    userId: doc.userId ? doc.userId.toString() : undefined,
    typ: doc.typ,
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    kundeName: doc.kundeName ?? undefined,
    lieferDatum: doc.lieferDatum ? toISO(doc.lieferDatum)?.slice(0, 10) : undefined,
    chargeId: doc.chargeId ? doc.chargeId.toString() : undefined,
    menge: Number(doc.menge),
    lagerbereich: doc.lagerbereich as Lagerbereich,
    auftragId: doc.auftragId ? doc.auftragId.toString() : undefined,
    notiz: doc.notiz ?? undefined,
    mhd: doc.mhd ? toISO(doc.mhd)?.slice(0, 10) : undefined,
    schlachtDatum: doc.schlachtDatum ? toISO(doc.schlachtDatum)?.slice(0, 10) : undefined,
    isTK: typeof doc.isTK === "boolean" ? !!doc.isTK : undefined,
  };
}

/* ---------------------------------- DTOs ---------------------------------- */

export type ListBewegungenParams = {
  from?: string;          // ISO (inkl. Uhrzeit erlaubt)
  to?: string;            // ISO (Tagesende inkl.)
  typ?: string;           // exakte Matches oder comma-list: "MULL,KOMMISSIONIERUNG"
  artikelId?: string;
  chargeId?: string;
  auftragId?: string;
  lagerbereich?: Lagerbereich;
  q?: string;             // volltext: artikelName/Nummer/notiz/kundeName
  page?: number;          // 1-basiert
  limit?: number;         // default = alle
};

export type ExportBewegungenCSVParams = ListBewegungenParams & {
  filename?: string;      // optionaler Dateiname
  dir?: string;           // Zielordner (default ./tmp)
};

/* ---------------------------------- API ----------------------------------- */

/** Einzelne Bewegung laden (Detail/Drilldown) */
export async function getBewegungById(id: string): Promise<BewegungResource | null> {
  const doc = await BewegungModel.findById(id);
  return doc ? toResource(doc) : null;
}

/**
 * Bewegungen listen (Journal) — mit Filtern & Pagination.
 * Standard-Sort: neueste zuerst.
 */
export async function listBewegungen(
  params?: ListBewegungenParams
): Promise<{ items: BewegungResource[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params?.page ?? 1);
  const totalDocsAll = await BewegungModel.estimatedDocumentCount();
  const limit =
    params?.limit !== undefined
      ? Math.min(500, Math.max(1, params?.limit ?? 200))
      : totalDocsAll;
  const skip = (page - 1) * limit;

  const filter: FilterQuery<any> = {};

  if (params?.from || params?.to) {
    filter.timestamp = {};
    if (params.from) filter.timestamp.$gte = new Date(params.from);
    if (params.to) filter.timestamp.$lte = endOfDay(params.to);
  }

  if (params?.typ) {
    const arr = params.typ.split(",").map((x) => x.trim()).filter(Boolean);
    filter.typ = arr.length > 1 ? { $in: arr } : arr[0];
  }

  if (params?.artikelId) filter.artikelId = new Types.ObjectId(params.artikelId);
  if (params?.chargeId) filter.chargeId = new Types.ObjectId(params.chargeId);
  if (params?.auftragId) filter.auftragId = new Types.ObjectId(params.auftragId);
  if (params?.lagerbereich) filter.lagerbereich = params.lagerbereich;

  if (params?.q) {
    const q = params.q.trim();
    filter.$or = [
      { artikelName: { $regex: q, $options: "i" } },
      { artikelNummer: { $regex: q, $options: "i" } },
      { kundeName: { $regex: q, $options: "i" } },
      { notiz: { $regex: q, $options: "i" } },
    ];
  }

  const [docs, total] = await Promise.all([
    BewegungModel.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit),
    BewegungModel.countDocuments(filter),
  ]);

  return {
    items: docs.map(toResource),
    total,
    page,
    limit,
  };
}

/**
 * CSV-Export der Bewegungen.
 * - schreibt die Datei synchron in einen temporären Ordner (default ./tmp)
 * - gibt Pfad/Dateiname zurück, damit dein Controller sie ausliefern kann
 */
export async function exportBewegungenCSV(params?: ExportBewegungenCSVParams): Promise<{ path: string; filename: string; rows: number }> {
  // Wir ziehen alle passenden Datensätze ohne Pagination
  const resp = await listBewegungen({ ...params, page: 1, limit: Number.MAX_SAFE_INTEGER });
  const items = resp.items;

  const dir = params?.dir ?? path.resolve(process.cwd(), "tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename =
    params?.filename ??
    `bewegungen_${new Date().toISOString().slice(0, 10)}.csv`;
  const filePath = path.join(dir, filename);

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    const csv = csvFormat({ headers: true, delimiter: ";" });

    csv.on("error", reject);
    stream.on("error", reject);
    stream.on("finish", () => resolve());

    csv.pipe(stream);

    for (const r of items) {
      csv.write({
        id: r.id,
        timestamp: r.timestamp,
        typ: r.typ,
        artikelId: r.artikelId,
        artikelName: r.artikelName,
        artikelNummer: r.artikelNummer,
        chargeId: r.chargeId,
        lagerbereich: r.lagerbereich,
        menge: r.menge,
        auftragId: r.auftragId,
        kundeName: r.kundeName,
        lieferDatum: r.lieferDatum,
        mhd: r.mhd,
        schlachtDatum: r.schlachtDatum,
        isTK: r.isTK === undefined ? "" : (r.isTK ? "true" : "false"),
        notiz: r.notiz ?? "",
      });
    }

    csv.end();
  });

  return { path: filePath, filename, rows: items.length };
}

/* ----------------------- Utility: Felder nachziehen ----------------------- */
/**
 * Füllt fehlende denormalisierte Felder in alten Bewegungen nach
 * (z. B. nach Einführung von artikelName/artikelNummer).
 * Vorsicht: heavy operation -> gezielt per Filter aufrufen.
 */
export async function backfillDenormFields(params?: {
  artikelId?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<{ updated: number }> {
  const filter: FilterQuery<any> = {};
  if (params?.artikelId) filter.artikelId = new Types.ObjectId(params.artikelId);
  if (params?.from || params?.to) {
    filter.timestamp = {};
    if (params.from) filter.timestamp.$gte = new Date(params.from);
    if (params.to) filter.timestamp.$lte = endOfDay(params.to);
  }

  // nur Bewegungen ohne artikelName/Nummer
  filter.$or = [{ artikelName: { $exists: false } }, { artikelNummer: { $exists: false } }];

  const limit = Math.min(5000, Math.max(1, params?.limit ?? 1000));
  const docs = await BewegungModel.find(filter).limit(limit);

  if (!docs.length) return { updated: 0 };

  // Artikeldaten einmalig holen
  const artikelIds = Array.from(new Set(docs.map((d) => d.artikelId?.toString()).filter(Boolean)));
  const arts = await ArtikelModel.find({ _id: { $in: artikelIds } }, { _id: 1, name: 1, artikelNummer: 1 });
  const artMap = new Map<string, { name?: string; nummer?: string }>();
  for (const a of arts) artMap.set(a._id.toString(), { name: a.name ?? undefined, nummer: a.artikelNummer ?? undefined });

  // optional: MHD/SchlachtDatum aus Charge nachziehen
  const chargeIds = Array.from(new Set(docs.map((d) => d.chargeId?.toString()).filter(Boolean)));
  const charges = await ChargeModel.find({ _id: { $in: chargeIds } }, { _id: 1, mhd: 1, schlachtDatum: 1, isTK: 1 });
  const chargeMap = new Map<string, { mhd?: Date; schlachtDatum?: Date; isTK?: boolean }>();
  for (const c of charges) chargeMap.set(c._id.toString(), { mhd: c.mhd ?? undefined, schlachtDatum: c.schlachtDatum ?? undefined, isTK: c.isTK });

  let updated = 0;
  for (const d of docs) {
    const den = artMap.get(d.artikelId?.toString() ?? "");
    if (den) {
      if (!d.artikelName) d.artikelName = den.name;
      if (!d.artikelNummer) d.artikelNummer = den.nummer;
    }
    if (d.chargeId && (!d.mhd || !d.schlachtDatum || d.isTK === undefined)) {
      const ch = chargeMap.get(d.chargeId.toString());
      if (ch) {
        if (!d.mhd && ch.mhd) d.mhd = ch.mhd;
        if (!d.schlachtDatum && ch.schlachtDatum) d.schlachtDatum = ch.schlachtDatum;
        if (d.isTK === undefined && typeof ch.isTK === "boolean") d.isTK = ch.isTK;
      }
    }
    await d.save();
    updated++;
  }

  return { updated };
}