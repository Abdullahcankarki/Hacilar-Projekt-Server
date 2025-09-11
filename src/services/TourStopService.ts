// backend/src/services/TourStopService.ts
import mongoose, { ClientSession, Types } from "mongoose";
import { TourStop } from "../model/TourStopModel"; // dein Mongoose Model
import { Tour } from "../model/TourModel"; // für Gewicht-Neuberechnung
import { Auftrag } from "../model/AuftragModel"; // optional für GewichtSumme
import { Kunde } from "../model/KundeModel"; // Kunde lesen für Name/Adresse
import { Fahrzeug } from "../model/FahrzeugModel";
import { TourStopResource } from "src/Resources";
import nodemailer from "nodemailer";

// --- Geocoding (Kunde -> lat/lng). Versucht erst DB-Felder, dann Nominatim (OSM), inkl. kleinem Memory-Cache.
const geocodeCache = new Map<string, { lat: number; lng: number }>();

// Debug-Flag: ETA-Logs nur aktivieren, wenn ENV gesetzt ist
const DEBUG_ETA = process.env.DEBUG_TOURSTOP_ETA === '1';
const dlog = (...args: any[]) => { if (DEBUG_ETA) console.log('[ETA]', ...args); };

// --- Perf: fetch timeout + tiny in-memory caches ---
const DEFAULT_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5000);
function fetchWithTimeout(url: string, opts: any = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// Simple TTL cache helpers
type TTLItem<T> = { value: T; ts: number };
function getTTL<T>(map: Map<string, TTLItem<T>>, key: string, ttlMs: number): T | undefined {
  const it = map.get(key);
  if (!it) return undefined;
  if (Date.now() - it.ts > ttlMs) { map.delete(key); return undefined; }
  return it.value;
}
function setTTL<T>(map: Map<string, TTLItem<T>>, key: string, value: T) { map.set(key, { value, ts: Date.now() }); }

// --- Samsara HTTP Fallback (ohne externes Integrationsmodul) ---
const SAMSARA_API_KEY = process.env.SAMSARA_API_KEY || '';
const SAMSARA_API_BASE = process.env.SAMSARA_API_BASE || 'https://api.samsara.com'; // EU: https://api.eu.samsara.com

// Caches
const samsaraListCache = new Map<string, TTLItem<any[]>>(); // key: 'list'
const samsaraLocCache  = new Map<string, TTLItem<{lat:number,lng:number}>>(); // key: id|name|plate
const geocodeAddrCache = geocodeCache; // reuse existing
const pairTravelCache  = new Map<string, TTLItem<{min:number,max:number,source:string}>>(); // key: oLat,oLng-dLat,dLng rounded
const totalRouteCache  = new Map<string, TTLItem<{minutes:number, source:'google'|'ors'}>>();

const TTL_SAMSARA_LIST_MS = Number(process.env.TTL_SAMSARA_LIST_MS || 30_000);
const TTL_SAMSARA_LOC_MS  = Number(process.env.TTL_SAMSARA_LOC_MS  || 30_000);
const TTL_TRAVEL_PAIR_MS  = Number(process.env.TTL_TRAVEL_PAIR_MS || 60_000);
const TTL_ROUTE_TOTAL_MS  = Number(process.env.TTL_ROUTE_TOTAL_MS || 60_000);

async function samsaraHttpGet(path: string, query: Record<string, any> = {}) {
  if (!SAMSARA_API_KEY) throw new Error('SAMSARA_API_KEY missing');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const url = `${SAMSARA_API_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${SAMSARA_API_KEY}`, 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path} – ${txt}`);
  }
  return res.json();
}

const normSam = (x?: string) => x?.toString().trim().toLowerCase().replace(/\s+|[-_]/g, '');

async function samsaraListVehiclesHTTP(): Promise<any[]> {
  const cached = getTTL(samsaraListCache, 'list', TTL_SAMSARA_LIST_MS);
  if (cached) { dlog('Samsara HTTP listVehicles cache hit', cached.length); return cached; }
  if (!SAMSARA_API_KEY) return [];
  const out: any[] = [];
  let after: string | undefined;
  do {
    const page = await samsaraHttpGet('/assets', { type: 'vehicle', after, limit: 200 });
    const data = Array.isArray(page?.data) ? page.data : [];
    out.push(...data);
    after = page?.pagination?.hasNextPage ? page?.pagination?.endCursor : undefined;
  } while (after);
  dlog('Samsara HTTP listVehicles size', out.length);
  setTTL(samsaraListCache, 'list', out);
  return out;
}

async function samsaraGetVehicleLocationByIdOrNameHTTP(idOrName: string): Promise<{ lat?: number; lng?: number } | undefined> {
  const ckey = (idOrName || '').toLowerCase();
  const ch = getTTL(samsaraLocCache, ckey, TTL_SAMSARA_LOC_MS);
  if (ch) { dlog('Samsara HTTP loc cache hit', { idOrName }); return ch; }
  if (!SAMSARA_API_KEY) return undefined;
  const list = await samsaraListVehiclesHTTP();
  const want = normSam(idOrName);
  const hit = list.find((v: any) => {
    const id = normSam(v?.id || v?.vehicleId || v?._id);
    const name = normSam(v?.name || v?.label || v?.displayName);
    const plate = normSam(v?.licensePlate || v?.license_plate || v?.plate || v?.kennzeichen);
    return want && (want === id || want === plate || want === name);
  });

  const vehicleId = hit?.id || hit?.vehicleId || hit?._id;
  let stats: any;
  try {
    stats = await samsaraHttpGet('/fleet/vehicles/stats', vehicleId ? { types: 'gps', ids: vehicleId } : { types: 'gps' });
  } catch {
    stats = await samsaraHttpGet('/fleet/vehicles/stats', { types: 'gps' });
  }

  const rows: any[] = Array.isArray(stats?.data) ? stats.data : [];
  const pick = rows.find((r: any) => vehicleId && (r?.id === vehicleId)) || rows.find((r: any) => normSam(r?.name) === want);
  const gps = Array.isArray(pick?.gps) ? pick.gps.at(-1) : pick?.gps;
  const lat = Number(gps?.latitude ?? gps?.lat);
  const lng = Number(gps?.longitude ?? gps?.lng ?? gps?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    setTTL(samsaraLocCache, ckey, { lat, lng });
    return { lat, lng };
  }
  return undefined;
}

// --- Mail / SMTP (Developer-Alert bei Fallback) ---
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 0) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Hacilar Support <noreply@hacilar.eu>';
const DEV_ALERT = process.env.DEVELOPER_ALERT_EMAIL || '';

async function sendDeveloperAlertEmail(subject: string, text: string) {
  if (!DEV_ALERT || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) return; // silently ignore if not configured
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = SMTPS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({ from: SMTP_FROM, to: DEV_ALERT, subject, text });
    dlog('Dev alert mail sent');
  } catch (e) {
    console.error('[ETA] Dev alert mail failed', (e as any)?.message);
  }
}

const lastAlertBySubject = new Map<string, number>();
async function sendDeveloperAlertEmailDebounced(subject: string, text: string, minIntervalMs = 30_000) {
  const last = lastAlertBySubject.get(subject) || 0;
  if (Date.now() - last < minIntervalMs) return; // skip
  await sendDeveloperAlertEmail(subject, text);
  lastAlertBySubject.set(subject, Date.now());
}

// --- Hybrid Travel Time: Google (mit Traffic) -> Fallback ORS ---
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const ORS_API_KEY = process.env.ORS_API_KEY || '';

async function googleTravelTimeMinutes(origin: {lat:number,lng:number}, dest: {lat:number,lng:number}): Promise<{min:number,max:number}|undefined> {
  if (!GOOGLE_MAPS_API_KEY) return undefined;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', `${origin.lat},${origin.lng}`);
    url.searchParams.set('destinations', `${dest.lat},${dest.lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('departure_time', 'now');
    url.searchParams.set('traffic_model', 'best_guess');
    url.searchParams.set('units', 'metric');
    url.searchParams.set('language', 'de');
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
    const resp = await fetchWithTimeout(url.toString());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const el = data?.rows?.[0]?.elements?.[0];
    if (el?.status !== 'OK') throw new Error(`Element status ${el?.status}`);
    const seconds = Number(el?.duration_in_traffic?.value ?? el?.duration?.value);
    if (!Number.isFinite(seconds)) return undefined;
    const minutes = Math.max(1, Math.round(seconds / 60));
    const min = Math.max(1, Math.round(minutes * 0.8));
    const max = Math.max(min + 5, Math.round(minutes * 1.2));
    return { min, max };
  } catch (e) {
    dlog('Google travel-time failed', { error: (e as any)?.message });
    await sendDeveloperAlertEmailDebounced('ETA Fallback aktiviert (Google fehlgeschlagen)', `Grund: ${(e as any)?.message || 'unbekannt'}`);
    return undefined;
  }
}

