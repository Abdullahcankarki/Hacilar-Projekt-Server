import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import {
  createKundenPreis,
  getAllKundenPreise,
  getKundenPreisById,
  updateKundenPreis,
  deleteKundenPreis,
  getKundenPreisByArtikelId,
  setAufpreisForArtikelByFilter,
} from '../services/KundenPreisService'; // Passe den Pfad ggf. an
import { LoginResource } from '../Resources'; // Passe den Pfad ggf. an

const kundenPreisRouter = express.Router();
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

// Middleware: Prüft, ob der User Admin ist
const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'a') {
    return res.status(403).json({ error: 'Admin-Zugriff erforderlich' });
  }
  next();
};

// Middleware: Prüft Validierungsergebnisse
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/* -------------------------------
   Routen für Kundenpreis
---------------------------------*/

kundenPreisRouter.post(
  '/set-aufpreis',
  authenticate,
  isAdmin,
  [
    body('artikel')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Artikel-ID ist erforderlich')
      .isMongoId()
      .withMessage('Ungültige Artikel-ID'),
    body('aufpreis')
      .isNumeric()
      .withMessage('Aufpreis muss eine Zahl sein'),
    body('kategorie')
      .optional()
      .isString()
      .withMessage('Kategorie muss ein String sein'),
    body('region')
      .optional()
      .isString()
      .withMessage('Region muss ein String sein'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { artikel, aufpreis, kategorie, region } = req.body;
      const result = await setAufpreisForArtikelByFilter(artikel, aufpreis, { kategorie, region });
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /kundenpreise
// Erstellt einen neuen kundenspezifischen Preis (nur Admins)
kundenPreisRouter.post(
  '/',
  authenticate,
  isAdmin,
  [
    body('artikel')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Artikel-ID ist erforderlich')
      .isMongoId()
      .withMessage('Ungültige Artikel-ID'),
    body('customer')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Kunden-ID ist erforderlich')
      .isMongoId()
      .withMessage('Ungültige Kunden-ID'),
    body('aufpreis')
      .isNumeric()
      .withMessage('Aufpreis muss eine Zahl sein'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createKundenPreis(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /kundenpreise
// Ruft alle kundenspezifischen Preise ab (nur Admins)
kundenPreisRouter.get(
  '/',
  authenticate,
  isAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getAllKundenPreise();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /kundenpreise/artikel/:artikelId
// Gibt alle Kundenpreise zu einer bestimmten Artikel-ID zurück (nur Admins)
kundenPreisRouter.get(
  '/artikel/:artikelId',
  authenticate,
  isAdmin,
  [param('artikelId').isMongoId().withMessage('Ungültige Artikel-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const artikelId = req.params.artikelId;
      const result = await getKundenPreisByArtikelId(artikelId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /kundenpreise/:id
// Ruft einen einzelnen kundenspezifischen Preis anhand der ID ab (nur Admins)
kundenPreisRouter.get(
  '/:id',
  authenticate,
  isAdmin,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getKundenPreisById(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PUT /kundenpreise/:id
// Aktualisiert einen kundenspezifischen Preis (nur Admins)
kundenPreisRouter.put(
  '/:id',
  authenticate,
  isAdmin,
  [
    param('id').isMongoId().withMessage('Ungültige ID'),
    body('artikel')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Artikel-ID muss ein nicht leerer String sein')
      .isMongoId()
      .withMessage('Ungültige Artikel-ID'),
    body('customer')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Kunden-ID muss ein nicht leerer String sein')
      .isMongoId()
      .withMessage('Ungültige Kunden-ID'),
    body('aufpreis')
      .optional()
      .isNumeric()
      .withMessage('Aufpreis muss eine Zahl sein'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateKundenPreis(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE /kundenpreise/:id
// Löscht einen kundenspezifischen Preis (nur Admins)
kundenPreisRouter.delete(
  '/:id',
  authenticate,
  isAdmin,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteKundenPreis(req.params.id);
      res.json({ message: 'Kundenpreis gelöscht' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default kundenPreisRouter;