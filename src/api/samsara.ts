import express, { Router, type Request, type Response } from 'express';
import 'dotenv/config';

// Use the global fetch if available (Node 18+), otherwise require node-fetch at runtime
let fetchFn: typeof globalThis.fetch;
try {
  if (typeof fetch === 'function') {
    fetchFn = fetch;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    fetchFn = require('node-fetch') as unknown as typeof globalThis.fetch;
  }
} catch {
  throw new Error('Neither global fetch nor node-fetch is available. Please install node-fetch or upgrade Node.');
}

const SAMSARA_BASE = 'https://api.samsara.com';
const API_KEY = process.env.SAMSARA_API_KEY;
const RAW_API_KEY = (API_KEY || '').trim();
const AUTH_HEADER = RAW_API_KEY.toLowerCase().startsWith('bearer ')
  ? RAW_API_KEY
  : `Bearer ${RAW_API_KEY}`;
const authHeaders = () => ({ Authorization: AUTH_HEADER, Accept: 'application/json' });

if (!API_KEY) {
  // Log once on startup so the developer sees the missing key early
  console.warn('[SamsaraProxy] Warnung: SAMSARA_API_KEY ist nicht gesetzt. Requests werden fehlschlagen.');
}

const router: Router = express.Router();

// Optional: tighten CORS here if dein Server kein globales CORS nutzt
// router.use((req, res, next) => {
//   res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
//   res.header('Vary', 'Origin');
//   res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//   if (req.method === 'OPTIONS') return res.sendStatus(200);
//   next();
// });

/** Helper: forward request to Samsara with same query params */
async function forward(res: Response, samsaraUrl: string) {
  try {
    const r = await fetchFn(samsaraUrl, {
      headers: authHeaders(),
    });

    if (r.status === 401 || r.status === 403) {
      const fp = RAW_API_KEY ? RAW_API_KEY.slice(0, 6) + '…' : 'EMPTY';
      console.warn(`[SamsaraProxy] Auth failure ${r.status} for ${samsaraUrl} (token fp: ${fp})`);
    }

    const text = await r.text();
    res.status(r.status);

    // Forward JSON when possible, else raw text
    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch {
      return res.send(text);
    }
  } catch (err: any) {
    console.error('[SamsaraProxy] Fehler', err);
    return res.status(502).json({ error: 'Bad Gateway', detail: err?.message || String(err) });
  }
}

/**
 * GET /api/samsara/vehicles/stats
 * Proxies: GET /fleet/vehicles/stats
 * Query supports: types, decorations, vehicleIds, after, limit, etc.
 */