async function orsTravelTimeMinutes(origin: {lat:number,lng:number}, dest: {lat:number,lng:number}): Promise<{min:number,max:number}|undefined> {
  if (!ORS_API_KEY) return undefined;
  try {
    const url = 'https://api.openrouteservice.org/v2/directions/driving-car';
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
      body: JSON.stringify({ coordinates: [[origin.lng, origin.lat], [dest.lng, dest.lat]] }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const seconds = Number(data?.routes?.[0]?.summary?.duration);
    if (!Number.isFinite(seconds)) return undefined;
    const minutes = Math.max(1, Math.round(seconds / 60));
    // ORS hat keine Live-Traffic-Werte → etwas breiteres Band
    const min = Math.max(1, Math.round(minutes * 0.8));
    const max = Math.max(min + 10, Math.round(minutes * 1.3));
    return { min, max };
  } catch (e) {
    dlog('ORS travel-time failed', { error: (e as any)?.message });
    await sendDeveloperAlertEmailDebounced('ETA Berechnung fehlgeschlagen (ORS)', `Grund: ${(e as any)?.message || 'unbekannt'}`);
    return undefined;
  }
}

async function getHybridTravelTimeMinutes(origin?: {lat?:number,lng?:number}, dest?: {lat?:number,lng?:number}): Promise<{min:number,max:number, source:'google'|'ors'|'haversine' }|undefined> {
  if (!origin || !dest || !Number.isFinite(Number(origin.lat)) || !Number.isFinite(Number(origin.lng)) || !Number.isFinite(Number(dest.lat)) || !Number.isFinite(Number(dest.lng))) return undefined;

  const key = `${Number(origin.lat).toFixed(4)},${Number(origin.lng).toFixed(4)}->${Number(dest.lat).toFixed(4)},${Number(dest.lng).toFixed(4)}`;
  const hit = getTTL(pairTravelCache, key, TTL_TRAVEL_PAIR_MS);
  if (hit) return { min: hit.min, max: hit.max, source: hit.source as any };

  // 1) Google mit Traffic
  const g = await googleTravelTimeMinutes({ lat: Number(origin.lat), lng: Number(origin.lng) }, { lat: Number(dest.lat), lng: Number(dest.lng) });
  if (g) { dlog('Travel-time source: google', g); setTTL(pairTravelCache, key, { min: g.min, max: g.max, source: 'google' }); return { ...g, source: 'google' }; }

  // 2) Fallback ORS
  const o = await orsTravelTimeMinutes({ lat: Number(origin.lat), lng: Number(origin.lng) }, { lat: Number(dest.lat), lng: Number(dest.lng) });
  if (o) { dlog('Travel-time source: ors', o); setTTL(pairTravelCache, key, { min: o.min, max: o.max, source: 'ors' }); return { ...o, source: 'ors' }; }

  // 3) Letzter Fallback: Haversine-basierte Heuristik (35–60 km/h)
  const dist = haversineKm({ lat: Number(origin.lat), lng: Number(origin.lng) }, { lat: Number(dest.lat), lng: Number(dest.lng) });
  if (typeof dist === 'number' && Number.isFinite(dist)) {
    const min = Math.max(3, Math.round(dist));
    const max = Math.max(min + 5, Math.round((dist * 60) / 35));
    dlog('Travel-time source: haversine', { min, max });
    setTTL(pairTravelCache, key, { min, max, source: 'haversine' });
    return { min, max, source: 'haversine' };
  }
  return undefined;
}

// --- Gesamt-Routen-Dauer: Google Directions (mit Traffic) → Fallback ORS ---
async function googleRouteDurationTotalMinutes(coords: Array<{lat:number,lng:number}>): Promise<number | undefined> {
  if (!GOOGLE_MAPS_API_KEY) { dlog('Google Directions disabled: missing GOOGLE_MAPS_API_KEY'); return undefined; }
  if (!coords.length || coords.length < 2) return 0;
  try {
    const origin = coords[0];
    const destination = coords[coords.length - 1];
    const waypoints = coords.slice(1, -1).map(c => `${c.lat},${c.lng}`).join('|');
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
    url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
    if (waypoints) url.searchParams.set('waypoints', `optimize=false|${waypoints}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('departure_time', 'now');
    url.searchParams.set('traffic_model', 'best_guess');
    url.searchParams.set('language', 'de');
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
    const resp = await fetchWithTimeout(url.toString());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const route = Array.isArray(data?.routes) ? data.routes[0] : undefined;
    const legs: any[] = Array.isArray(route?.legs) ? route.legs : [];
    let seconds = 0;
    for (const leg of legs) {
      const v = Number(leg?.duration_in_traffic?.value ?? leg?.duration?.value);
      if (Number.isFinite(v)) seconds += v; else return undefined;
    }
    const minutes = Math.max(0, Math.round(seconds / 60));
    dlog('Google total route minutes', { minutes, legs: legs.length });
    return minutes;
  } catch (e) {
    dlog('Google route total failed', { error: (e as any)?.message });
    await sendDeveloperAlertEmailDebounced('ETA Fallback aktiviert (Google Directions fehlgeschlagen)', `Grund: ${(e as any)?.message || 'unbekannt'}`);
    return undefined;
  }
}

async function orsRouteDurationTotalMinutes(coords: Array<{lat:number,lng:number}>): Promise<number | undefined> {
  if (!ORS_API_KEY) { dlog('ORS Directions disabled: missing ORS_API_KEY'); return undefined; }
  if (!coords.length || coords.length < 2) return 0;
  try {
    const url = 'https://api.openrouteservice.org/v2/directions/driving-car';
    const body = { coordinates: coords.map(c => [c.lng, c.lat]) };
    const resp = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const sec = Number(data?.routes?.[0]?.summary?.duration);
    if (!Number.isFinite(sec)) return undefined;
    const minutes = Math.max(0, Math.round(sec / 60));
    dlog('ORS total route minutes', { minutes });
    return minutes;
  } catch (e) {
    dlog('ORS route total failed', { error: (e as any)?.message });
    await sendDeveloperAlertEmailDebounced('ETA Berechnung fehlgeschlagen (ORS Directions)', `Grund: ${(e as any)?.message || 'unbekannt'}`);
    return undefined;
  }
}

async function totalRouteDurationMinutes(coords: Array<{lat?:number,lng?:number}>): Promise<{ minutes: number, source: 'google'|'ors'|'none' } | undefined> {
  const valid = coords.filter(c => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))) as Array<{lat:number,lng:number}>;
  if (valid.length < 2) return { minutes: 0, source: 'none' };
  const key = valid.map(c => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`).join('>');
  const cached = getTTL(totalRouteCache, key, TTL_ROUTE_TOTAL_MS);
  if (cached) { return { minutes: cached.minutes, source: cached.source }; }
  const g = await googleRouteDurationTotalMinutes(valid);
  if (typeof g === 'number') { setTTL(totalRouteCache, key, { minutes: g, source: 'google' }); return { minutes: g, source: 'google' }; }
  const o = await orsRouteDurationTotalMinutes(valid);
  if (typeof o === 'number') { setTTL(totalRouteCache, key, { minutes: o, source: 'ors' }); return { minutes: o, source: 'ors' }; }
  dlog('Total route duration failed (both providers)');
  return undefined;
}

// --- Segmentweiser Fallback: summiert Hybrid-Reisezeiten für Paare ---
async function sumPairwiseHybridDurationMinutes(coords: Array<{lat?:number,lng?:number}>): Promise<{ minutes: number, segments: number } | undefined> {
  // expects at least 2 valid points
  const valid = coords.filter(c => Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)));
  if (valid.length < 2) return undefined;

  const noProviders = !GOOGLE_MAPS_API_KEY && !ORS_API_KEY;

  let totalMin = 0;
  let segments = 0;
  for (let i = 0; i < valid.length - 1; i++) {
    const a = valid[i];
    const b = valid[i+1];

    // Wenn weder Google noch ORS vorhanden → strikt km/75 rechnen
    if (noProviders) {
      const dist = haversineKm(a as any, b as any);
      if (typeof dist === 'number' && Number.isFinite(dist)) {
        const mins = Math.max(1, Math.round((dist * 60) / 75)); // km/75h → Minuten
        totalMin += mins;
        segments++;
        dlog('Segment fallback km/75 (no providers)', { i, km: dist, min: mins });
        continue;
      }
      continue; // kein Distanzwert → Segment überspringen
    }

    // Mit Providern: Erst Hybrid versuchen
    const seg = await getHybridTravelTimeMinutes(a as any, b as any);
    if (seg) {
      totalMin += seg.min; // konservativ: min-Wert summieren (Fenster addieren wir später)
      segments++;
      dlog('Hybrid segment', { i, from: a, to: b, min: seg.min, max: seg.max, source: seg.source });
    } else {
      // Kein Hybrid-Ergebnis → km/75 als Fallback
      const dist = haversineKm(a as any, b as any);
      if (typeof dist === 'number' && Number.isFinite(dist)) {
        const mins = Math.max(1, Math.round((dist * 60) / 75));
        totalMin += mins;
        segments++;
        dlog('Hybrid segment km/75-fallback', { i, km: dist, min: mins });
      }
    }
  }

  return { minutes: Math.round(totalMin), segments };
}

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



