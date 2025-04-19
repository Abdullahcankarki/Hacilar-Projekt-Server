import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import {
  createAuftrag,
  getAuftragById,
  getAllAuftraege,
  updateAuftrag,
  deleteAuftrag,
  getAuftraegeByCustomerId,
  getLetzterAuftragMitPositionenByKundenId,
  getLetzterArtikelFromAuftragByKundenId,
} from '../services/AuftragService'; // Passe den Pfad ggf. an
import { LoginResource } from '../Resources'; // Passe den Pfad ggf. an

const auftragRouter = express.Router();
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
   Routen für Aufträge
---------------------------------*/

/**
 * POST /auftraege
 * Erstellt einen neuen Auftrag.
 * Falls der angemeldete Nutzer kein Admin ist, muss das Feld "kunde" mit der eigenen ID übereinstimmen.
 */
auftragRouter.post(
  '/',
  authenticate,
  [
    body('kunde')
      .isString().trim().notEmpty().withMessage('Kunde ist erforderlich')
      .isMongoId().withMessage('Ungültige Kunde-ID'),
    body('artikelPosition')
      .isArray({ min: 0 }).withMessage('ArtikelPosition muss ein Array mit mindestens einem Eintrag sein'),
    body('artikelPosition.*')
      .isString().trim().notEmpty().withMessage('Jeder Eintrag in ArtikelPosition muss eine gültige ID sein')
      .isMongoId().withMessage('Ungültige ArtikelPosition-ID'),
    body('status')
      .optional()
      .isIn(['offen', 'in Bearbeitung', 'abgeschlossen', 'storniert'])
      .withMessage('Ungültiger Status'),
    body('lieferdatum')
      .optional()
      .isISO8601().withMessage('Lieferdatum muss ein gültiges Datum sein'),
    body('bemerkungen')
      .optional()
      .isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Falls der User kein Admin ist, darf das angegebene Kunde-Feld nur die eigene ID enthalten
      if (req.user?.role !== 'a' && req.body.kunde !== req.user?.id) {
        return res.status(403).json({ error: 'Zugriff verweigert: Kunde stimmt nicht überein' });
      }
      const result = await createAuftrag(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege
 * Ruft alle Aufträge ab.
 * Dieser Endpunkt ist ausschließlich Admins vorbehalten.
 */
auftragRouter.get(
  '/',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'a') {
        return res.status(403).json({ error: 'Nur Admins können alle Aufträge abrufen' });
      }
      const result = await getAllAuftraege();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/letzte
 * Gibt den letzten Auftrag des eingeloggten Kunden zurück.
 */
auftragRouter.get(
  '/letzte',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Nicht authentifiziert' });
      }

      // Admins brauchen Kunden-ID im Query-Parameter (z. B. ?kunde=xyz)
      const kundenId = user.role === 'a'
        ? req.query.kunde?.toString()
        : user.id;

      if (!kundenId) {
        return res.status(400).json({ error: 'Kunden-ID fehlt' });
      }

      const letzterAuftrag = await getLetzterAuftragMitPositionenByKundenId(kundenId);
      if (!letzterAuftrag) {
        return res.status(404).json({ error: 'Kein Auftrag gefunden' });
      }

      res.json(letzterAuftrag);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/letzte
 * Gibt den letzten Auftrag des eingeloggten Kunden zurück.
 */
auftragRouter.get(
  '/letzteArtikel',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Nicht authentifiziert' });
      }

      // Admins brauchen Kunden-ID im Query-Parameter (z. B. ?kunde=xyz)
      const kundenId = user.role === 'a'
        ? req.query.kunde?.toString()
        : user.id;

      if (!kundenId) {
        return res.status(400).json({ error: 'Kunden-ID fehlt' });
      }

      const letzterAuftrag = await getLetzterArtikelFromAuftragByKundenId(kundenId);
      if (!letzterAuftrag) {
        return res.status(404).json({ error: 'Kein Auftrag gefunden' });
      }

      res.json(letzterAuftrag);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/:id
 * Ruft einen einzelnen Auftrag anhand der ID ab.
 * Admins dürfen jeden Auftrag abrufen, Kunden nur ihre eigenen.
 */
auftragRouter.get(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige Auftrag-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getAuftragById(req.params.id);
      // Falls der Nutzer kein Admin ist, muss der Auftrag dem eigenen Kunden zugeordnet sein.
      if (req.user?.role !== 'a' && result.kunde !== req.user?.id) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);


/**
 * GET /auftraege/kunden/:id
 * Ruft einen einzelnen Auftrag anhand der ID ab.
 * Admins dürfen jeden Auftrag abrufen, Kunden nur ihre eigenen.
 */

auftragRouter.get(
  '/kunden/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige Kunden-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Zugriff nur auf eigene Aufträge, außer Admin
      if (req.user?.role !== 'a' && req.params.id !== req.user?.id) {
        return res.status(403).json({ error: 'Zugriff verweigert: Kunde stimmt nicht überein' });
      }

      const result = await getAuftraegeByCustomerId(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /auftraege/:id
 * Aktualisiert einen Auftrag.
 * Nur Admins oder der Inhaber des Auftrags dürfen Aktualisierungen vornehmen.
 */
auftragRouter.put(
  '/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige Auftrag-ID'),
    body('kunde')
      .optional()
      .isString().trim().notEmpty().withMessage('Kunde muss ein gültiger String sein')
      .isMongoId().withMessage('Ungültige Kunde-ID'),
    body('artikelPosition')
      .optional()
      .isArray({ min: 1 }).withMessage('ArtikelPosition muss ein Array mit mindestens einem Eintrag sein'),
    body('artikelPosition.*')
      .optional()
      .isString().trim().notEmpty().withMessage('Jeder ArtikelPosition-Eintrag muss eine gültige ID sein')
      .isMongoId().withMessage('Ungültige ArtikelPosition-ID'),
    body('status')
      .optional()
      .isIn(['offen', 'in Bearbeitung', 'abgeschlossen', 'storniert'])
      .withMessage('Ungültiger Status'),
    body('lieferdatum')
      .optional()
      .isISO8601().withMessage('Lieferdatum muss ein gültiges Datum sein'),
    body('bemerkungen')
      .optional()
      .isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Falls "kunde" im Body gesetzt wird und der User kein Admin ist, muss dieser Wert mit der eigenen ID übereinstimmen.
      if (req.user?.role !== 'a' && req.body.kunde && req.body.kunde !== req.user?.id) {
        return res.status(403).json({ error: 'Zugriff verweigert: Kunde stimmt nicht überein' });
      }
      const result = await updateAuftrag(req.params.id, req.body);

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /auftraege/:id
 * Löscht einen Auftrag.
 * Nur Admins oder der Inhaber des Auftrags dürfen diesen Vorgang ausführen.
 */
auftragRouter.delete(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige Auftrag-ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Zunächst den Auftrag abrufen, um zu prüfen, ob er dem Nutzer gehört
      const order = await getAuftragById(req.params.id);
      if (req.user?.role !== 'a' && order.kunde !== req.user?.id) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      await deleteAuftrag(req.params.id);
      res.json({ message: 'Auftrag gelöscht' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default auftragRouter;