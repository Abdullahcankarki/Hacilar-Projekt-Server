import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { param, body, query, validationResult } from 'express-validator';
import {
  getAllZerlegeauftraege,
  getZerlegeauftragById,
  getAllOffeneZerlegeauftraege,
  updateZerlegeauftragStatus,
  deleteZerlegeauftraegeByDatum
} from '../services/ZerlegeAuftragService';
import { LoginResource } from 'src/Resources';

const zerlegeRouter = express.Router();
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
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.id,
      role: decoded.role,
      exp: decoded.exp,
    };
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

// Alle Zerlegeaufträge abrufen
zerlegeRouter.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await getAllZerlegeauftraege();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Einzelnen Zerlegeauftrag abrufen
zerlegeRouter.get(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getZerlegeauftragById(req.params.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Nur offene Zerlegeaufträge abrufen
zerlegeRouter.get(
  '/offen/liste',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getAllOffeneZerlegeauftraege();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Zerlegeposition als "erledigt" markieren
zerlegeRouter.patch(
  '/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige Zerlegeauftrag-ID'),
    body('artikelPositionId')
      .isString().withMessage('ArtikelPositionId ist erforderlich')
      .isMongoId().withMessage('Ungültige ArtikelPosition-ID'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateZerlegeauftragStatus(
        req.params.id,
        req.body.artikelPositionId,
        req.user!
      );
      res.json(result);
    } catch (err: any) {
      res.status(403).json({ error: err.message });
    }
  }
);

// Zerlegeaufträge eines Tages löschen
zerlegeRouter.delete(
  '/',
  authenticate,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await deleteZerlegeauftraegeByDatum(req.user!);
      res.json({ deleted: result.deletedCount });
    } catch (err: any) {
      res.status(403).json({ error: err.message });
    }
  }
);

export default zerlegeRouter;