async function getCoordsForKunde(kundeId: string, fallbackAddress?: string): Promise<{ lat?: number; lng?: number }> {
  dlog('Geocode start', { kundeId, hasFallbackAddress: !!fallbackAddress });
  // 1) Memory-Cache nach Adresse nutzen (wenn vorhanden)
  if (fallbackAddress) {
    const hit = geocodeCache.get(fallbackAddress.trim().toLowerCase());
    if (hit) {
      dlog('Geocode cache hit', { address: fallbackAddress });
      return hit;
    }
  }

  try {
    // 2) Kunde aus DB lesen und offensichtliche Felder prüfen
    const k: any = await (Kunde as any).findById(kundeId).lean();
    if (k) {
      const lat = Number(k?.lat ?? k?.latitude ?? k?.geo?.lat ?? k?.location?.coordinates?.[1]);
      const lng = Number(k?.lng ?? k?.longitude ?? k?.geo?.lng ?? k?.location?.coordinates?.[0]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        dlog('Geocode from DB', { kundeId, lat, lng });
        return { lat, lng };
      }
    }

    // 3) Wenn keine Koordinaten, optional aus Adresse geokodieren
    const address = (k?.adresse || fallbackAddress || '').toString().trim();
    if (!address) return {};

    dlog('Geocode via Nominatim', { address });
    // Nominatim-Geocoding (OSM). Bitte respektvoll nutzen; idealerweise Server-seitig mit Cache.
    const params = new URLSearchParams({
      format: 'json',
      q: address,
      limit: '1',
      addressdetails: '0',
    });
    const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
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
      dlog('Geocode from Nominatim', { kundeId, lat, lng });
      return { lat, lng };
    }
  } catch (e) { dlog('Geocode failed', { kundeId, error: (e as any)?.message }); }
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

