// backend/src/services/TourStopService.ts
import mongoose, { ClientSession, Types } from "mongoose";
import { TourStop } from "../model/TourStopModel"; // dein Mongoose Model
import { Tour } from "../model/TourModel"; // für Gewicht-Neuberechnung
import { Auftrag } from "../model/AuftragModel"; // optional für GewichtSumme
import { TourStopResource } from "src/Resources";

import {
  recomputeTourWeight,
  updateOverCapacityFlag,
} from "./tour-hooksService";

// Gewicht 1:1 aus Auftrag übernehmen
async function deriveGewichtFromAuftrag(auftragId: string, session?: mongoose.ClientSession): Promise<number | null> {
  const a: any = await Auftrag.findById(auftragId).session(session || (null as any)).lean();
  if (!a) return null;
  const raw = (a as any).gewicht;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return null;
}

export async function createTourStop(data: {
  tourId: string;
  auftragId: string;
  kundeId: string;
  kundeName?: string;
  gewichtKg?: number;
  status: string;
  fehlgrund?: { code?: string; text?: string };
  signaturPngBase64?: string;
  signTimestampUtc?: string;
  signedByName?: string;
  leergutMitnahme?: { art: string; anzahl: number; gewichtKg?: number }[];
}): Promise<TourStopResource> {
  // letzte Position robust ermitteln (MAX(position) + 1), funktioniert auch bei Lücken
  const last = await TourStop.find({ tourId: data.tourId })
    .sort({ position: -1 })
    .limit(1);
  const position = ((last[0]?.position as number | undefined) ?? 0) + 1;

  // Gewicht primär aus Auftrag ableiten; falls nicht ermittelbar, optional übergebenen Wert verwenden
  const derivedGewicht = await deriveGewichtFromAuftrag(data.auftragId);

  const newStop = new TourStop({
    tourId: new Types.ObjectId(data.tourId),
    auftragId: new Types.ObjectId(data.auftragId),
    kundeId: new Types.ObjectId(data.kundeId),
    kundeName: data.kundeName,
    position,
    gewichtKg: derivedGewicht !== null ? derivedGewicht : (data.gewichtKg !== undefined && data.gewichtKg !== null ? Number(data.gewichtKg) : null),
    status: data.status,
    fehlgrund: data.fehlgrund,
    signaturPngBase64: data.signaturPngBase64,
    signTimestampUtc: data.signTimestampUtc,
    signedByName: data.signedByName,
    leergutMitnahme: data.leergutMitnahme ?? [],
  });

  const saved = await newStop.save();
  // Auftrag mit neuem Stop verknüpfen
  await Auftrag.updateOne(
    { _id: data.auftragId },
    { $set: { tourId: new Types.ObjectId(data.tourId), tourStopId: saved._id } }
  );
  await recomputeTourWeight(saved.tourId.toString());

  return toResource(saved);
}

export async function getTourStopById(
  id: string
): Promise<TourStopResource | null> {
  const doc = await TourStop.findById(id);
  return doc ? toResource(doc) : null;
}

export async function listTourStops(filter: {
  tourId?: string;
  auftragId?: string;
  kundeId?: string;
}): Promise<TourStopResource[]> {
  const query: any = {};
  if (filter.tourId) query.tourId = filter.tourId;
  if (filter.auftragId) query.auftragId = filter.auftragId;
  if (filter.kundeId) query.kundeId = filter.kundeId;

  const docs = await TourStop.find(query).sort({ position: 1 });
  return docs.map(toResource);
}

export async function updateTourStop(
  id: string,
  data: Partial<TourStopResource>
): Promise<TourStopResource> {
  const doc = await TourStop.findById(id);
  if (!doc) throw new Error("TourStop nicht gefunden");

  if (data.position && data.position !== doc.position) {
    // Position neu sortieren (kollisionssicher)
    await resequenceStopsSafe(
      doc.tourId.toString(),
      doc._id.toString(),
      data.position
    );
  }

  if (data.gewichtKg !== undefined) {
    const num = data.gewichtKg as any;
    doc.gewichtKg =
      num === null || num === "" || Number.isNaN(Number(num))
        ? null
        : Number(num);
  }
  if (data.status !== undefined) doc.status = data.status;
  if (data.fehlgrund !== undefined) doc.fehlgrund = data.fehlgrund;
  if (data.signaturPngBase64 !== undefined)
    doc.signaturPngBase64 = data.signaturPngBase64;
  if (data.signTimestampUtc !== undefined)
    doc.signTimestampUtc = data.signTimestampUtc;
  if (data.signedByName !== undefined) doc.signedByName = data.signedByName;
  if (data.leergutMitnahme !== undefined)
    doc.leergutMitnahme = data.leergutMitnahme;

  await doc.save();
  await recomputeTourWeight(doc.tourId.toString());

  return toResource(doc);
}

