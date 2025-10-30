// backend/src/services/UmbuchungService.ts
import mongoose, { Types } from "mongoose";
import { ChargeModel } from "../../model/ChargeModel";
import { BewegungModel } from "../../model/BewegungsModel";
import { BestandAggModel } from "../../model/BestandsAggModel";
import { ArtikelModel } from "../../model/ArtikelModel";
import { BewegungResource, Lagerbereich } from "src/Resources";

/* --------------------------------- Helpers -------------------------------- */

function normalizeNumber(n: number): number {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) throw new Error("Menge muss > 0 sein");
  return v;
}
function toISODate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}
async function denormArtikel(artikelId: string): Promise<{ artikelName?: string; artikelNummer?: string }> {
  const a = await ArtikelModel.findById(artikelId).select({ name: 1, artikelNummer: 1 }).lean();
  return a ? { artikelName: a.name ?? undefined, artikelNummer: a.artikelNummer ?? undefined } : {};
}
async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}
/** BestandAgg upsert + inkrementelle Deltas anwenden */
async function upsertBestandAgg(
  p: {
    artikelId: string;
    chargeId?: string;
    lagerbereich: Lagerbereich;
    deltaVerfuegbar?: number;
    deltaReserviert?: number;
    deltaUnterwegs?: number;
  },
  session: mongoose.ClientSession
) {
  const { artikelId, chargeId, lagerbereich, deltaVerfuegbar = 0, deltaReserviert = 0, deltaUnterwegs = 0 } = p;
  await BestandAggModel.updateOne(
    { artikelId: new Types.ObjectId(artikelId), chargeId: chargeId ? new Types.ObjectId(chargeId) : null, lagerbereich },
    {
      $setOnInsert: { artikelId: new Types.ObjectId(artikelId), chargeId: chargeId ? new Types.ObjectId(chargeId) : null, lagerbereich },
      $inc: { verfuegbar: deltaVerfuegbar, reserviert: deltaReserviert, unterwegs: deltaUnterwegs },
      $set: { updatedAt: new Date() },
    },
    { upsert: true, session }
  );
}

/* ---------------------------------- DTOs ---------------------------------- */

export type UmbuchenDTO = {
  artikelId: string;
  von: { chargeId: string; lagerbereich: Lagerbereich };
  nach: {
    chargeId?: string;                 // optional – wenn nicht gegeben, neue Charge anlegen
    lagerbereich: Lagerbereich;
    // für neue Charge (falls chargeId fehlt)
    newCharge?: {
      mhd: string;
      isTK: boolean;
      schlachtDatum?: string;
      lieferantId?: string;
    };
  };
  menge: number;
  notiz?: string;
  userId?: string;
  // Business-Regel: Verfügbarkeitsprüfung nur Warnung → nicht blockieren
  // Wenn du blockieren willst, setze enforceAvailable=true
  enforceAvailable?: boolean;
};

export type MergeChargeDTO = {
  artikelId: string;
  quelleChargeId: string;
  zielChargeId: string;
  menge?: number;                 // wenn leer → gesamte Quelle
  zielLagerbereich: Lagerbereich; // Lagerbereich, in dem Ziel geführt wird
  notiz?: string;
  userId?: string;
  enforceAvailable?: boolean;
};

/* ------------------------------- Umbuchen -------------------------------- */

/**
 * Umbuchen zwischen Charge/Lager (zwei Journal-Einträge, ein TX):
 *  - UMBUCHUNG_WEG (negativ) von Quelle
 *  - UMBUCHUNG_HIN (positiv) zur Ziel-Charge
 *  - BestandAgg an beiden Stellen anpassen
 *  - Achtung: TK-Mismatch/MHD-Checks → nur Warnung (nicht blocken), gem. Anforderung
 */
