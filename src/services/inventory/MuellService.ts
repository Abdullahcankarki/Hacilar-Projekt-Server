// backend/src/services/MuellService.ts
import mongoose, { Types, FilterQuery } from "mongoose";
import { BewegungModel } from "../../model/BewegungsModel";
import { BestandAggModel } from "../../model/BestandsAggModel";
import { ChargeModel } from "../../model/ChargeModel";
import { ArtikelModel} from "../../model/ArtikelModel";
import { BewegungResource, Lagerbereich } from "src/Resources";

/* --------------------------------- Helpers -------------------------------- */

function toISODate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

function normalizeNumber(n: number): number {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) throw new Error("Menge muss > 0 sein");
  return v;
}

async function denormArtikel(artikelId: string): Promise<{
  artikelName?: string;
  artikelNummer?: string;
}> {
  const a = await ArtikelModel.findById(artikelId).select({ name: 1, artikelNummer: 1 }).lean();
  return a
    ? { artikelName: a.name ?? undefined, artikelNummer: a.artikelNummer ?? undefined }
    : {};
}

async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** BestandAgg upsert + inkrementelle Deltas anwenden */
async function upsertBestandAgg(
  params: {
    artikelId: string;
    chargeId?: string;
    lagerbereich: Lagerbereich;
    deltaVerfuegbar?: number;
    deltaReserviert?: number;
    deltaUnterwegs?: number;
  },
  session: mongoose.ClientSession
) {
  const { artikelId, chargeId, lagerbereich, deltaVerfuegbar = 0, deltaReserviert = 0, deltaUnterwegs = 0 } = params;

  await BestandAggModel.updateOne(
    {
      artikelId: new Types.ObjectId(artikelId),
      chargeId: chargeId ? new Types.ObjectId(chargeId) : null,
      lagerbereich,
    },
    {
      $setOnInsert: {
        artikelId: new Types.ObjectId(artikelId),
        chargeId: chargeId ? new Types.ObjectId(chargeId) : null,
        lagerbereich,
      },
      $inc: {
        verfuegbar: deltaVerfuegbar,
        reserviert: deltaReserviert,
        unterwegs: deltaUnterwegs,
      },
      $set: { updatedAt: new Date() },
    },
    { upsert: true, session }
  );
}

function toResource(doc: any): BewegungResource {
  return {
    id: doc._id.toString(),
    timestamp: toISODate(doc.timestamp)!,
    userId: doc.userId ? doc.userId.toString() : undefined,
    typ: doc.typ,
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    chargeId: doc.chargeId ? doc.chargeId.toString() : undefined,
    menge: Number(doc.menge),
    lagerbereich: doc.lagerbereich,
    auftragId: doc.auftragId ? doc.auftragId.toString() : undefined,
    notiz: doc.notiz ?? undefined,
    mhd: doc.mhd ? toISODate(doc.mhd)?.slice(0, 10) : undefined,
    schlachtDatum: doc.schlachtDatum ? toISODate(doc.schlachtDatum)?.slice(0, 10) : undefined,
    isTK: typeof doc.isTK === "boolean" ? !!doc.isTK : undefined,
  };
}

/* ---------------------------------- DTOs ---------------------------------- */

export type BookMuellDTO = {
  artikelId: string;
  chargeId: string;
  menge: number;
  lagerbereich: Lagerbereich; // "TK" | "NON_TK"
  grund:
    | "MHD_ABGELAUFEN"
    | "BESCHAEDIGT"
    | "VERDERB"
    | "RUECKWEISUNG_KUNDE"
    | "SONSTIGES";
  notiz?: string;
  userId?: string;
};

export type ListMuellParams = {
  from?: string; // ISO
  to?: string;   // ISO
  artikelId?: string;
  chargeId?: string;
  q?: string;    // artikelName/Nummer/Grund im notiz
  page?: number;
  limit?: number;
};

export type UndoMuellDTO = {
  bewegungId: string;     // die ursprüngliche MULL-Bewegung
  begruendung?: string;   // optionaler Text
  userId?: string;
};

/* ------------------------------ Hauptaktionen ----------------------------- */

/**
 * Müll/Verlust buchen:
 * - schreibt eine Bewegung (typ=MULL, negative Menge)
 * - reduziert Verfügbar (BestandAgg) an der betroffenen Charge/Lagerbereich
 * - validiert Charge->Artikel Konsistenz
 * - Warnung bei TK-Mismatch wird NICHT geblockt (nur notiz möglich)
 */