// Best-effort: Samsara-Position des Fahrzeugs holen (falls Integration vorhanden)
async function fetchSamsaraVehicleCoordsByIdOrName(idOrName?: string): Promise<{ lat?: number; lng?: number } | undefined> {
  if (!idOrName) return undefined;
  try {
    // Lazy import, damit die Datei auch ohne Samsara-Integration läuft
    // @ts-ignore -- Optional integration; module may not exist in some deployments
    const mod: any = await import('../integrations/samsara');
    if (typeof mod?.getVehicleLocationByIdOrName === 'function') {
      const p = await mod.getVehicleLocationByIdOrName(idOrName);
      dlog('Samsara lookup', { idOrName, p });
      if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
        return { lat: Number(p.lat), lng: Number(p.lng) };
      }
    }
  } catch (e) {
    dlog('Samsara lookup failed', { idOrName, error: (e as any)?.message });
  }
  // HTTP-Fallback (ohne Integrationsmodul)
  try {
    if (SAMSARA_API_KEY) {
      const p = await samsaraGetVehicleLocationByIdOrNameHTTP(idOrName);
      dlog('Samsara HTTP lookup', { idOrName, p });
      if (p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
        return { lat: Number(p.lat), lng: Number(p.lng) };
      }
    }
  } catch (e) {
    dlog('Samsara HTTP lookup failed', { idOrName, error: (e as any)?.message });
  }
  return undefined;
}

