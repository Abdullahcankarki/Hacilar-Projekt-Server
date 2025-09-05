// backend/src/services/TourStopService.ts
import mongoose, { ClientSession, Types } from "mongoose";
import { TourStop } from "../model/TourStopModel"; // dein Mongoose Model
import { Tour } from "../model/TourModel"; // für Gewicht-Neuberechnung
import { Auftrag } from "../model/AuftragModel"; // optional für GewichtSumme
import { Kunde } from "../model/KundeModel"; // Kunde lesen für Name/Adresse
import { TourStopResource } from "src/Resources";

import {
  recomputeTourWeight,
  updateOverCapacityFlag,
} from "./tour-hooksService";

// Gewicht 1:1 aus Auftrag übernehmen
async function deriveGewichtFromAuftrag(
  auftragId: string,
  session?: mongoose.ClientSession
): Promise<number | null> {
  const a: any = await Auftrag.findById(auftragId)
    .session(session || (null as any))
    .lean();
  if (!a) return null;
  const raw = (a as any).gewicht;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (
    typeof raw === "string" &&
    raw.trim() !== "" &&
    !Number.isNaN(Number(raw))
  )
    return Number(raw);
  return null;
}

function normalizeSignatureBase64(val?: string) {
  if (!val) return undefined;
  const s = String(val);
  const base64 = s.includes(",") ? s.split(",")[1] : s;
  const trimmed = base64.trim();
  return trimmed.length ? trimmed : undefined;
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

  // Kunde laden, um Name/Adresse zu setzen (Quelle der Wahrheit)
  let kundeNameFromDb: string | undefined;
  let kundeAdressFromDb: string | undefined;
  try {
    const k: any = await (Kunde as any).findById(data.kundeId).lean();
    if (k) {
      // Versuche gängige Feldnamen; passe bei Bedarf an dein Schema an
      kundeNameFromDb = k.name || k.firma || k.fullName || k.bezeichnung || undefined;
      kundeAdressFromDb = k.adresse;
    }
  } catch {}

  const newStop = new TourStop({
    tourId: new Types.ObjectId(data.tourId),
    auftragId: new Types.ObjectId(data.auftragId),
    kundeId: new Types.ObjectId(data.kundeId),
    kundeName: data.kundeName ?? kundeNameFromDb,
    kundeAdress: kundeAdressFromDb,
    position,
    gewichtKg:
      derivedGewicht !== null
        ? derivedGewicht
        : data.gewichtKg !== undefined && data.gewichtKg !== null
        ? Number(data.gewichtKg)
        : null,
    status: data.status,
    fehlgrund: data.fehlgrund,
    signaturPngBase64: normalizeSignatureBase64(data.signaturPngBase64),
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
  if (data.signaturPngBase64 !== undefined) {
    const clean = normalizeSignatureBase64(data.signaturPngBase64 as any);
    if (clean) {
      doc.set("signaturPngBase64", clean);
    } else {
      // Leeren erlauben, falls der Client die Signatur zurückziehen möchte
      doc.set("signaturPngBase64", undefined);
    }
    // Falls das Feld im Schema als Mixed oder select:false definiert ist:
    try {
      (doc as any).markModified?.("signaturPngBase64");
    } catch {}
  }
  if (data.signaturPngBase64 !== undefined && !data.signTimestampUtc) {
    doc.signTimestampUtc = new Date().toISOString();
  }
  if (data.signTimestampUtc !== undefined)
    doc.signTimestampUtc = data.signTimestampUtc;
  if (data.signedByName !== undefined) doc.signedByName = data.signedByName;
  if (data.leergutMitnahme !== undefined)
    doc.leergutMitnahme = data.leergutMitnahme;

  await doc.save();
  await recomputeTourWeight(doc.tourId.toString());

  return toResource(doc);
}

// Timer-Registry: verzögertes Löschen leerer Touren (Debounce 5s)
const pendingDeleteTimers = new Map<string, NodeJS.Timeout>();

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
    kundeAdress: (doc as any).kundeAdress,
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

// Löscht eine leere Tour erst NACH 5s, falls sie in der Zwischenzeit leer bleibt.
// Hinweis: Der finale Delete läuft OHNE Session (außerhalb der ursprünglichen Transaktion).
async function deleteTourIfEmpty(
  tourId: string,
  _session: ClientSession,
  onlyIfStandard = true
) {
  // Sofortiger Check: wenn nicht leer → nichts tun
  const remainingNow = await TourStop.countDocuments({ tourId }).session(
    _session
  );
  if (remainingNow > 0) return;

  // Bestehenden Timer für diese Tour abbrechen (debounce)
  const existing = pendingDeleteTimers.get(tourId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    try {
      // Re-Check OHNE Session (Transaktion ist längst beendet)
      const remaining = await TourStop.countDocuments({ tourId });
      if (remaining > 0) return; // in der Zwischenzeit wieder befüllt

      const t = await Tour.findById(tourId).lean();
      if (!t) return;
      if (onlyIfStandard && !(t as any).isStandard) return;

      await Tour.deleteOne({ _id: tourId });
    } catch (e) {
      console.error("Delayed delete of empty tour failed", e);
    } finally {
      pendingDeleteTimers.delete(tourId);
    }
  }, 5000);

  pendingDeleteTimers.set(tourId, timer);
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
        kundeAdress: (stop as any).kundeAdress as string | undefined,
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
        kundeAdress: (payload as any).kundeAdress,
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

// --- Geocoding (Kunde -> lat/lng). Versucht erst DB-Felder, dann Nominatim (OSM), inkl. kleinem Memory-Cache.
const geocodeCache = new Map<string, { lat: number; lng: number }>();

async function getCoordsForKunde(kundeId: string, fallbackAddress?: string): Promise<{ lat?: number; lng?: number }> {
  // 1) Memory-Cache nach Adresse nutzen (wenn vorhanden)
  if (fallbackAddress) {
    const hit = geocodeCache.get(fallbackAddress.trim().toLowerCase());
    if (hit) return hit;
  }

  try {
    // 2) Kunde aus DB lesen und offensichtliche Felder prüfen
    const k: any = await (Kunde as any).findById(kundeId).lean();
    if (k) {
      const lat = Number(k?.lat ?? k?.latitude ?? k?.geo?.lat ?? k?.location?.coordinates?.[1]);
      const lng = Number(k?.lng ?? k?.longitude ?? k?.geo?.lng ?? k?.location?.coordinates?.[0]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }

    // 3) Wenn keine Koordinaten, optional aus Adresse geokodieren
    const address = (k?.adresse || fallbackAddress || '').toString().trim();
    if (!address) return {};

    // Nominatim-Geocoding (OSM). Bitte respektvoll nutzen; idealerweise Server-seitig mit Cache.
    const params = new URLSearchParams({
      format: 'json',
      q: address,
      limit: '1',
      addressdetails: '0',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'HacilarNeu/1.0 (server geocoder)' }
    });
    if (!res.ok) return {};
    const arr: any[] = await res.json();
    const first = Array.isArray(arr) ? arr[0] : null;
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      // Cache im Speicher
      if (address) geocodeCache.set(address.trim().toLowerCase(), { lat, lng });
      // Optional: in Kunde-Dokument persistieren (best-effort)
      try {
        if (k && !k.geo) {
          await (Kunde as any).updateOne({ _id: kundeId }, { $set: { geo: { lat, lng } } });
        }
      } catch {}
      return { lat, lng };
    }
  } catch {}
  return {};
}

// --- Zusatz: Helper für YYYY-MM-DD in Europe/Berlin
function todayYmdBerlin(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/** Liefert Start/Ende des angegebenen YYYY-MM-DD (Europe/Berlin) als echte Date-Instants (UTC). */
function berlinDayRange(dateYmd: string): { from: Date; to: Date } {
  const [Y, M, D] = dateYmd.split('-').map(Number);
  // UTC-Mitternacht dieses Kalendertages (YYYY-MM-DD)
  const t0 = Date.UTC(Y, M - 1, D, 0, 0, 0, 0);
  // Wie spät ist es in Berlin zu diesem UTC-Zeitpunkt?
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = fmt.formatToParts(new Date(t0));
  const hh = Number(p.find(x => x.type === 'hour')?.value || '0');
  const mm = Number(p.find(x => x.type === 'minute')?.value || '0');
  const ss = Number(p.find(x => x.type === 'second')?.value || '0');
  // Offset in Minuten (z.B. 120 für UTC+2). Berlin-Mitternacht = UTC-Mitternacht minus Offset
  const offsetMs = ((hh * 60) + mm) * 60 * 1000 + (ss * 1000);
  const fromMs = t0 - offsetMs;
  const toMs = fromMs + (24 * 60 * 60 * 1000) - 1; // Ende des Tages
  return { from: new Date(fromMs), to: new Date(toMs) };
}

/**
 * Liefert alle Kunden-Stopps (kundeId, kundeName, kundeAdress) für alle Touren am angegebenen Tag.
 * - Default: HEUTE (Europe/Berlin)
 * - Optionaler Filter: fahrerId, region
 * - Sortierung: TourStop.position ASC
 */
export async function listCustomerStopsForDate(params?: {
  dateYmd?: string;      // YYYY-MM-DD (Europe/Berlin)
  fahrerId?: string;     // optionaler Filter
  region?: string;       // optionaler Filter (exakt gleich)
}): Promise<Array<{
  tourId: string;
  stopId: string;
  kundeId: string;
  kundeName?: string;
  kundeAdress?: string;
  position: number;
  lat?: number;
  lng?: number;
}>> {
  const dateYmd = params?.dateYmd || todayYmdBerlin();

  // 1) Alle Touren am Tag (optional gefiltert) – Feld `datum` ist ein Date
  const { from, to } = berlinDayRange(dateYmd);
  const tourQuery: any = { datum: { $gte: from, $lte: to } };
  if (params?.fahrerId) tourQuery.fahrerId = params.fahrerId;
  if (params?.region) tourQuery.region = params.region;

  const tours: Array<any> = await (Tour as any).find(tourQuery, { _id: 1 }).lean();
  if (!tours.length) return [];

  const tourIds = tours.map(t => String(t._id));

  // 2) Alle Stops der gefundenen Touren, sortiert
  const stops = await TourStop.find({ tourId: { $in: tourIds } })
    .sort({ position: 1 })
    .lean();

  // 3) Falls Name/Adresse fehlen, optional Kunde nachladen (minimiert, per Batch)
  const missingKundeIds = Array.from(new Set(
    stops
      .filter(s => (!s.kundeName || !(s as any).kundeAdress) && s.kundeId)
      .map(s => String(s.kundeId))
  ));

  let kundenById: Record<string, { name?: string; adresse?: string }> = {};
  if (missingKundeIds.length) {
    try {
      const kunden = await (Kunde as any).find(
        { _id: { $in: missingKundeIds.map(id => new Types.ObjectId(id)) } },
        { _id: 1, name: 1, firma: 1, fullName: 1, bezeichnung: 1, adresse: 1 }
      ).lean();
      kundenById = (kunden || []).reduce((acc: any, k: any) => {
        acc[String(k._id)] = {
          name: k.name || k.firma || k.fullName || k.bezeichnung,
          adresse: k.adresse,
        };
        return acc;
      }, {} as Record<string, { name?: string; adresse?: string }>);
    } catch {}
  }

  // 3b) Koordinaten ermitteln (aus Kunde.geo oder via Geocoding) – best-effort
  const coordsByKunde: Record<string, { lat?: number; lng?: number }> = {};
  const uniqueKundeIds = Array.from(new Set(stops.map(s => String(s.kundeId)).filter(Boolean)));
  for (const kid of uniqueKundeIds) {
    const fallbackAddr = kundenById[kid]?.adresse;
    try {
      coordsByKunde[kid] = await getCoordsForKunde(kid, fallbackAddr);
    } catch {
      coordsByKunde[kid] = {};
    }
  }

  // 4) Ausgabe normalisieren
  const result = stops.map((s: any) => {
    const kid = String(s.kundeId);
    const fallback = kundenById[kid] || {};
    return {
      tourId: String(s.tourId),
      stopId: String(s._id),
      kundeId: kid,
      kundeName: s.kundeName || fallback.name,
      kundeAdress: (s as any).kundeAdress || fallback.adresse,
      position: typeof s.position === 'number' ? s.position : 0,
      lat: coordsByKunde[kid]?.lat,
      lng: coordsByKunde[kid]?.lng,
    };
  });

  return result;
}