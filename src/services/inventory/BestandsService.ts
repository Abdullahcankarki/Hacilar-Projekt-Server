// backend/src/services/BestandService.ts
import { FilterQuery, Types } from "mongoose";
import mongoose from "mongoose";
import { BestandAggModel } from "../../model/BestandsAggModel";
import { ChargeModel } from "../../model/ChargeModel";
import { ReservierungModel } from "../../model/ReservierungModel";
import { BewegungModel } from "../../model/BewegungsModel";
import { ArtikelModel } from "../../model/ArtikelModel";
import {
  BestandAggResource,
  ChargeResource,
  ReservierungResource,
  BewegungResource,
  Lagerbereich,
} from "src/Resources";

/* --------------------------------- Helpers -------------------------------- */

function toISODate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

function toBestandAggResource(doc: any): BestandAggResource {
  return {
    id: doc._id?.toString?.(),
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    chargeId: doc.chargeId ? doc.chargeId.toString() : undefined,
    lagerbereich: doc.lagerbereich as Lagerbereich,
    verfuegbar: Number(doc.verfuegbar ?? 0),
    reserviert: Number(doc.reserviert ?? 0),
    unterwegs: Number(doc.unterwegs ?? 0),
    updatedAt: toISODate(doc.updatedAt),
  };
}

function toChargeResource(doc: any): ChargeResource {
  return {
    id: doc._id.toString(),
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    lieferantId: doc.lieferantId ? doc.lieferantId.toString() : undefined,
    mhd: toISODate(doc.mhd)?.slice(0, 10)!,
    schlachtDatum: toISODate(doc.schlachtDatum)?.slice(0, 10),
    isTK: !!doc.isTK,
    createdAt: toISODate(doc.createdAt),
    updatedAt: toISODate(doc.updatedAt),
  };
}

function toReservierungResource(doc: any): ReservierungResource {
  return {
    id: doc._id.toString(),
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    auftragId: doc.auftragId?.toString(),
    kundeName: doc.kundeName ?? undefined,
    lieferDatumText: doc.lieferDatumText ?? undefined,
    chargeId: doc.chargeId ? doc.chargeId.toString() : undefined,
    lieferDatum: toISODate(doc.lieferDatum)?.slice(0, 10)!,
    menge: Number(doc.menge),
    status: doc.status,
    createdAt: toISODate(doc.createdAt),
    createdBy: doc.createdBy ? doc.createdBy.toString() : undefined,
  };
}

function toBewegungResource(doc: any): BewegungResource {
  return {
    id: doc._id.toString(),
    timestamp: toISODate(doc.timestamp)!,
    userId: doc.userId ? doc.userId.toString() : undefined,
    typ: doc.typ,
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    kundeName: doc.kundeName ?? undefined,
    lieferDatum: doc.lieferDatum ? toISODate(doc.lieferDatum)?.slice(0, 10) : undefined,
    chargeId: doc.chargeId ? doc.chargeId.toString() : undefined,
    menge: Number(doc.menge),
    lagerbereich: doc.lagerbereich as Lagerbereich,
    auftragId: doc.auftragId ? doc.auftragId.toString() : undefined,
    notiz: doc.notiz ?? undefined,
    mhd: doc.mhd ? toISODate(doc.mhd)?.slice(0, 10) : undefined,
    schlachtDatum: doc.schlachtDatum ? toISODate(doc.schlachtDatum)?.slice(0, 10) : undefined,
    isTK: typeof doc.isTK === "boolean" ? !!doc.isTK : undefined,
  };
}

function endOfDayInclusive(isoDate: string): Date {
  const d = new Date(isoDate);
  d.setHours(23, 59, 59, 999);
  return d;
}

/* ---------------------------------- API ----------------------------------- */

/**
 * Übersicht der Bestände (materialisiert), filterbar & paginiert.
 * Optional: kritisch=true -> MHD innerhalb thresholdDays (default 5) markieren.
 * Reserviert-Wert kann (je nach Design) entweder direkt aus BestandAgg stammen
 * oder on-the-fly aus Reservierungen aggregiert werden.
 */
