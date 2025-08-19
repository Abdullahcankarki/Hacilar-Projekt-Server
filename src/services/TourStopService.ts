// backend/src/services/TourStopService.ts
import mongoose, { ClientSession, Types } from "mongoose";
import { TourStop } from "../model/TourStopModel"; // dein Mongoose Model
import { Tour } from "../model/TourModel";         // für Gewicht-Neuberechnung
import { Auftrag } from "../model/AuftragModel";   // optional für GewichtSumme
import { TourStopResource } from "src/Resources";
import { recomputeTourWeight, updateOverCapacityFlag } from "./tour-hooksService";

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
  // letzte Position berechnen
  const count = await TourStop.countDocuments({ tourId: data.tourId });
  const position = count + 1;

  const newStop = new TourStop({
    tourId: new Types.ObjectId(data.tourId),
    auftragId: new Types.ObjectId(data.auftragId),
    kundeId: new Types.ObjectId(data.kundeId),
    kundeName: data.kundeName,
    position,
    gewichtKg: data.gewichtKg ?? null,
    status: data.status,
    fehlgrund: data.fehlgrund,
    signaturPngBase64: data.signaturPngBase64,
    signTimestampUtc: data.signTimestampUtc,
    signedByName: data.signedByName,
    leergutMitnahme: data.leergutMitnahme ?? [],
  });

  const saved = await newStop.save();
  await recomputeTourWeight(saved.tourId.toString());

  return toResource(saved);
}

export async function getTourStopById(id: string): Promise<TourStopResource | null> {
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

export async function updateTourStop(id: string, data: Partial<TourStopResource>): Promise<TourStopResource> {
  const doc = await TourStop.findById(id);
  if (!doc) throw new Error("TourStop nicht gefunden");

  if (data.position && data.position !== doc.position) {
    // Position neu sortieren
    await resequenceStops(doc.tourId.toString(), doc._id.toString(), data.position);
  }

  if (data.gewichtKg !== undefined) doc.gewichtKg = data.gewichtKg;
  if (data.status !== undefined) doc.status = data.status;
  if (data.fehlgrund !== undefined) doc.fehlgrund = data.fehlgrund;
  if (data.signaturPngBase64 !== undefined) doc.signaturPngBase64 = data.signaturPngBase64;
  if (data.signTimestampUtc !== undefined) doc.signTimestampUtc = data.signTimestampUtc;
  if (data.signedByName !== undefined) doc.signedByName = data.signedByName;
  if (data.leergutMitnahme !== undefined) doc.leergutMitnahme = data.leergutMitnahme;

  await doc.save();
  await recomputeTourWeight(doc.tourId.toString());

  return toResource(doc);
}

/* --------------------------- Hilfsfunktionen --------------------------- */


async function resequenceStops(tourId: string, stopId: string, newPos: number) {
  const stops = await TourStop.find({ tourId }).sort({ position: 1 });
  const maxPos = stops.length;
  const bounded = Math.max(1, Math.min(newPos, maxPos));

  const reordered = stops
    .filter((s) => s._id.toString() !== stopId)
    .map((s) => s._id.toString());

  reordered.splice(bounded - 1, 0, stopId);

  for (let i = 0; i < reordered.length; i++) {
    await TourStop.updateOne({ _id: reordered[i] }, { $set: { position: i + 1 } });
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
async function closeGapsAfterRemoval(tourId: string, oldPos: number, session: ClientSession) {
  await TourStop.updateMany(
    { tourId, position: { $gt: oldPos } },
    { $inc: { position: -1 } },
    { session }
  );
}

// Leere Tour löschen (standardmäßig nur, wenn isStandard=true)
async function deleteTourIfEmpty(tourId: string, session: ClientSession, onlyIfStandard = true) {
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
      const stops = await TourStop.find({}, { _id: 1, tourId: 1, position: 1, auftragId: 1 }).session(session);
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
