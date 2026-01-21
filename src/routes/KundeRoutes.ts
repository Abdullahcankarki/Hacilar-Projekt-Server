import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import {
  createKunde,
  getAllKunden,
  getKundeById,
  updateKunde,
  deleteKunde,
  loginKunde,
  logoutKunde,
  getKundenFavoriten,
  addKundenFavorit,
  removeKundenFavorit,
  getUnapprovedKunden,
  normalizeKundenEmails,
  approveKunde,
  getKundeAnalytics,
  setBestimmteArtikel,
} from '../services/KundeService'; // Passe den Pfad ggf. an
import { LoginResource } from '../Resources'; // Passe den Pfad ggf. an

const kundeRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Typdefinition für authentifizierte Requests
interface AuthRequest extends Request {
  user?: LoginResource;
}

// Middleware: Authentifizierung anhand des JWT-Tokens
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

// Middleware: Prüft die Validierungsergebnisse
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/* -------------------------------
   Routen für Kunden (Kunde)
---------------------------------*/

// POST /kunden/register
// Registriert einen neuen Kunden (self registration)
kundeRouter.post(
  '/register',
  [
    body('name').isString().trim().notEmpty().withMessage('Name ist erforderlich'),
    body('kundenNummer').optional().isString().trim().withMessage('Kundennummer ist erforderlich'),
    body('password').isString().trim().notEmpty().withMessage('Passwort ist erforderlich'),
    body('email').isEmail().withMessage('Ungültige Email'),
    body('adresse').isString().trim().notEmpty().withMessage('Adresse ist erforderlich'),
    body('telefon').optional().isString().trim(),
    body('lieferzeit').optional().isString().trim().withMessage('lieferzeit ist erforderlich'),
    body('ustId').optional().isString().trim(),
    body('ansprechpartner').optional().isString().trim(),
    body('region').optional().isString().trim().withMessage('Region ist erforderlich'),
    body('kategorie').optional().isString().trim().withMessage('Kategorie ist erforderlich'),
    body('handelsregisterNr').optional().isString().trim(),
    body('website').optional().isString().trim(),
    body('branchenInfo').optional().isString().trim(),
    body('gewerbeDateiUrl').optional().isString().trim(),
    body('zusatzDateiUrl').optional().isString().trim(),
    body('emailRechnung').optional().isEmail().withMessage('Ungültige E-Mail für Rechnungen'),
    body('emailLieferschein').optional().isEmail().withMessage('Ungültige E-Mail für Lieferscheine'),
    body('emailBuchhaltung').optional().isEmail().withMessage('Ungültige E-Mail für Buchhaltung'),
    body('emailSpedition').optional().isEmail().withMessage('Ungültige E-Mail für Spedition'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const result = await createKunde(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /kunden/login
// Authentifiziert einen Kunden und gibt ein JWT zurück
kundeRouter.post(
  '/login',
  [
    body('email').isEmail().withMessage('Ungültige Email'),
    body('password').isString().trim().notEmpty().withMessage('Passwort ist erforderlich'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const result = await loginKunde(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
);

kundeRouter.get(
  '/',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;

      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const region = req.query.region ? String(req.query.region) : undefined;
      const kategorie = req.query.kategorie ? String(req.query.kategorie) : undefined;
      let isApproved: boolean | undefined = undefined;
      if (typeof req.query.isApproved === 'string') {
        const v = req.query.isApproved.toLowerCase();
        isApproved = v === 'true' || v === '1' || v === 'yes';
      } else if (Array.isArray(req.query.isApproved)) {
        const first = String(req.query.isApproved[0] ?? '').toLowerCase();
        isApproved = first === 'true' || first === '1' || first === 'yes';
      }
      const sortBy = req.query.sortBy ? String(req.query.sortBy) : undefined;

      const params = {
        page,
        limit,
        search,
        region,
        kategorie,
        isApproved,
        sortBy,
      };

      const result = await getAllKunden(params, currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);


/**
 * GET /api/kunden/:id/analytics
 * Query:
 *  - from, to (ISO)
 *  - granularity: 'day' | 'week' | 'month'
 *  - topArticlesLimit, recentOrdersLimit, priceHistogramBuckets (Zahlen)
 */
kundeRouter.get('/:id/analytics', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      from,
      to,
      granularity,
      topArticlesLimit,
      recentOrdersLimit,
      priceHistogramBuckets,
    } = req.query as Record<string, string | undefined>;

    const data = await getKundeAnalytics(id, {
      from,
      to,
      granularity: (granularity as any) ?? 'week',
      topArticlesLimit: topArticlesLimit ? Number(topArticlesLimit) : undefined,
      recentOrdersLimit: recentOrdersLimit ? Number(recentOrdersLimit) : undefined,
      priceHistogramBuckets: priceHistogramBuckets ? Number(priceHistogramBuckets) : undefined,
    });

    res.json(data);
  } catch (err: any) {
    console.error('[KundeAnalytics] error', err);
    res.status(400).json({ error: err?.message ?? 'Unbekannter Fehler' });
  }
});

// GET /kunden
// Ruft alle Kunden ab – nur Admins (role === "a")
kundeRouter.get(
  '/unapproved',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await getUnapprovedKunden(currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /kunden/:id
// Ruft einen einzelnen Kunden ab – Admin oder der Kunde selbst
kundeRouter.get(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await getKundeById(req.params.id, currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PATCH /kunden/:id/approve
// Admin: Kunde freischalten/sperren
kundeRouter.patch(
  '/:id/approve',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige ID'),
    body('isApproved').isBoolean().toBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await approveKunde(req.params.id, req.body.isApproved, currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PUT /kunden/:id
// Aktualisiert einen Kunden – Admin oder der Kunde selbst
kundeRouter.put(
  '/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige ID'),
    body('name').optional().isString().trim().notEmpty(),
    body('password').optional().isString().trim().notEmpty(),
    body('email').optional().isEmail().withMessage('Ungültige Email'),
    body('adresse').optional().isString().trim().notEmpty(),
    body('telefon').optional().isString().trim(),
    body('lieferzeit').optional().isString().trim(),
    body('ustId').optional().isString().trim(),
    body('handelsregisterNr').optional().isString().trim(),
    body('ansprechpartner').optional().isString().trim(),
    body('website').optional().isString().trim(),
    body('branchenInfo').optional().isString().trim(),
    body('region').optional().isString().trim(),
    body('kategorie').optional().isString().trim(),
    body('gewerbeDateiUrl').optional().isString().trim(),
    body('zusatzDateiUrl').optional().isString().trim(),
    body('isApproved').optional().isBoolean().toBoolean(),
    body('emailRechnung').optional().isEmail().withMessage('Ungültige E-Mail für Rechnungen'),
    body('emailLieferschein').optional().isEmail().withMessage('Ungültige E-Mail für Lieferscheine'),
    body('emailBuchhaltung').optional().isEmail().withMessage('Ungültige E-Mail für Buchhaltung'),
    body('emailSpedition').optional().isEmail().withMessage('Ungültige E-Mail für Spedition'),
    body('fehlmengenBenachrichtigung').optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await updateKunde(req.params.id, req.body, currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE /kunden/:id
// Löscht einen Kunden – Admin oder der Kunde selbst
kundeRouter.delete(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      await deleteKunde(req.params.id, currentUser);
      res.json({ message: 'Kunde gelöscht' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// 💚 GET /kunden/:id/favoriten – Holt alle Favoriten eines Kunden
kundeRouter.get(
  '/:id/favoriten',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user!;
      const favoriten = await getKundenFavoriten(req.params.id, currentUser);
      res.json(favoriten);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ➕ POST /kunden/:id/favoriten – Artikel als Favorit hinzufügen
kundeRouter.post(
  '/:id/favoriten',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige Kunden-ID'),
    body('artikelId').isMongoId().withMessage('Ungültige Artikel-ID'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user!;
      await addKundenFavorit(req.params.id, req.body.artikelId, currentUser);
      res.json({ message: 'Artikel hinzugefügt' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ❌ DELETE /kunden/:id/favoriten/:artikelId – Favorit entfernen
kundeRouter.delete(
  '/:id/favoriten/:artikelId',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige Kunden-ID'),
    param('artikelId').isMongoId().withMessage('Ungültige Artikel-ID'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user!;
      await removeKundenFavorit(req.params.id, req.params.artikelId, currentUser);
      res.json({ message: 'Artikel entfernt' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PATCH /kunden/normalize-emails
// Normalisiert alle Kunden-E-Mails (nur Admin)
kundeRouter.patch(
  '/normalize-emails',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      if (!currentUser.role.includes("admin")) {
        return res.status(403).json({ error: 'Nur Admins dürfen diese Aktion durchführen' });
      }

      // Service aufrufen
      const count = await normalizeKundenEmails();
      res.json({ message: `E-Mail-Adressen normalisiert: ${count}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PATCH /kunden/:id/bestimmte-artikel
 * Setzt die erlaubten/bestimmten Artikel eines Kunden (nur Admin)
 * Body: { artikelIds: string[] }
 */
kundeRouter.patch(
  '/:id/bestimmte-artikel',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige Kunden-ID'),
    body('artikelIds')
      .isArray()
      .withMessage('artikelIds muss ein Array sein'),
    body('artikelIds.*')
      .isMongoId()
      .withMessage('Ungültige Artikel-ID'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user!;
      const result = await setBestimmteArtikel(
        req.params.id,
        req.body.artikelIds,
        currentUser
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default kundeRouter;