export async function getBestandUebersicht(params?: {
  artikelId?: string;
  chargeId?: string;
  isTK?: boolean;
  lagerbereich?: Lagerbereich;
  datum?: string;           // für Zeitreise -> wenn gesetzt, wird aus Journal rekonstruiert (fallback)
  q?: string;               // Suche: artikelName/Nummer/Charge-ID
  kritisch?: boolean;       // MHD-Kritik (nur Anzeige, Filter unten)
  thresholdDays?: number;   // default 5
  page?: number;
  limit?: number;
}): Promise<{ items: (BestandAggResource & { mhd?: string; schlachtDatum?: string; warnMhd?: "NAH"|"ABGELAUFEN" })[]; total: number; page: number; limit: number; }> {
  const page = Math.max(1, params?.page ?? 1);
  const totalDocsAll = await BestandAggModel.estimatedDocumentCount();
  const limit =
    params?.limit !== undefined
      ? Math.min(200, Math.max(1, params?.limit ?? 50))
      : totalDocsAll;
  const skip = (page - 1) * limit;

  // Zeitreise: wenn datum gesetzt ist, nutzen wir Journal-Rekonstruktion
  if (params?.datum) {
    const items = await getZeitreiseBestand({ datum: params.datum, artikelId: params.artikelId, chargeId: params.chargeId });
    // Optional: Filter q/lagerbereich anwenden
    const filtered = items.filter((x) => {
      if (params?.lagerbereich && x.lagerbereich !== params.lagerbereich) return false;
      if (params?.q) {
        const q = params.q.trim().toLowerCase();
        const hay = `${x.artikelName ?? ""} ${x.artikelNummer ?? ""} ${x.chargeId ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const total = filtered.length;
    return {
      items: filtered.slice(skip, skip + limit),
      total,
      page,
      limit,
    };
  }

  // Normaler (aktueller) Blick: materialisierte Sicht
  const filter: FilterQuery<any> = {};
  if (params?.artikelId) filter.artikelId = new Types.ObjectId(params.artikelId);
  if (params?.chargeId) filter.chargeId = new Types.ObjectId(params.chargeId);
  if (params?.lagerbereich) filter.lagerbereich = params.lagerbereich;

  if (params?.q) {
    const q = params.q.trim();
    filter.$or = [
      { artikelName: { $regex: q, $options: "i" } },
      { artikelNummer: { $regex: q, $options: "i" } },
      { chargeId: q.match(/^[a-f0-9]{24}$/i) ? new Types.ObjectId(q) : undefined },
    ].filter(Boolean) as any[];
  }

  const [rows, total] = await Promise.all([
    BestandAggModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    BestandAggModel.countDocuments(filter),
  ]);

  // MHD/Warnungen holen: mit zusätzlichem Lookup aus Charge (nur wenn chargeId existiert)
  const chargeIds = rows.map(r => r.chargeId).filter(Boolean) as Types.ObjectId[];
  const charges = chargeIds.length
    ? await ChargeModel.find({ _id: { $in: chargeIds } }, { _id: 1, mhd: 1, schlachtDatum: 1 }).lean()
    : [];

  const chargeMap = new Map<string, { mhd?: string; schlachtDatum?: string }>();
  for (const c of charges) {
    chargeMap.set(c._id.toString(), {
      mhd: toISODate(c.mhd)?.slice(0, 10),
      schlachtDatum: c.schlachtDatum ? toISODate(c.schlachtDatum)?.slice(0, 10) : undefined,
    });
  }

  const threshold = Math.max(1, params?.thresholdDays ?? 5);
  const today = new Date();
  const items = rows.map((r) => {
    const base = toBestandAggResource(r);
    const ch = r.chargeId ? chargeMap.get(r.chargeId.toString()) : undefined;
    let warnMhd: "NAH" | "ABGELAUFEN" | undefined;
    if (ch?.mhd) {
      const mhdDate = new Date(ch.mhd);
      const diffDays = Math.ceil((mhdDate.getTime() - today.getTime()) / (24 * 3600 * 1000));
      if (diffDays < 0) warnMhd = "ABGELAUFEN";
      else if (diffDays <= threshold) warnMhd = "NAH";
    }
    return { ...base, mhd: ch?.mhd, schlachtDatum: ch?.schlachtDatum, warnMhd };
  });

  // Optional: kritisch-Filter (nur NAH/ABGELAUFEN)
  const finalItems = params?.kritisch ? items.filter(x => !!x.warnMhd) : items;

  return { items: finalItems, total, page, limit };
}

/**
 * Charge-Detail: Stammdaten, Bewegungen, Reservierungen.
 */
export async function getChargeView(chargeId: string): Promise<{
  charge: ChargeResource | null;
  reservierungen: ReservierungResource[];
  bewegungen: BewegungResource[];
}> {
  const [chargeDoc, resDocs, movDocs] = await Promise.all([
    ChargeModel.findById(chargeId),
    ReservierungModel.find({ chargeId }).sort({ lieferDatum: 1, createdAt: 1 }),
    BewegungModel.find({ chargeId }).sort({ timestamp: -1 }),
  ]);

  return {
    charge: chargeDoc ? toChargeResource(chargeDoc) : null,
    reservierungen: resDocs.map(toReservierungResource),
    bewegungen: movDocs.map(toBewegungResource),
  };
}

/**
 * Zeitreise: Bestand zu Datum X.
 * Rekonstruiert pro Artikel/Charge/Lagerbereich die Summen aus Journal bis (inkl.) Stichtag.
 * Hinweis: performant genug mit Indizes; für große Datenmengen später Snapshots nutzen.
 */
export async function getZeitreiseBestand(params: {
  datum: string;              // YYYY-MM-DD
  artikelId?: string;
  chargeId?: string;
}): Promise<BestandAggResource[]> {
  const until = endOfDayInclusive(params.datum);

  const filter: FilterQuery<any> = {
    timestamp: { $lte: until },
  };
  if (params?.artikelId) filter.artikelId = new Types.ObjectId(params.artikelId);
  if (params?.chargeId) filter.chargeId = new Types.ObjectId(params.chargeId);

  // Aggregation: Summe je (artikelId, chargeId, lagerbereich), getrennt nach Typ
  const agg = await BewegungModel.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          artikelId: "$artikelId",
          chargeId: "$chargeId",
          lagerbereich: "$lagerbereich",
        },
        verfuegbar: {
          $sum: {
            $switch: {
              branches: [
                // positiv wirkend auf verfügbare Menge:
                { case: { $in: ["$typ", ["WARENEINGANG", "UMBUCHUNG_HIN", "INVENTUR_KORREKTUR"]] }, then: "$menge" },
                // negativ wirkend:
                { case: { $in: ["$typ", ["KOMMISSIONIERUNG", "WARENAUSGANG", "UMBUCHUNG_WEG", "MULL"]] }, then: "$menge" },
              ],
              default: 0,
            },
          },
        },
        // unterwegs & reserviert kannst du hier ebenfalls mitführen, wenn du sie als Bewegungen pflegst
        reserviert: {
          $sum: {
            $cond: [{ $in: ["$typ", ["RESERVIERUNG"]] }, "$menge", 0],
          },
        },
        unterwegs: {
          $sum: {
            $cond: [{ $in: ["$typ", ["ANLIEFERUNG_ERFASST"]] }, "$menge", 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        artikelId: "$_id.artikelId",
        chargeId: "$_id.chargeId",
        lagerbereich: "$_id.lagerbereich",
        verfuegbar: 1,
        reserviert: 1,
        unterwegs: 1,
      },
    },
  ]);

  // Denormalisierung (Artikel-Name/Nummer)
  const artikelIds = Array.from(new Set(agg.map((x) => x.artikelId?.toString()).filter(Boolean)));
  const artikelMap = new Map<string, { name?: string; nummer?: string }>();
  if (artikelIds.length) {
    const arts = await ArtikelModel.find({ _id: { $in: artikelIds } }, { _id: 1, name: 1, artikelNummer: 1 }).lean();
    for (const a of arts) {
      artikelMap.set(a._id.toString(), { name: a.name ?? undefined, nummer: a.artikelNummer ?? undefined });
    }
  }

  const out: BestandAggResource[] = agg.map((row: any) => {
    const den = artikelMap.get(row.artikelId?.toString() ?? "");
    return {
      id: undefined,
      artikelId: row.artikelId?.toString(),
      artikelName: den?.name,
      artikelNummer: den?.nummer,
      chargeId: row.chargeId?.toString(),
      lagerbereich: row.lagerbereich,
      verfuegbar: Number(row.verfuegbar ?? 0),
      reserviert: Number(row.reserviert ?? 0),
      unterwegs: Number(row.unterwegs ?? 0),
      updatedAt: undefined,
    };
  });

  return out;
}

/**
 * Manueller Zugang (ohne Wareneingang): positive Bestandskorrektur.
 * Erzeugt einen Journal-Eintrag (typ: INVENTUR_KORREKTUR) und
 * aktualisiert die materialisierte BestandAgg-Tabelle. Optional kann
 * eine neue Charge on-the-fly angelegt werden, falls keine chargeId
 * übergeben wird.
 */
export async function manuellerZugang(params: {
  artikelId: string;
  menge: number;                  // > 0
  lagerbereich: Lagerbereich;     // "TK" | "NON_TK"
  userId?: string;
  notiz?: string;
  chargeId?: string;              // existierende Charge verwenden
  createNewCharge?: {             // oder neue Charge anlegen
    mhd: string;                  // YYYY-MM-DD
    isTK: boolean;
    schlachtDatum?: string;       // YYYY-MM-DD
    lieferantId?: string;
  };
}): Promise<{ bewegung: BewegungResource; chargeId: string }> {
  if (!params?.artikelId) throw new Error("artikelId ist erforderlich");
  const menge = Number(params?.menge ?? 0);
  if (!(menge > 0)) throw new Error("menge muss > 0 sein");
  if (!params?.lagerbereich) throw new Error("lagerbereich ist erforderlich");

  const session = await mongoose.startSession();
  try {
    let chargeId = params.chargeId ? new Types.ObjectId(params.chargeId) : undefined;

    await session.withTransaction(async () => {
      // 1) Falls keine Charge gegeben -> optional neue Charge anlegen
      if (!chargeId) {
        if (!params.createNewCharge) {
          throw new Error("Keine chargeId übergeben. Entweder chargeId setzen oder createNewCharge angeben.");
        }
        const art = await ArtikelModel.findById(params.artikelId).session(session);
        if (!art) throw new Error("Artikel nicht gefunden");

        const newCharge = await new ChargeModel({
          artikelId: art._id,
          artikelName: art.name ?? undefined,
          artikelNummer: (art as any).artikelNummer ?? undefined,
          lieferantId: params.createNewCharge.lieferantId ? new Types.ObjectId(params.createNewCharge.lieferantId) : undefined,
          mhd: new Date(params.createNewCharge.mhd),
          schlachtDatum: params.createNewCharge.schlachtDatum ? new Date(params.createNewCharge.schlachtDatum) : undefined,
          isTK: !!params.createNewCharge.isTK,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).save({ session });
        chargeId = newCharge._id;
      }

      // 2) Bewegungs-Eintrag (Journal)
      const chargeDoc = await ChargeModel.findById(chargeId).session(session);
      if (!chargeDoc) throw new Error("Charge nicht gefunden");

      const artName = chargeDoc.artikelName;
      const artNum = chargeDoc.artikelNummer;
      const mhdISO = chargeDoc.mhd ? new Date(chargeDoc.mhd).toISOString() : undefined;
      const schlachtISO = chargeDoc.schlachtDatum ? new Date(chargeDoc.schlachtDatum).toISOString() : undefined;
      const isTK = !!chargeDoc.isTK;

      const mov = await new BewegungModel({
        timestamp: new Date(),
        userId: params.userId ? new Types.ObjectId(params.userId) : undefined,
        typ: "INVENTUR_KORREKTUR",
        artikelId: new Types.ObjectId(params.artikelId),
        artikelName: artName ?? undefined,
        artikelNummer: artNum ?? undefined,
        chargeId,
        menge: menge, // positiv
        lagerbereich: params.lagerbereich,
        notiz: params.notiz ?? undefined,
        mhd: mhdISO ? new Date(mhdISO) : undefined,
        schlachtDatum: schlachtISO ? new Date(schlachtISO) : undefined,
        isTK,
      }).save({ session });

      // 3) Materialisierte Sicht updaten
      await BestandAggModel.findOneAndUpdate(
        {
          artikelId: new Types.ObjectId(params.artikelId),
          chargeId: chargeId,
          lagerbereich: params.lagerbereich,
        },
        {
          $inc: { verfuegbar: menge },
          $setOnInsert: {
            reserviert: 0,
            unterwegs: 0,
          },
          $set: {
            artikelName: artName ?? undefined,
            artikelNummer: artNum ?? undefined,
            updatedAt: new Date(),
          },
        },
        { new: true, upsert: true, session }
      );

      // Output
      return { bewegung: toBewegungResource(mov), chargeId: chargeId.toString() };
    });

    // Transaktionsergebnis wird im withTransaction-Return nicht direkt geliefert -> neu lesen
    const lastMov = await BewegungModel.findOne({
      artikelId: new Types.ObjectId(params.artikelId),
      chargeId: chargeId,
      typ: "INVENTUR_KORREKTUR",
    })
      .sort({ timestamp: -1 })
      .lean();

    return { bewegung: toBewegungResource(lastMov), chargeId: (chargeId as any).toString() };
  } finally {
    await session.endSession();
  }
}

/**
 * Komplett-Löschung eines Bestands (Charge) inkl. aller zugehörigen Daten:
 * - Reservierungen (zu dieser Charge)
 * - Bewegungen (Journal)
 * - Bestand-Aggregate (BestandAgg)
 * - Charge-Stammsatz
 *
 * Hinweis: läuft in einer Transaktion. Gibt die Anzahl gelöschter Dokumente zurück.
 */
export async function deleteBestandKomplett(params: {
  chargeId: string;
}): Promise<{
  deleted: { reservierungen: number; bewegungen: number; agg: number; charge: number };
}> {
  if (!params?.chargeId) throw new Error("chargeId ist erforderlich");
  const chargeObjId = new Types.ObjectId(params.chargeId);

  const session = await mongoose.startSession();
  try {
    let out = { reservierungen: 0, bewegungen: 0, agg: 0, charge: 0 };
    await session.withTransaction(async () => {
      const [resDel, movDel, aggDel, chargeDel] = await Promise.all([
        ReservierungModel.deleteMany({ chargeId: chargeObjId }).session(session),
        BewegungModel.deleteMany({ chargeId: chargeObjId }).session(session),
        BestandAggModel.deleteMany({ chargeId: chargeObjId }).session(session),
        ChargeModel.deleteOne({ _id: chargeObjId }).session(session),
      ]);

      out = {
        reservierungen: resDel?.deletedCount ?? 0,
        bewegungen: movDel?.deletedCount ?? 0,
        agg: aggDel?.deletedCount ?? 0,
        charge: chargeDel?.deletedCount ?? 0,
      };
    });

    return { deleted: out };
  } finally {
    await session.endSession();
  }
}

/**
 * Komplett-Löschung ALLER Bestände (sämtlicher Charges) zu einem Artikel.
 * Entfernt für den Artikel alle: Reservierungen, Bewegungen, Aggregationen und Charges.
 */
export async function deleteBestandKomplettByArtikel(params: {
  artikelId: string;
}): Promise<{
  deleted: { reservierungen: number; bewegungen: number; agg: number; charges: number };
}> {
  if (!params?.artikelId) throw new Error("artikelId ist erforderlich");
  const artikelObjId = new Types.ObjectId(params.artikelId);

  const session = await mongoose.startSession();
  try {
    let out = { reservierungen: 0, bewegungen: 0, agg: 0, charges: 0 };
    await session.withTransaction(async () => {
      // Alle Charge-IDs zum Artikel holen
      const chargeIds = await ChargeModel.find({ artikelId: artikelObjId }, { _id: 1 }).session(session).lean();
      const ids = chargeIds.map((c) => c._id);

      const [resDel, movDel, aggDel, chargesDel] = await Promise.all([
        ReservierungModel.deleteMany({ artikelId: artikelObjId }).session(session),
        BewegungModel.deleteMany({ artikelId: artikelObjId }).session(session),
        BestandAggModel.deleteMany({ artikelId: artikelObjId }).session(session),
        ids.length ? ChargeModel.deleteMany({ _id: { $in: ids } }).session(session) : Promise.resolve({ deletedCount: 0 } as any),
      ]);

      out = {
        reservierungen: resDel?.deletedCount ?? 0,
        bewegungen: movDel?.deletedCount ?? 0,
        agg: aggDel?.deletedCount ?? 0,
        charges: (chargesDel as any)?.deletedCount ?? 0,
      };
    });

    return { deleted: out };
  } finally {
    await session.endSession();
  }
}