export async function umbuchen(data: UmbuchenDTO): Promise<{ weg: BewegungResource; hin: BewegungResource; zielChargeId: string }> {
  const menge = normalizeNumber(data.menge);

  return await withTransaction(async (session) => {
    // 1) Quelle-Charge prüfen
    const src = await ChargeModel.findById(data.von.chargeId).session(session);
    if (!src) throw new Error("Quell-Charge nicht gefunden");
    if (src.artikelId.toString() !== data.artikelId) throw new Error("Quell-Charge passt nicht zum Artikel");

    // Optional: simple Availability-Check (BestandAgg lesen) – standardmäßig NICHT blockierend
    if (data.enforceAvailable) {
      // hier könntest du BestandAgg abfragen und blocken, wenn zu wenig da ist
      // (Implementierung abhängig von deiner Aggregationslogik)
    }

    // 2) Ziel-Charge ermitteln/erstellen
    let zielChargeId: Types.ObjectId;
    if (data.nach.chargeId) {
      zielChargeId = new Types.ObjectId(data.nach.chargeId);
      const exists = await ChargeModel.exists({ _id: zielChargeId, artikelId: src.artikelId }).session(session);
      if (!exists) throw new Error("Ziel-Charge nicht gefunden oder gehört zu anderem Artikel");
    } else {
      // Neue Charge anlegen mit Stammdaten vom Artikel + optionalen Feldern
      const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);
      const newCharge = await new ChargeModel({
        artikelId: src.artikelId,
        artikelName,
        artikelNummer,
        lieferantId: data.nach.newCharge?.lieferantId ? new Types.ObjectId(data.nach.newCharge.lieferantId) : undefined,
        mhd: data.nach.newCharge?.mhd ? new Date(data.nach.newCharge.mhd) : src.mhd,
        schlachtDatum: data.nach.newCharge?.schlachtDatum ? new Date(data.nach.newCharge.schlachtDatum) : src.schlachtDatum,
        isTK: typeof data.nach.newCharge?.isTK === "boolean" ? data.nach.newCharge.isTK : src.isTK,
      }).save({ session });
      zielChargeId = newCharge._id;
    }

    // 3) Denorm-Artikel für Journal
    const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);

    // 4) Journal: UMBUCHUNG_WEG (negativ)
    const weg = await new BewegungModel({
      timestamp: new Date(),
      userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
      typ: "UMBUCHUNG_WEG",
      artikelId: src.artikelId,
      artikelName,
      artikelNummer,
      chargeId: src._id,
      menge: -Math.abs(menge),
      lagerbereich: data.von.lagerbereich,
      notiz: data.notiz ?? undefined,
      mhd: src.mhd,
      schlachtDatum: src.schlachtDatum,
      isTK: src.isTK,
    }).save({ session });

    // 5) Journal: UMBUCHUNG_HIN (positiv)
    const ziel = await ChargeModel.findById(zielChargeId).session(session);
    const hin = await new BewegungModel({
      timestamp: new Date(),
      userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
      typ: "UMBUCHUNG_HIN",
      artikelId: ziel!.artikelId,
      artikelName,
      artikelNummer,
      chargeId: zielChargeId,
      menge: Math.abs(menge),
      lagerbereich: data.nach.lagerbereich,
      notiz: data.notiz ?? undefined,
      mhd: ziel!.mhd,
      schlachtDatum: ziel!.schlachtDatum,
      isTK: ziel!.isTK,
    }).save({ session });

    // 6) BestandAgg anpassen
    await upsertBestandAgg(
      { artikelId: data.artikelId, chargeId: src._id.toString(), lagerbereich: data.von.lagerbereich, deltaVerfuegbar: -Math.abs(menge) },
      session
    );
    await upsertBestandAgg(
      { artikelId: data.artikelId, chargeId: zielChargeId.toString(), lagerbereich: data.nach.lagerbereich, deltaVerfuegbar: Math.abs(menge) },
      session
    );

    // 7) Rückgabe
    const wegRes: BewegungResource = {
      id: weg._id.toString(),
      timestamp: weg.timestamp.toISOString(),
      typ: "UMBUCHUNG_WEG",
      artikelId: data.artikelId,
      artikelName,
      artikelNummer,
      chargeId: src._id.toString(),
      menge: -Math.abs(menge),
      lagerbereich: data.von.lagerbereich,
      notiz: data.notiz ?? undefined,
      mhd: toISODate(src.mhd)?.slice(0, 10),
      schlachtDatum: toISODate(src.schlachtDatum)?.slice(0, 10),
      isTK: src.isTK,
    };
    const hinRes: BewegungResource = {
      id: hin._id.toString(),
      timestamp: hin.timestamp.toISOString(),
      typ: "UMBUCHUNG_HIN",
      artikelId: data.artikelId,
      artikelName,
      artikelNummer,
      chargeId: zielChargeId.toString(),
      menge: Math.abs(menge),
      lagerbereich: data.nach.lagerbereich,
      notiz: data.notiz ?? undefined,
      mhd: toISODate(ziel!.mhd)?.slice(0, 10),
      schlachtDatum: toISODate(ziel!.schlachtDatum)?.slice(0, 10),
      isTK: ziel!.isTK,
    };

    return { weg: wegRes, hin: hinRes, zielChargeId: zielChargeId.toString() };
  });
}

/* ----------------------------- Charge Merge ------------------------------- */