/* --------------------------- Hilfsfunktionen --------------------------- */

// ersetzt die bisherige Funktion 1:1
async function resequenceStops(tourId: string, stopId: string, newPos: number) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // 1) Aktuelle Reihenfolge stabil (in der Session) lesen
      const stops = await TourStop.find({ tourId })
        .sort({ position: 1 })
        .session(session);
      const maxPos = stops.length;
      const bounded = Math.max(1, Math.min(newPos, maxPos));

      // Ziel-IDs berechnen (stopId an gewünschte Stelle einsetzen)
      const reordered = stops
        .filter((s) => s._id.toString() !== stopId)
        .map((s) => s._id.toString());
      reordered.splice(bounded - 1, 0, stopId);

      // 2) PHASE A: Alle Stops temporär in hohen Bereich verschieben (verhindert (tourId, position) Kollisionen)
      const TEMP_OFFSET = 1000;
      if (stops.length) {
        await TourStop.bulkWrite(
          stops.map((s, idx) => ({
            updateOne: {
              filter: { _id: s._id },
              update: { $set: { position: TEMP_OFFSET + (idx + 1) } },
            },
          })),
          { session }
        );
      }

      // 3) PHASE B: Finale Positionen 1..N gemäß 'reordered' setzen
      if (reordered.length) {
        await TourStop.bulkWrite(
          reordered.map((id, idx) => ({
            updateOne: {
              filter: { _id: id },
              update: { $set: { position: idx + 1 } },
            },
          })),
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

// Verhindert (tourId, position)-Kollisionen durch Zweiphasen-Update und erlaubt Nutzung in bestehender Session
async function resequenceStopsSafe(
  tourId: string,
  stopId: string,
  newPos: number,
  session?: mongoose.ClientSession
) {
  const stops = await TourStop.find({ tourId })
    .session(session || (null as any))
    .sort({ position: 1 });
  if (!stops.length) return;

  const maxPos = stops.length;
  const bounded = Math.max(1, Math.min(newPos, maxPos));

  // neue Reihenfolge mit stopId an gewünschter Position
  const reordered = stops
    .filter((s) => s._id.toString() !== stopId)
    .map((s) => s._id.toString());
  reordered.splice(bounded - 1, 0, stopId);

  const BULK_OFFSET = 10000;

  // Phase A: temporär in hohen Bereich
  const bulkA = reordered.map((id, i) => ({
    updateOne: {
      filter: { _id: new Types.ObjectId(id) },
      update: { $set: { position: i + 1 + BULK_OFFSET } },
    },
  }));
  if (bulkA.length) {
    await TourStop.bulkWrite(bulkA, { session });
  }

  // Phase B: final 1..N
  const bulkB = reordered.map((id, i) => ({
    updateOne: {
      filter: { _id: new Types.ObjectId(id) },
      update: { $set: { position: i + 1 } },
    },
  }));
  if (bulkB.length) {
    await TourStop.bulkWrite(bulkB, { session });
  }
}

function toResource(doc: any): TourStopResource {
  return {
    id: doc._id.toString(),
    tourId: doc.tourId?.toString(),
    auftragId: doc.auftragId?.toString(),
    kundeId: doc.kundeId?.toString(),
    kundeName: doc.kundeName,
    position: doc.position,
    gewichtKg: doc.gewichtKg ?? undefined,
    status: doc.status,
    fehlgrund: doc.fehlgrund,
    signaturPngBase64: doc.signaturPngBase64,
    signTimestampUtc: doc.signTimestampUtc,
    signedByName: doc.signedByName,
    leergutMitnahme: doc.leergutMitnahme,
    abgeschlossenAm: doc.abgeschlossenAm,
    updatedAt: doc.updatedAt,
  };
}
// Lücke schließen: alle Positionen > oldPos -1
async function closeGapsAfterRemoval(
  tourId: string,
  oldPos: number,
  session: ClientSession
) {
  await TourStop.updateMany(
    { tourId, position: { $gt: oldPos } },
    { $inc: { position: -1 } },
    { session }
  );
}

// Leere Tour löschen (standardmäßig nur, wenn isStandard=true)
async function deleteTourIfEmpty(
  tourId: string,
  session: ClientSession,
  onlyIfStandard = true
) {
  const remaining = await TourStop.countDocuments({ tourId }).session(session);
  if (remaining > 0) return;

  const t = await Tour.findById(tourId).session(session).lean();
  if (!t) return;
  if (onlyIfStandard && !(t as any).isStandard) return;

  await Tour.deleteOne({ _id: tourId }, { session });
}

/**
 * EINEN TourStop löschen:
 * - Positionen der Tour schließen
 * - Gewicht & OverCapacity der Tour neu berechnen
 * - Auftrag-Referenzen (tourId/tourStopId) nullen
 * - ggf. leere Standard-Tour löschen
 */
export async function deleteTourStop(id: string): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const stop = await TourStop.findById(id).session(session);
      if (!stop) throw new Error("TourStop nicht gefunden");

      const tourId = String(stop.tourId);
      const auftragId = String(stop.auftragId);
      const oldPos = stop.position ?? 0;

      // 1) Stop löschen
      await TourStop.deleteOne({ _id: stop._id }).session(session);

      // 2) Reihenfolge in Tour schließen
      if (oldPos > 0) {
        await closeGapsAfterRemoval(tourId, oldPos, session);
      }

      // 3) Auftrag entkoppeln
      await Auftrag.updateOne(
        { _id: auftragId },
        { $set: { tourId: null, tourStopId: null } },
        { session }
      );

      // 4) Gewicht & OverCapacity der Tour neu berechnen
      await recomputeTourWeight(tourId, session);
      await updateOverCapacityFlag(tourId, session);

      // 5) Leere Standard-Tour automatisch löschen
      await deleteTourIfEmpty(tourId, session, /* onlyIfStandard */ true);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * ALLE TourStops löschen:
 * - Reihenfolgen je Tour schließen
 * - Gewicht & OverCapacity je betroffene Tour neu berechnen
 * - Aufträge entkoppeln
 */
export async function deleteAllTourStops(): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // betroffene Stops/Touren/ Aufträge erfassen
      const stops = await TourStop.find(
        {},
        { _id: 1, tourId: 1, position: 1, auftragId: 1 }
      ).session(session);
      if (!stops.length) {
        await TourStop.deleteMany({}).session(session);
        return;
      }

      const tourPositions = new Map<string, number[]>();
      const auftragIds = new Set<string>();

      for (const s of stops) {
        const tId = String(s.tourId);
        const pos = typeof s.position === "number" ? s.position : 0;
        if (!tourPositions.has(tId)) tourPositions.set(tId, []);
        tourPositions.get(tId)!.push(pos);
        auftragIds.add(String(s.auftragId));
      }

      // 1) Alle Stops löschen
      await TourStop.deleteMany({}).session(session);

      // 2) Aufträge entkoppeln (batch)
      if (auftragIds.size) {
        await Auftrag.updateMany(
          { _id: { $in: Array.from(auftragIds) } },
          { $set: { tourId: null, tourStopId: null } },
          { session }
        );
      }

      // 3) Für jede Tour: Reihenfolge schließen & Recompute
      for (const [tourId, positions] of tourPositions.entries()) {
        // Nach Löschung sind keine Stops mehr da → Reihenfolge-Schließen entfällt faktisch,
        // aber falls du "teilweise" löschst, wäre die Logik hier identisch:
        positions.sort((a, b) => a - b);
        for (const oldPos of positions) {
          if (oldPos > 0) {
            await closeGapsAfterRemoval(tourId, oldPos, session);
          }
        }
        await recomputeTourWeight(tourId, session);
        await updateOverCapacityFlag(tourId, session);
        await deleteTourIfEmpty(tourId, session, true);
      }
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Stop zwischen Touren verschieben (atomar):
 * - Quelle: Stop lesen, Daten puffern, löschen, Lücke schließen
 * - Ziel: Stop am Ende anlegen, optional an Zielposition verschieben
 * - Aufträge verknüpfen, Gewichte & OverCapacity für beide Touren neu berechnen
 */
export async function moveTourStopAcrossTours(params: {
  stopId: string;
  toTourId: string;
  targetIndex?: number; // 0-basiert, optional
}): Promise<TourStopResource> {
  const session = await mongoose.startSession();
  try {
    let createdDoc: any;
    await session.withTransaction(async () => {
      const stop = await TourStop.findById(params.stopId).session(session);
      if (!stop) throw new Error("TourStop nicht gefunden");

      const fromTourId = String(stop.tourId);
      const toTourId = String(params.toTourId);

      // Falls gleiche Tour → nur resequence
      if (fromTourId === toTourId) {
        const newPos =
          typeof params.targetIndex === "number"
            ? params.targetIndex + 1
            : stop.position;
        if (newPos && newPos !== stop.position) {
          await resequenceStopsSafe(
            fromTourId,
            stop._id.toString(),
            newPos,
            session
          );
        }
        const fresh = await TourStop.findById(stop._id).session(session);
        return toResource(fresh);
      }

      // Daten puffern, bevor wir löschen
      const payload = {
        auftragId: String(stop.auftragId),
        kundeId: String(stop.kundeId),
        kundeName: stop.kundeName as string | undefined,
        gewichtKg: (stop.gewichtKg ?? undefined) as number | undefined,
        status: String(stop.status),
        fehlgrund: stop.fehlgrund as any,
        signaturPngBase64: stop.signaturPngBase64 as string | undefined,
        signTimestampUtc: stop.signTimestampUtc as string | undefined,
        signedByName: stop.signedByName as string | undefined,
        leergutMitnahme: Array.isArray(stop.leergutMitnahme)
          ? stop.leergutMitnahme
          : [],
      };

      const oldPos = typeof stop.position === "number" ? stop.position : 0;

      // 1) Quelle: Stop löschen
      await TourStop.deleteOne({ _id: stop._id }).session(session);
      //    Quelle: Reihenfolge schließen
      if (oldPos > 0) {
        await closeGapsAfterRemoval(fromTourId, oldPos, session);
      }

      // 2) Ziel: nächste freie Position via MAX(position)+1 bestimmen (robust gegen Lücken) und Stop anlegen
      const lastInTarget = await TourStop.find({ tourId: toTourId })
        .session(session)
        .sort({ position: -1 })
        .limit(1);
      const nextPos =
        ((lastInTarget[0]?.position as number | undefined) ?? 0) + 1;

      const newStop = new TourStop({
        tourId: new Types.ObjectId(toTourId),
        auftragId: new Types.ObjectId(payload.auftragId),
        kundeId: new Types.ObjectId(payload.kundeId),
        kundeName: payload.kundeName,
        position: nextPos,
        gewichtKg: payload.gewichtKg ?? null,
        status: payload.status,
        fehlgrund: payload.fehlgrund,
        signaturPngBase64: payload.signaturPngBase64,
        signTimestampUtc: payload.signTimestampUtc,
        signedByName: payload.signedByName,
        leergutMitnahme: payload.leergutMitnahme ?? [],
      });
      const saved = await newStop.save({ session });
      createdDoc = saved;

      // 3) Optional: an Zielposition verschieben (Server-seitiges, kollisionssicheres Resequencing)
      if (typeof params.targetIndex === "number" && params.targetIndex >= 0) {
        const desiredPos = Math.min(params.targetIndex + 1, nextPos);
        if (desiredPos !== (saved.position as number)) {
          await resequenceStopsSafe(
            toTourId,
            saved._id.toString(),
            desiredPos,
            session
          );
        }
      }

      // 4) Auftrag-Verknüpfung aktualisieren
      await Auftrag.updateOne(
        { _id: payload.auftragId },
        {
          $set: { tourId: new Types.ObjectId(toTourId), tourStopId: saved._id },
        },
        { session }
      );

      // 5) Recompute & Flags für beide Touren
      await recomputeTourWeight(fromTourId, session);
      await updateOverCapacityFlag(fromTourId, session);
      await deleteTourIfEmpty(fromTourId, session, /* onlyIfStandard */ true);

      await recomputeTourWeight(toTourId, session);
      await updateOverCapacityFlag(toTourId, session);
    });

    return toResource(createdDoc);
  } finally {
    await session.endSession();
  }
}
