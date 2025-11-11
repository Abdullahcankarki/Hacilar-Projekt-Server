import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import {
  createArtikel,
  getArtikelById,
  getAllArtikel,
  updateArtikel,
  deleteArtikel,
  getArtikelByNames,
  getAllArtikelClean,
  getArtikelByIdClean,
  getArtikelAnalytics,
} from '../services/ArtikelService'; // Passe den Pfad ggf. an
import { LoginResource } from '../Resources'; // Passe den Pfad ggf. an

const artikelRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Typdefinition für authentifizierte Requests
interface AuthRequest extends Request {
  user?: LoginResource;
}

// Middleware: Authentifizierung mittels JWT
const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Kein Token vorhanden' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as LoginResource;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Ungültiges Token' });
  }
};

// Middleware: Prüft, ob der User Admin ist (Admin-Zugriff wird hier vorausgesetzt)
const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !req.user.role.includes('admin')) {
    return res.status(403).json({ error: 'Admin-Zugriff erforderlich' });
  }
  next();
};

// Middleware: Validierungsergebnisse prüfen
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Helpers: Query-Parsing
const parseBool = (v: any): boolean | undefined => {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return undefined;
};

const parseList = (v: any): string | string[] | undefined => {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    return trimmed.includes(',') ? trimmed.split(',').map(s => s.trim()).filter(Boolean) : trimmed;
  }
  return undefined;
};

/* -------------------------------
   Routen für Artikel
---------------------------------*/


/**
 * POST /artikel
 * Erstellt einen neuen Artikel.
 * Nur Admins dürfen diesen Endpunkt nutzen.
 */