// Entfernungsberechnung (Haversine) – Ergebnis in Kilometern
function haversineKm(a: {lat?: number; lng?: number} | undefined, b: {lat?: number; lng?: number} | undefined): number | undefined {
  if (!a || !b) return undefined;
  const lat1 = Number(a.lat), lon1 = Number(a.lng);
  const lat2 = Number(b.lat), lon2 = Number(b.lng);
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return undefined;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const aVal = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

function normKey(v?: string): string | undefined {
  if (!v) return undefined;
  return String(v).trim().toLowerCase().replace(/\s+/g, '');
}

async function resolveVehicleIdentityForTour(tour: any): Promise<{ fahrzeugName?: string; samsaraId?: string; idOrName?: string; kennzeichen?: string }> {
  // 1) Hole Fahrzeug aus Tour oder per FahrzeugId
  const vObj: any = tour?.fahrzeug || tour?.vehicle || undefined;
  let fahrzeugName: string | undefined = typeof vObj === 'string' ? vObj : (vObj?.name || vObj?.bezeichnung || vObj?.kennzeichen);
  let samsaraId: string | undefined = vObj?.samsaraVehicleId || vObj?.samsaraId || vObj?.samsaraID || vObj?.samsara_id;
  let kennzeichen: string | undefined = vObj?.kennzeichen;

  try {
    const fahrzeugId = vObj?._id || tour?.fahrzeugId || tour?.vehicleId;
    if (!kennzeichen && fahrzeugId) {
      const doc: any = await (Fahrzeug as any).findById(fahrzeugId).lean();
      if (doc) {
        kennzeichen = doc.kennzeichen || kennzeichen;
        fahrzeugName = fahrzeugName || doc.name || doc.bezeichnung;
        samsaraId = samsaraId || doc.samsaraVehicleId || doc.samsaraId || doc.samsaraID;
      }
    }
  } catch {}

  dlog('Vehicle base data', { fahrzeugName, samsaraId, kennzeichen, tourId: String(tour?._id || '') });

  // 2) Baue Kandidatenliste: bevorzugt Samsara-ID, dann Name, dann Kennzeichen (+ normalisierte Varianten)
  const candidates: string[] = [];
  const push = (x?: string) => { if (x && !candidates.includes(x)) candidates.push(x); };
  push(samsaraId);
  push(fahrzeugName);
  push(kennzeichen);
  // Normalisierte Varianten (ohne Leerzeichen, lowercase)
  const n1 = normKey(fahrzeugName);
  const n2 = normKey(kennzeichen);
  push(n1);
  push(n2);

  // 3) Versuche, über getVehicleLocationByIdOrName Koordinaten zu finden
  let idOrName: string | undefined;
  let coords: { lat?: number; lng?: number } | undefined;
  for (const cand of candidates) {
    if (!cand) continue;
    dlog('Try vehicle candidate', { cand });
    try {
      coords = await fetchSamsaraVehicleCoordsByIdOrName(cand);
      if (coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lng))) {
        dlog('Vehicle match', { chosen: cand, coords });
        idOrName = cand;
        break;
      }
    } catch {}
  }

  return { fahrzeugName, samsaraId, idOrName, kennzeichen };
}