export async function bookMuell(data: BookMuellDTO): Promise<BewegungResource> {
  const menge = normalizeNumber(data.menge);

  return await withTransaction<BewegungResource>(async (session) => {
    // 0) Konsistenzprüfungen
    const charge = await ChargeModel.findById(data.chargeId).session(session);
    if (!charge) throw new Error("Charge nicht gefunden");

    if (charge.artikelId.toString() !== data.artikelId) {
      throw new Error("Charge passt nicht zum Artikel (artikelId mismatch)");
    }

    const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);

    // 1) Bewegung schreiben (MULL, negative Menge)
    const notiz = buildMuellNotiz(data.grund, data.notiz);
    const bewegung = await new BewegungModel({
      timestamp: new Date(),
      userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
      typ: "MULL",
      artikelId: new Types.ObjectId(data.artikelId),
      artikelName,
      artikelNummer,
      chargeId: new Types.ObjectId(data.chargeId),
      menge: -Math.abs(menge), // negativ
      lagerbereich: data.lagerbereich,
      notiz,
      mhd: charge.mhd,
      schlachtDatum: charge.schlachtDatum,
      isTK: charge.isTK,
    }).save({ session });

    // 2) BestandAgg anpassen (verfügbar -)
    await upsertBestandAgg(
      {
        artikelId: data.artikelId,
        chargeId: data.chargeId,
        lagerbereich: data.lagerbereich,
        deltaVerfuegbar: -Math.abs(menge),
      },
      session
    );

    // 3) Ergebnis
    return toResource(bewegung);
  });
}

function buildMuellNotiz(grund: BookMuellDTO["grund"], notiz?: string): string {
  const grundText = {
    MHD_ABGELAUFEN: "MHD abgelaufen",
    BESCHAEDIGT: "Beschädigt",
    VERDERB: "Verderb",
    RUECKWEISUNG_KUNDE: "Rückweisung Kunde",
    SONSTIGES: "Sonstiges",
  }[grund];
  return notiz ? `[${grundText}] ${notiz}` : `[${grundText}]`;
}

/**
 * Müll-Bewegungen listen (nur typ=MULL).
 */
export async function listMuell(params?: ListMuellParams): Promise<{
  items: BewegungResource[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, params?.page ?? 1);
  const totalDocsAll = await BewegungModel.countDocuments({ typ: "MULL" });
  const limit =
    params?.limit !== undefined
      ? Math.min(200, Math.max(1, params?.limit ?? 50))
      : totalDocsAll;
  const skip = (page - 1) * limit;

  const filter: FilterQuery<any> = { typ: "MULL" };

  if (params?.from || params?.to) {
    filter.timestamp = {};
    if (params.from) filter.timestamp.$gte = new Date(params.from);
    if (params.to) {
      const end = new Date(params.to);
      end.setHours(23, 59, 59, 999);
      filter.timestamp.$lte = end;
    }
  }
  if (params?.artikelId) filter.artikelId = params.artikelId;
  if (params?.chargeId) filter.chargeId = params.chargeId;

  if (params?.q) {
    const q = params.q.trim();
    filter.$or = [
      { artikelName: { $regex: q, $options: "i" } },
      { artikelNummer: { $regex: q, $options: "i" } },
      { notiz: { $regex: q, $options: "i" } },
    ];
  }

  const [docs, total] = await Promise.all([
    BewegungModel.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit),
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
 * Optional: Müllbuchung „rückgängig“ machen — via Gegenbuchung (Inventur-Korrektur +).
 * ⚠️ Historisch sauberer als Hard-Delete. Kennzeichne die Ursprung-ID in der Notiz.
 */
export async function undoMuell(data: UndoMuellDTO): Promise<BewegungResource> {
  return await withTransaction<BewegungResource>(async (session) => {
    const orig = await BewegungModel.findById(data.bewegungId).session(session);
    if (!orig) throw new Error("Bewegung nicht gefunden");
    if (orig.typ !== "MULL") throw new Error("Nur MÜLL-Bewegungen können rückgängig gemacht werden");

    // Gegenbuchung als INVENTUR_KORREKTUR (+)
    const korr = await new BewegungModel({
      timestamp: new Date(),
      userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
      typ: "INVENTUR_KORREKTUR",
      artikelId: orig.artikelId,
      artikelName: orig.artikelName,
      artikelNummer: orig.artikelNummer,
      chargeId: orig.chargeId,
      menge: Math.abs(orig.menge), // positiv
      lagerbereich: orig.lagerbereich,
      notiz: `[UNDO_MUELL ${orig._id}] ${data.begruendung ?? ""}`.trim(),
      mhd: orig.mhd,
      schlachtDatum: orig.schlachtDatum,
      isTK: orig.isTK,
    }).save({ session });

    // BestandAgg korrigieren (verfügbar +)
    await upsertBestandAgg(
      {
        artikelId: orig.artikelId.toString(),
        chargeId: orig.chargeId?.toString(),
        lagerbereich: orig.lagerbereich,
        deltaVerfuegbar: Math.abs(orig.menge),
      },
      session
    );

    return toResource(korr);
  });
}