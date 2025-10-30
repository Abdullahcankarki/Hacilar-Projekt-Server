// backend/src/services/WarnungenService.ts
import { FilterQuery, Types } from "mongoose";
import { ChargeModel } from "../../model/ChargeModel";
import { BestandAggModel } from "../../model/BestandsAggModel";
import { ReservierungModel } from "../../model/ReservierungModel";
import { BewegungModel } from "../../model/BewegungsModel";
import { ArtikelModel } from "../../model/ArtikelModel";
import { Lagerbereich } from "src/Resources";

/* --------------------------------- Helpers -------------------------------- */

function toISODate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

function startOfDay(iso?: string): Date {
  const d = iso ? new Date(iso) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(iso?: string): Date {
  const d = iso ? new Date(iso) : new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/* ---------------------------------- Types --------------------------------- */

export type MhdWarnungRow = {
  artikelId: string;
  artikelName?: string;
  artikelNummer?: string;
  chargeId: string;
  mhd: string;
  schlachtDatum?: string;
  verfuegbar: number;
  reserviert: number;
  unterwegs: number;
  warnTyp: "NAH" | "ABGELAUFEN";
};

export type UeberreserviertRow = {
  artikelId: string;
  artikelName?: string;
  artikelNummer?: string;
  verfuegbar: number;   // Summe über alle Charges/Lagerbereiche
  reserviert: number;   // Summe aktiver Reservierungen (optional bis Datum)
  diff: number;         // reserviert - verfuegbar (>0 = Problem)
};

export type TkMismatchRow = {
  bewegungId: string;
  timestamp: string;
  artikelId: string;
  artikelName?: string;
  artikelNummer?: string;
  chargeId?: string;
  lagerbereich: Lagerbereich;
  isTK?: boolean;
  typ: string;
  notiz?: string;
};

/* ------------------------------ MHD Warnungen ----------------------------- */
/**
 * Liefert Chargen, deren MHD in <= thresholdDays Tagen liegt (NAH) oder bereits
 * überschritten ist (ABGELAUFEN). Inkl. der aktuellen Bestandszahlen aus BestandAgg.
 */
export async function listMhdWarnungen(params?: {
  thresholdDays?: number;        // default 5
  onlyCritical?: boolean;        // true -> nur ABGELAUFEN
  artikelId?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: MhdWarnungRow[]; total: number; page: number; limit: number; }> {
  const threshold = Math.max(1, params?.thresholdDays ?? 5);
  const today = startOfDay();
  const nearDate = new Date(today.getTime() + threshold * 24 * 3600 * 1000);

  const cFilter: FilterQuery<any> = {
    mhd: { $lte: params?.onlyCritical ? today : nearDate },
  };
  if (params?.artikelId) cFilter.artikelId = new Types.ObjectId(params.artikelId);

  // Pagination über Charges
  const page = Math.max(1, params?.page ?? 1);
  const totalDocsAll = await ChargeModel.countDocuments(cFilter);
  const limit =
    params?.limit !== undefined
      ? Math.min(200, Math.max(1, params?.limit ?? 50))
      : totalDocsAll;
  const skip = (page - 1) * limit;

  const charges = await ChargeModel.find(cFilter)
    .sort({ mhd: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const artikelIds = Array.from(new Set(charges.map(c => c.artikelId?.toString()).filter(Boolean)));
  const artikelMap = new Map<string, { name?: string; nummer?: string }>();
  if (artikelIds.length) {
    const arts = await ArtikelModel.find({ _id: { $in: artikelIds } }, { _id: 1, name: 1, artikelNummer: 1 }).lean();
    for (const a of arts) artikelMap.set(a._id.toString(), { name: a.name ?? undefined, nummer: a.artikelNummer ?? undefined });
  }

  // BestandAgg je Charge (summiert über Lagerbereiche)
  const chargeIds = charges.map(c => c._id);
  const aggRows = chargeIds.length
    ? await BestandAggModel.aggregate([
        { $match: { chargeId: { $in: chargeIds } } },
        {
          $group: {
            _id: "$chargeId",
            verfuegbar: { $sum: "$verfuegbar" },
            reserviert: { $sum: "$reserviert" },
            unterwegs: { $sum: "$unterwegs" },
          },
        },
      ])
    : [];

  const aggMap = new Map<string, { verfuegbar: number; reserviert: number; unterwegs: number }>();
  for (const r of aggRows) {
    aggMap.set(r._id.toString(), {
      verfuegbar: Number(r.verfuegbar ?? 0),
      reserviert: Number(r.reserviert ?? 0),
      unterwegs: Number(r.unterwegs ?? 0),
    });
  }

  const items: MhdWarnungRow[] = charges.map((c) => {
    const a = artikelMap.get(c.artikelId.toString());
    const m = aggMap.get(c._id.toString()) ?? { verfuegbar: 0, reserviert: 0, unterwegs: 0 };

    const mhdISO = toISODate(c.mhd)!.slice(0, 10);
    const diffDays = Math.ceil((new Date(mhdISO).getTime() - today.getTime()) / (24 * 3600 * 1000));
    const warnTyp: "NAH" | "ABGELAUFEN" = diffDays < 0 ? "ABGELAUFEN" : "NAH";

    return {
      artikelId: c.artikelId.toString(),
      artikelName: a?.name,
      artikelNummer: a?.nummer,
      chargeId: c._id.toString(),
      mhd: mhdISO,
      schlachtDatum: c.schlachtDatum ? toISODate(c.schlachtDatum)?.slice(0, 10) : undefined,
      verfuegbar: m.verfuegbar,
      reserviert: m.reserviert,
      unterwegs: m.unterwegs,
      warnTyp,
    };
  });

  // Optional: onlyCritical= true -> filter nur ABGELAUFEN
  const filtered = params?.onlyCritical ? items.filter(x => x.warnTyp === "ABGELAUFEN") : items;

  return { items: filtered, total: totalDocsAll, page, limit };
}

/* ----------------------------- Überreserviert ----------------------------- */
/**
 * Meldet Artikel, bei denen die Summe **aktiver** Reservierungen (optional bis Datum)
 * die **aktuell verfügbare** Menge (Summe über alle Charges/Lagerbereiche) übersteigt.
 */
export async function listUeberreserviert(params?: {
  bisDatum?: string;          // berücksichtigt nur Reservierungen mit lieferDatum <= bisDatum
  artikelId?: string;
}): Promise<UeberreserviertRow[]> {
  const resFilter: FilterQuery<any> = { status: "AKTIV" };
  if (params?.artikelId) resFilter.artikelId = new Types.ObjectId(params.artikelId);
  if (params?.bisDatum) resFilter.lieferDatum = { $lte: endOfDay(params.bisDatum) };

  // Summe Reservierungen je Artikel
  const resAgg = await ReservierungModel.aggregate([
    { $match: resFilter },
    { $group: { _id: "$artikelId", reserviert: { $sum: "$menge" } } },
  ]);

  if (!resAgg.length) return [];

  const artikelIds = resAgg.map(r => r._id);
  // Verfügbar je Artikel (Summe über alle Charges/Lagerbereiche)
  const bestAgg = await BestandAggModel.aggregate([
    { $match: { artikelId: { $in: artikelIds } } },
    { $group: { _id: "$artikelId", verfuegbar: { $sum: "$verfuegbar" } } },
  ]);

  const verfMap = new Map<string, number>();
  for (const b of bestAgg) verfMap.set(b._id.toString(), Number(b.verfuegbar ?? 0));

  // Artikelnamen
  const arts = await ArtikelModel.find({ _id: { $in: artikelIds } }, { _id: 1, name: 1, artikelNummer: 1 }).lean();
  const artikelMap = new Map<string, { name?: string; nummer?: string }>();
  for (const a of arts) artikelMap.set(a._id.toString(), { name: a.name ?? undefined, nummer: a.artikelNummer ?? undefined });

  const rows: UeberreserviertRow[] = resAgg
    .map((r) => {
      const artikelId = r._id.toString();
      const reserviert = Number(r.reserviert ?? 0);
      const verfuegbar = Number(verfMap.get(artikelId) ?? 0);
      return {
        artikelId,
        artikelName: artikelMap.get(artikelId)?.name,
        artikelNummer: artikelMap.get(artikelId)?.nummer,
        reserviert,
        verfuegbar,
        diff: reserviert - verfuegbar,
      };
    })
    .filter((x) => x.diff > 0) // nur Problemfälle
    .sort((a, b) => b.diff - a.diff);

  return rows;
}

/* ------------------------------- TK-Mismatch ------------------------------ */
/**
 * Listet Bewegungen, bei denen `isTK` (falls gesetzt) nicht zum Lagerbereich passt:
 * - isTK=true & lagerbereich="NON_TK"
 * - isTK=false & lagerbereich="TK"
 * Optional: Zeitraumfilter (default: letzte 14 Tage).
 */
export async function listTkMismatch(params?: {
  from?: string;      // ISO
  to?: string;        // ISO
  artikelId?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: TkMismatchRow[]; total: number; page: number; limit: number; }> {
  const from = params?.from ? new Date(params.from) : new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const to = endOfDay(params?.to);

  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(200, Math.max(1, params?.limit ?? 100));
  const skip = (page - 1) * limit;

  const baseFilter: FilterQuery<any> = {
    timestamp: { $gte: from, $lte: to },
    isTK: { $in: [true, false] }, // nur Bewegungen, die isTK gesetzt haben
  };
  if (params?.artikelId) baseFilter.artikelId = new Types.ObjectId(params.artikelId);

  // Zwei Varianten der Mismatch-Logik
  const mismatchFilter: FilterQuery<any> = {
    $or: [
      { $and: [{ isTK: true }, { lagerbereich: "NON_TK" }] },
      { $and: [{ isTK: false }, { lagerbereich: "TK" }] },
    ],
  };

  const total = await BewegungModel.countDocuments({ $and: [baseFilter, mismatchFilter] });

  const docs = await BewegungModel.find({ $and: [baseFilter, mismatchFilter] })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Artikelnamen (denormalisieren, falls in Bewegung nicht gesetzt)
  const missingArtikelIds = Array.from(
    new Set(
      docs
        .filter((d) => !d.artikelName || !d.artikelNummer)
        .map((d) => d.artikelId?.toString())
        .filter(Boolean)
    )
  );
  const artikelMap = new Map<string, { name?: string; nummer?: string }>();
  if (missingArtikelIds.length) {
    const arts = await ArtikelModel.find(
      { _id: { $in: missingArtikelIds } },
      { _id: 1, name: 1, artikelNummer: 1 }
    ).lean();
    for (const a of arts) artikelMap.set(a._id.toString(), { name: a.name ?? undefined, nummer: a.artikelNummer ?? undefined });
  }

  const items: TkMismatchRow[] = docs.map((d) => ({
    bewegungId: d._id.toString(),
    timestamp: toISODate(d.timestamp)!,
    artikelId: d.artikelId?.toString(),
    artikelName: d.artikelName ?? artikelMap.get(d.artikelId?.toString() ?? "")?.name,
    artikelNummer: d.artikelNummer ?? artikelMap.get(d.artikelId?.toString() ?? "")?.nummer,
    chargeId: d.chargeId ? d.chargeId.toString() : undefined,
    lagerbereich: d.lagerbereich as Lagerbereich,
    isTK: typeof d.isTK === "boolean" ? !!d.isTK : undefined,
    typ: d.typ,
    notiz: d.notiz ?? undefined,
  }));

  return { items, total, page, limit };
}