router.get('/samsara/vehicles/stats', async (req: Request, res: Response) => {
  const url = new URL(`${SAMSARA_BASE}/fleet/vehicles/stats`);
  Object.entries(req.query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  await forward(res, url.toString());
});

/**
 * GET /api/samsara/vehicles/locations/history
 * Proxies: GET /fleet/vehicles/locations/history
 * Query supports: startTime, endTime, vehicleIds, limit, etc.
 */
router.get('/samsara/vehicles/locations/history', async (req: Request, res: Response) => {
  const url = new URL(`${SAMSARA_BASE}/fleet/vehicles/locations/history`);
  Object.entries(req.query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  await forward(res, url.toString());
});

/**
 * GET /api/samsara/routes
 * Proxies: GET /fleet/routes
 * Query supports: vehicleIds, states, limit, after, etc.
 */
router.get('/samsara/routes', async (req: Request, res: Response) => {
  const url = new URL(`${SAMSARA_BASE}/fleet/routes`);
  Object.entries(req.query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  await forward(res, url.toString());
});

/** GET /api/samsara/ping – calls a lightweight endpoint to validate the token */
router.get('/samsara/ping', async (_req: Request, res: Response) => {
  try {
    const r = await fetchFn(`${SAMSARA_BASE}/users/me`, { headers: authHeaders() });
    const text = await r.text();
    res.status(r.status);
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (err: any) {
    res.status(502).json({ error: 'Bad Gateway', detail: err?.message || String(err) });
  }
});

/**
 * Generic GET proxy for any Samsara endpoint
 * Example: GET /api/samsara/fleet/vehicles?limit=50 → https://api.samsara.com/fleet/vehicles?limit=50
 */
router.get('/samsara/*', async (req: Request, res: Response) => {
  // Path after /samsara/
  const path = (req.params[0] || '').replace(/^\/+/, '');
  const url = new URL(`${SAMSARA_BASE}/${path}`);
  Object.entries(req.query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  await forward(res, url.toString());
});

// backend/src/integrations/samsara.ts
type Coords = { lat?: number; lng?: number };

const TOKEN = process.env.SAMSARA_API_Key || "";
// EU-Tenants nutzen meist api.eu.samsara.com
const API_BASE = process.env.SAMSARA_API_BASE || "https://api.samsara.com";

if (!TOKEN) {
  // nicht werfen, damit dein Server auch ohne Token läuft – Aufrufer checkt undefined
  // console.warn("SAMSARA_API_Key fehlt – Samsara-Integration liefert keine Live-Koordinaten.");
}

async function httpGet(path: string, query: Record<string, any> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
  const url = `${API_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path} – ${txt}`);
  }
  return res.json();
}

/**
 * Listet alle Fahrzeuge. Nutzt die neueren Assets-Endpoints.
 * Doku: /assets?type=vehicle  (Beta-Hinweis möglich)
 */
export async function listVehicles(): Promise<Array<any>> {
  if (!TOKEN) return [];
  const out: any[] = [];
  let after: string | undefined;
  do {
    const page = await httpGet("/assets", { type: "vehicle", after, limit: 200 });
    const data = Array.isArray(page?.data) ? page.data : [];
    out.push(...data);
    after = page?.pagination?.hasNextPage ? page?.pagination?.endCursor : undefined;
  } while (after);
  return out;
}

/**
 * Gibt die letzte bekannte Position (GPS) für ein Fahrzeug zurück.
 * idOrName darf ID, Name oder Kennzeichen sein.
 * Strategie:
 *  1) Liste Fahrzeuge → suche exakten Match über ID oder normalisierte name/licensePlate
 *  2) Hole Snapshot stats (types=gps) und filtere auf das Fahrzeug per IDs (wenn möglich) oder per Name
 *
 * Doku:
 *  - Snapshot: GET /fleet/vehicles/stats?types=gps (liefert letzte Werte)  [oai_citation:1‡Developers | Samsara](https://developers.samsara.com/docs/vehicle-stats-snapshot?utm_source=chatgpt.com)
 *  - Vehicles: GET /assets?type=vehicle (Fahrzeugliste)  [oai_citation:2‡Developers | Samsara](https://developers.samsara.com/docs/assets-vehicles-trailers-equipment?utm_source=chatgpt.com)
 */
export async function getVehicleLocationByIdOrName(idOrName: string): Promise<Coords | undefined> {
  if (!TOKEN || !idOrName) return undefined;

  const norm = (x?: string) => x?.toString().trim().toLowerCase().replace(/\s+|[-_]/g, "");

  // 1) Kandidat aus der Fahrzeugliste bestimmen
  const list = await listVehicles();
  const want = norm(idOrName);
  const hit = list.find((v: any) => {
    const id = norm(v?.id || v?.vehicleId || v?._id);
    const name = norm(v?.name || v?.label || v?.displayName);
    const plate = norm(v?.licensePlate || v?.license_plate || v?.plate || v?.kennzeichen);
    return want && (want === id || want === plate || want === name);
  });

  // Wenn wir eine ID kennen, ist das ideal – Snapshot kann (je nach Version) per Filter beschränkt werden.
  // Manche Deployments erlauben ids=… (oder tag-Filter). Fallback: alles holen und lokal filtern.
  const targetId = hit?.id;

  // 2) Snapshot holen
  let data: any;
  try {
    // Erster Versuch: mit ids-Filter (falls vom Tenant unterstützt)
    const queryWithIds = targetId ? { types: "gps", ids: targetId } : { types: "gps" };
    data = await httpGet("/fleet/vehicles/stats", queryWithIds);
  } catch {
    // Fallback: ohne ids → alle Fahrzeuge, wir filtern lokal
    data = await httpGet("/fleet/vehicles/stats", { types: "gps" });
  }

  const rows: any[] = Array.isArray(data?.data) ? data.data : [];
  // Wenn wir keinen direkten Treffer in list hatten, matchen wir über name/plate
  const pick = (rows.find((r: any) => targetId && (r?.id === targetId))
    || rows.find((r: any) => norm(r?.name) === want)
  );

  // gps kann entweder als Array (history/feed) oder als Objekt (snapshot) kommen; wir unterstützen beides
  const gps = Array.isArray(pick?.gps) ? pick?.gps.at(-1) : pick?.gps;
  const lat = Number(gps?.latitude ?? gps?.lat);
  const lng = Number(gps?.longitude ?? gps?.lng ?? gps?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return undefined;
}

export default router;