// Fallback: Hole alle Samsara-Fahrzeuge (falls API vorhanden) und finde Koordinaten per Kennzeichen/Name (normalisiert)
async function fetchVehicleCoordsViaListing(preferred: { kennzeichen?: string; fahrzeugName?: string }): Promise<{ lat?: number; lng?: number } | undefined> {
  try {
    // @ts-ignore -- Optional integration; module may not exist in some deployments
    const mod: any = await import('../integrations/samsara');
    if (typeof mod?.listVehicles === 'function') {
      const list = await mod.listVehicles();
      dlog('Samsara listVehicles size', Array.isArray(list) ? list.length : 'n/a');
      const wantPlate = normKey(preferred.kennzeichen);
      const wantName  = normKey(preferred.fahrzeugName);
      if (!Array.isArray(list) || (!wantPlate && !wantName)) return undefined;
      const candidates = list.map((v: any) => ({
        raw: v,
        id: v?.id || v?.vehicleId || v?._id,
        name: v?.name || v?.label || v?.displayName,
        plate: v?.licensePlate || v?.license_plate || v?.plate || v?.kennzeichen,
      }));
      const norm = (x?: string) => (x ? x.toString().trim().toLowerCase().replace(/\s+|[-_]/g, '') : undefined);
      let hit: any | undefined;
      for (const c of candidates) {
        const nName  = norm(c.name);
        const nPlate = norm(c.plate);
        if ((wantPlate && nName === wantPlate) || (wantPlate && nPlate === wantPlate) || (wantName && nName === wantName)) { hit = c; break; }
      }
      if (!hit) { dlog('Samsara listVehicles: no match by name/plate', { wantPlate, wantName }); return undefined; }
      const idOrName = hit.id || hit.name || hit.plate;
      dlog('Samsara listVehicles matched', { idOrName, name: hit.name, plate: hit.plate });
      return await fetchSamsaraVehicleCoordsByIdOrName(idOrName);
    }
  } catch (e) {
    dlog('Samsara listVehicles failed', { error: (e as any)?.message });
  }
  // HTTP-Fallback
  try {
    const list = await samsaraListVehiclesHTTP();
    const wantPlate = normKey(preferred.kennzeichen);
    const wantName  = normKey(preferred.fahrzeugName);
    if (!Array.isArray(list) || (!wantPlate && !wantName)) return undefined;
    const candidates = list.map((v: any) => ({
      raw: v,
      id: v?.id || v?.vehicleId || v?._id,
      name: v?.name || v?.label || v?.displayName,
      plate: v?.licensePlate || v?.license_plate || v?.plate || v?.kennzeichen,
    }));
    const norm = (x?: string) => (x ? x.toString().trim().toLowerCase().replace(/\s+|[-_]/g, '') : undefined);
    let hit: any | undefined;
    for (const c of candidates) {
      const nName  = norm(c.name);
      const nPlate = norm(c.plate);
      if ((wantPlate && nName === wantPlate) || (wantPlate && nPlate === wantPlate) || (wantName && nName === wantName)) { hit = c; break; }
    }
    if (!hit) { dlog('Samsara HTTP listVehicles: no match by name/plate', { wantPlate, wantName }); return undefined; }
    const idOrName = hit.id || hit.name || hit.plate;
    dlog('Samsara HTTP listVehicles matched', { idOrName, name: hit.name, plate: hit.plate });
    return await samsaraGetVehicleLocationByIdOrNameHTTP(idOrName);
  } catch (e) {
    dlog('Samsara HTTP listVehicles failed', { error: (e as any)?.message });
    return undefined;
  }
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

/**
 * Liefert alle heutigen TourStops für einen Kunden und eine grobe ETA-Spanne (15–30 Min pro vorherigem Stop).
 * ETA wird als [etaFromUtc, etaToUtc] (ISO-String) zurückgegeben. Zusätzlich (best-effort) die aktuelle Fahrzeugposition via Samsara.
 */
export async function getTourStopByKundeIdHeute(kundeId: string): Promise<Array<{
  tourId: string;
  stopId: string;
  position: number;
  status?: string;
  etaFromUtc: string; // earliest ETA (UTC)
  etaToUtc: string;   // latest ETA (UTC)
  distanceKm?: number; // Luftlinie Fahrzeug -> Stop
  fahrzeug?: { name?: string; samsaraId?: string; coords?: { lat?: number; lng?: number } };
}>> {
  const dateYmd = todayYmdBerlin();
  dlog('getTourStopByKundeIdHeute', { kundeId, dateYmd });
  const { from, to } = berlinDayRange(dateYmd);

  // 1) Alle TourStops des Kunden am heutigen Tag ermitteln
  //    Dazu erst die Touren des Tages lesen, dann Stops je Tour für den Kunden filtern
  const toursToday: Array<any> = await (Tour as any).find({ datum: { $gte: from, $lte: to } }).lean();
  if (!toursToday?.length) return [];

  const tourIds = toursToday.map(t => String(t._id));
  const customerStops: Array<any> = await TourStop.find({ tourId: { $in: tourIds }, kundeId }).sort({ position: 1 }).lean();
  if (!customerStops.length) return [];

  // 2) Für jede betroffene Tour die gesamte Reihenfolge laden, um die Anzahl der vorherigen Stops zu bestimmen
  //    (alternativ: position-1; wir nutzen die echte Liste, falls Positionen Lücken haben)
  const stopsByTour: Record<string, Array<any>> = {};
  for (const tid of new Set(customerStops.map(s => String(s.tourId)))) {
    stopsByTour[tid] = await TourStop.find({ tourId: tid }).sort({ position: 1 }).lean();
  }

  // 3) Ergebnis zusammenbauen inkl. ETA-Range & Fahrzeuginfo (best-effort)
  const now = new Date();
  const results: Array<{ tourId: string; stopId: string; position: number; status?: string; etaFromUtc: string; etaToUtc: string; distanceKm?: number; fahrzeug?: { name?: string; samsaraId?: string; coords?: { lat?: number; lng?: number } } }> = [];

  for (const s of customerStops) {
    const tid = String(s.tourId);
    const all = stopsByTour[tid] || [];
    const idx = all.findIndex(x => String(x._id) === String(s._id));
    // --- NEU: Gesamt-Routen-ETA mit Ausschluss erledigter Stops ---
    const completed = new Set(['zugestellt','fertig','abgeschlossen']);
    // Falls Ziel-Stop selbst bereits erledigt ist → nicht berechnen / überspringen
    if (completed.has(String(s.status))) {
      dlog('Skip completed target stop', { stopId: String(s._id), status: s.status });
      continue;
    }

    // Fahrzeug aus Tour & aktuelle Position (Samsara, best-effort)
    const tour = toursToday.find(t => String(t._id) === tid) || {};
    const resolved = await resolveVehicleIdentityForTour(tour);
    const fahrzeugName = resolved.fahrzeugName;
    const samsaraId = resolved.samsaraId;

    let vehicleCoords: { lat?: number; lng?: number } | undefined;
    try {
      vehicleCoords = await fetchSamsaraVehicleCoordsByIdOrName(resolved.idOrName || resolved.kennzeichen || fahrzeugName);
      if (!vehicleCoords) {
        dlog('Vehicle coords primary lookup failed, trying listVehicles fallback');
        vehicleCoords = await fetchVehicleCoordsViaListing({ kennzeichen: resolved.kennzeichen, fahrzeugName });
      }
    } catch {
      dlog('Vehicle coords lookup threw, trying listVehicles fallback');
      vehicleCoords = await fetchVehicleCoordsViaListing({ kennzeichen: resolved.kennzeichen, fahrzeugName });
    }

    // Stop-Koordinaten (aus DB/Adresse, best-effort)
    const allStopsInTour = all; // bereits geladen
    const intermediates = allStopsInTour.slice(0, idx).filter(x => !completed.has(String(x.status)));

    // Koordinaten für Origin und alle Wegpunkte bis Ziel sammeln
    const waypoints: Array<{lat?:number,lng?:number}> = [];
    if (vehicleCoords && Number.isFinite(Number(vehicleCoords.lat)) && Number.isFinite(Number(vehicleCoords.lng))) {
      waypoints.push({ lat: Number(vehicleCoords.lat), lng: Number(vehicleCoords.lng) });
    }
    // Intermediates coords
    const interCoords = await Promise.all(intermediates.map(w => getCoordsForKunde(String(w.kundeId), (w as any)?.kundeAdress)));
    for (const c of interCoords) {
      waypoints.push({ lat: Number(c.lat), lng: Number(c.lng) });
    }
    // Ziel-Stop coords
    const targetCoords = await getCoordsForKunde(String(s.kundeId), (s as any)?.kundeAdress);
    waypoints.push({ lat: Number(targetCoords.lat), lng: Number(targetCoords.lng) });

    dlog('Route waypoints count', { count: waypoints.length, intermediates: intermediates.length });

    // Gesamt-Routen-Dauer ermitteln
    const totalRoute = await totalRouteDurationMinutes(waypoints);
    let baseMin = 0;
    let source: 'google'|'ors'|'none' = 'none';
    if (totalRoute && typeof totalRoute.minutes === 'number') {
      baseMin = totalRoute.minutes;
      source = totalRoute.source;
    } else {
      // Segmentweiser Fallback (Hybrid): summiere A->B, B->C, ...
      const seg = await sumPairwiseHybridDurationMinutes(waypoints);
      if (seg && seg.segments > 0) {
        baseMin = seg.minutes;
        source = 'none';
        dlog('Total route via segment fallback', { baseMin, segments: seg.segments });
      } else {
        baseMin = 0;
        dlog('Total route unresolved: no segments available');
      }
    }

    // Fixe Servicezeit (20 Min) pro Zwischen-Stop (Ziel-Stop keine Servicezeit)
    const serviceMin = intermediates.length * 20;
    baseMin += serviceMin;

    // ETA-Fenster: Puffer = min(60, max(20, round(0.15 * baseMin)))
    const puffer = Math.min(60, Math.max(20, Math.round(baseMin * 0.15)));

    const etaFrom = new Date(now.getTime() + baseMin * 60 * 1000);
    const etaTo   = new Date(now.getTime() + (baseMin + puffer) * 60 * 1000);

    // Distanz (Luftlinie) nur informativ Fahrzeug→Ziel
    const distKm = haversineKm(vehicleCoords, targetCoords);

    dlog('ETA calc (total route)', {
      tourId: tid,
      stopId: String(s._id),
      idx,
      intermediates: intermediates.length,
      baseRouteMin: totalRoute?.minutes ?? 0,
      serviceMin,
      puffer,
      source,
      etaFrom: etaFrom.toISOString(),
      etaTo: etaTo.toISOString(),
    });

    results.push({
      tourId: tid,
      stopId: String(s._id),
      position: Number(s.position) || (idx + 1) || 1,
      status: s.status,
      etaFromUtc: etaFrom.toISOString(),
      etaToUtc: etaTo.toISOString(),
      distanceKm: typeof distKm === 'number' ? Number(distKm.toFixed(1)) : undefined,
      fahrzeug: (fahrzeugName || samsaraId || vehicleCoords) ? { name: fahrzeugName, samsaraId, coords: vehicleCoords } : undefined,
    });
  }

  return results;
}