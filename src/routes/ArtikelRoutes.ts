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
  if (!req.user || req.user.role !== 'a') {
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

/* -------------------------------
   Routen für Artikel
---------------------------------*/

/**
 * GET /artikel/auswahl
 * Gibt eine vordefinierte Liste an Artikeln zurück.
 */
artikelRouter.get(
  '/auswahl',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const isAdminUser = req.user?.role === 'a';
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
 * GET /artikel
 * Ruft alle Artikel ab.
 * Optional: Admins können `?kunde=...` übergeben.
 */
artikelRouter.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const isAdminUser = req.user?.role === 'a';
    const kundeId = isAdminUser ? req.query.kunde?.toString() ?? req.user?.id : req.user?.id;
    const result = await getAllArtikel(kundeId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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
      const isAdminUser = req.user?.role === 'a';
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