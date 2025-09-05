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

export default router;