artikelRouter.post(
  '/',
  authenticate,
  isAdmin,
  [
    body('preis')
      .isNumeric()
      .withMessage('Preis muss eine Zahl sein'),
    body('artikelNummer')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Artikelnummer ist erforderlich'),
    body('name')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Artikelnummer ist erforderlich'),
    body('gewichtProStueck')
      .optional()
      .isNumeric()
      .withMessage('Gewicht pro Stück muss eine Zahl sein'),
    body('gewichtProKarton')
      .optional()
      .isNumeric()
      .withMessage('Gewicht pro Karton muss eine Zahl sein'),
    body('gewichtProKiste')
      .optional()
      .isNumeric()
      .withMessage('Gewicht pro Kiste muss eine Zahl sein'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createArtikel(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);


/**
 * GET /artikel/auswahl
 * Gibt eine vordefinierte Liste an Artikeln zurück.
 */
artikelRouter.get(
  '/auswahl',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const isAdminUser = req.user?.role.includes('admin');
      const kundeId = isAdminUser ? req.query.kunde?.toString() ?? req.user?.id : req.user?.id;

      const namen = [
        "Hä.Brustfilet mit lange Haut",
        "Hä.Brustfilet ohne Haut",
        "Hä.Flügel Landgeflügel",
        "Hä.Herz",
        "Hä.Innenfilet",
        "Hä.Keule m.Kn. Landgeflügel",
        "Hähnchen Keule o.Kn. o.Haut",
        "Hä.Leber",
        "Hä.Magen",
        "Hä.Unterkeule m.Kn.",
        "Hähnchen Brustfilet mit Haut",
        "Hähnchen ganz 1000gr. Landgeflügel",
        "Hähnchen ganz 1200gr. Landgeflügel",
        "Hähnchen ganz 1400gr. Bouwens",
        "Kalb ganz m.Kn",
        "Kalb Brust m.Kn. (V) I",
        "Kalb Brust m.Kn. (V) II Rose",
        "Kalb Brust o.Kn. (V) I Hell",
        "Kalb Brust o.Kn. (V) II Rose",
        "Kalb Fett",
        "Kalb Keule m.Kn. Hell (V)",
        "Kalb Kamm m.Kn. (V) Hell",
        "Kalb Kamm o.Kn. (V) Hell",
        "Kalb Bug m.Kn. (V) Hell",
        "Kalb Bug o.Kn. (V) Hell",
        "Kalb Kugel Rose NL",
        "Kalb Kugel (V) Hell DE",
        "Lamm ganz",
        "Lamm Schulter & Lamm Hals m.Kn.",
        "Lamm Keule m.Kn.",
        "Lamm Vorderviertel",
        "Lamm Netzfett",
        "Lamm Schwanzfett",
        "Lamm Füße",
        "Lamm Leber",
        "Lamm Köpfe",
        "Lamm Köpfe gebrannt",
        "Lamm Mumbar",
        "Pu.Flügel o.Kn.",
        "Pu.Oberkeule m.Kn. (männlich)",
        "Pu.Oberkeule o.Kn. (männlich)",
        "Pu.Oberkeule m.Kn. (weiblich)",
        "Pu.Oberkeule o.Kn. (weiblich)",
        "Pu.Medaillon gefr.",
        "Pu.Oberkeule o.Kn. o.Haut",
        "Bulle ganz m.Kn.",
        "B.Lappen m.Kn.",
        "B.Brust o.Kn.",
        "B.Vorderviertel o.Kn. Bahlmann",
        "B.Keule m.Kn.",
        "B.Kamm o.Kn.",
        "B.Bug m.Kn.",
        "B.Bug o.Kn.",
        "B.Kugel",
        "B.Oberschale",
        "B.Unterschale PAD",
        "B.Entrecote",
        "B.Beinfleisch",
        "B.Abschnitte (90/10)",
        "Mergez (Rinder Wurst)",
        "B.Roastbeef m.Kn.",
        "Rinder Pansen",
        "Bullen Bacon",
        "B.Fett"
      ];

      const result = await getArtikelByNames(namen, kundeId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /artikel
 * Ruft alle Artikel ab.
 * Optional: Admins können `?kunde=...` übergeben.
 * Query-Parameter: page, limit, kategorie (string|string[]|comma), ausverkauft (boolean), name (string), erfassungsModus (string|string[]|comma)
 */
artikelRouter.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isAdminUser = req.user?.role.includes('admin');
    const kundeId = isAdminUser ? req.query.kunde?.toString() ?? req.user?.id : req.user?.id;

    const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const kategorie = parseList(req.query.kategorie);
    const ausverkauft = parseBool(req.query.ausverkauft);
    const name = typeof req.query.name === 'string' ? req.query.name : undefined;
    const erfassungsModus = parseList(req.query.erfassungsModus);

    const result = await getAllArtikel(kundeId, {
      page,
      limit,
      kategorie: kategorie as any,
      ausverkauft,
      name,
      erfassungsModus: erfassungsModus as any,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /artikel/clean
 * Ruft alle Artikel ab.
 * Query-Parameter: page, limit, kategorie (string|string[]|comma), ausverkauft (boolean), name (string), erfassungsModus (string|string[]|comma)
 */
artikelRouter.get('/clean', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = req.query.page ? parseInt(String(req.query.page), 10) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const kategorie = parseList(req.query.kategorie);
    const ausverkauft = parseBool(req.query.ausverkauft);
    const name = typeof req.query.name === 'string' ? req.query.name : undefined;
    const erfassungsModus = parseList(req.query.erfassungsModus);

    const result = await getAllArtikelClean({
      page,
      limit,
      kategorie: kategorie as any,
      ausverkauft,
      name,
      erfassungsModus: erfassungsModus as any,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /artikel/clean/:id
 * Ruft einen einzelnen Artikel anhand der ID ab.
 */
artikelRouter.get(
  '/clean/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige Artikel-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getArtikelByIdClean(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
);

/**
 * GET /artikel/:id/analytics
 * Gibt detaillierte Analysen zu einem Artikel in einem definierten Zeitraum zurück.
 * Query-Parameter:
 *   from (ISO-String, erforderlich)
 *   to (ISO-String, erforderlich)
 *   granularity ('day'|'week'|'month', optional)
 *   topCustomersLimit (Zahl, optional)
 *   recentOrdersLimit (Zahl, optional)
 */
artikelRouter.get(
  '/:id/analytics',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige Artikel-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { from, to, granularity, topCustomersLimit, recentOrdersLimit } = req.query;
      if (!from || !to) {
        return res.status(400).json({ error: 'Parameter "from" und "to" sind erforderlich' });
      }
      const result = await getArtikelAnalytics(req.params.id, {
        from: String(from),
        to: String(to),
        granularity: granularity ? String(granularity) as 'day' | 'week' | 'month' : undefined,
        topCustomersLimit: topCustomersLimit ? parseInt(String(topCustomersLimit), 10) : undefined,
        recentOrdersLimit: recentOrdersLimit ? parseInt(String(recentOrdersLimit), 10) : undefined,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /artikel/:id
 * Ruft einen einzelnen Artikel anhand der ID ab.
 * Optional: Admins können `?kunde=...` übergeben.
 */
artikelRouter.get(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige Artikel-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const isAdminUser = req.user?.role.includes('admin');
      const kundeId = isAdminUser ? req.query.kunde?.toString() ?? req.user?.id : req.user?.id;
      const result = await getArtikelById(req.params.id, kundeId);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
);

/**
 * PUT /artikel/:id
 * Aktualisiert einen Artikel.
 * Nur Admins dürfen diesen Endpunkt nutzen.
 */
artikelRouter.put(
  '/:id',
  authenticate,
  isAdmin,
  [
    param('id').isMongoId().withMessage('Ungültige Artikel-ID'),
    body('preis')
      .optional()
      .isNumeric()
      .withMessage('Preis muss eine Zahl sein'),
    body('artikelNummer')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Artikelnummer muss ein gültiger String sein'),
    body('name')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Name muss ein gültiger String sein'),
    body('gewichtProStueck')
      .optional()
      .isNumeric()
      .withMessage('Gewicht pro Stück muss eine Zahl sein'),
    body('gewichtProKarton')
      .optional()
      .isNumeric()
      .withMessage('Gewicht pro Karton muss eine Zahl sein'),
    body('gewichtProKiste')
      .optional()
      .isNumeric()
      .withMessage('Gewicht pro Kiste muss eine Zahl sein'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateArtikel(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /artikel/:id
 * Löscht einen Artikel.
 * Nur Admins dürfen diesen Endpunkt nutzen.
 */
artikelRouter.delete(
  '/:id',
  authenticate,
  isAdmin,
  [param('id').isMongoId().withMessage('Ungültige Artikel-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteArtikel(req.params.id);
      res.json({ message: 'Artikel gelöscht' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default artikelRouter;