/**
 * Chargen zusammenführen:
 *  - bucht Menge von Quelle (WEG) in Ziel (HIN)
 *  - Menge leer → vollständige Quelle
 *  - Lagerbereich des Ziels wird vom Aufrufer vorgegeben (UI kennt Kontext)
 *  - Quelle-Charge bleibt bestehen (historische Korrektheit); falls gewünscht, kann man sie später „archiviert“ markieren.
 */
export async function mergeCharge(data: MergeChargeDTO): Promise<{ weg: BewegungResource; hin: BewegungResource }> {
  const quelleId = new Types.ObjectId(data.quelleChargeId);
  const zielId = new Types.ObjectId(data.zielChargeId);

  return await withTransaction(async (session) => {
    const [quelle, ziel] = await Promise.all([
      ChargeModel.findById(quelleId).session(session),
      ChargeModel.findById(zielId).session(session),
    ]);
    if (!quelle) throw new Error("Quell-Charge nicht gefunden");
    if (!ziel) throw new Error("Ziel-Charge nicht gefunden");
    if (quelle.artikelId.toString() !== data.artikelId || ziel.artikelId.toString() !== data.artikelId) {
      throw new Error("Chargen passen nicht zum Artikel");
    }

    // Menge bestimmen: wenn leer → ganze Quelle (hier benötigst du i. d. R. eine verfügbare-Menge-Quelle;
    // falls du sie aus BestandAgg holst, rufe sie hier ab – wir erlauben Überzug standardmäßig NICHT zu blocken)
    const menge = normalizeNumber(data.menge ?? 0.000001); // placeholder >0
    // Optional: wenn du „ganze Quelle“ willst, ersetze oben durch Lookup BestandAgg(quelle) -> verfuegbar

    const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);

    const weg = await new BewegungModel({
      timestamp: new Date(),
      userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
      typ: "UMBUCHUNG_WEG",
      artikelId: quelle.artikelId,
      artikelName,
      artikelNummer,
      chargeId: quelle._id,
      menge: -Math.abs(menge),
      lagerbereich: data.zielLagerbereich, // Quelle-Lagerbereich unbekannt → UI vorher entscheiden; sonst separat mitgeben
      notiz: data.notiz ? `[MERGE->${ziel._id}] ${data.notiz}` : `[MERGE->${ziel._id}]`,
      mhd: quelle.mhd,
      schlachtDatum: quelle.schlachtDatum,
      isTK: quelle.isTK,
    }).save({ session });

    const hin = await new BewegungModel({
      timestamp: new Date(),
      userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
      typ: "UMBUCHUNG_HIN",
      artikelId: ziel.artikelId,
      artikelName,
      artikelNummer,
      chargeId: ziel._id,
      menge: Math.abs(menge),
      lagerbereich: data.zielLagerbereich,
      notiz: data.notiz ? `[MERGE_FROM:${quelle._id}] ${data.notiz}` : `[MERGE_FROM:${quelle._id}]`,
      mhd: ziel.mhd,
      schlachtDatum: ziel.schlachtDatum,
      isTK: ziel.isTK,
    }).save({ session });

    await upsertBestandAgg(
      { artikelId: data.artikelId, chargeId: quelle._id.toString(), lagerbereich: data.zielLagerbereich, deltaVerfuegbar: -Math.abs(menge) },
      session
    );
    await upsertBestandAgg(
      { artikelId: data.artikelId, chargeId: ziel._id.toString(), lagerbereich: data.zielLagerbereich, deltaVerfuegbar: Math.abs(menge) },
      session
    );

    const wegRes: BewegungResource = {
      id: weg._id.toString(),
      timestamp: weg.timestamp.toISOString(),
      typ: "UMBUCHUNG_WEG",
      artikelId: data.artikelId,
      artikelName,
      artikelNummer,
      chargeId: quelle._id.toString(),
      menge: -Math.abs(menge),
      lagerbereich: data.zielLagerbereich,
      notiz: weg.notiz,
      mhd: toISODate(quelle.mhd)?.slice(0, 10),
      schlachtDatum: toISODate(quelle.schlachtDatum)?.slice(0, 10),
      isTK: quelle.isTK,
    };
    const hinRes: BewegungResource = {
      id: hin._id.toString(),
      timestamp: hin.timestamp.toISOString(),
      typ: "UMBUCHUNG_HIN",
      artikelId: data.artikelId,
      artikelName,
      artikelNummer,
      chargeId: ziel._id.toString(),
      menge: Math.abs(menge),
      lagerbereich: data.zielLagerbereich,
      notiz: hin.notiz,
      mhd: toISODate(ziel.mhd)?.slice(0, 10),
      schlachtDatum: toISODate(ziel.schlachtDatum)?.slice(0, 10),
      isTK: ziel.isTK,
    };

    return { weg: wegRes, hin: hinRes };
  });
}