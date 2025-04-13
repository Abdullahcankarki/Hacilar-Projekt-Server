import express, { Request, Response, NextFunction } from 'express';
import { body, param, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import {
  createVerkaeufer,
  getAllVerkaeufer,
  getVerkaeuferById,
  updateVerkaeufer,
  deleteVerkaeufer,
  loginVerkaeufer,
} from '../services/VerkaeuferService'; // Passe den Pfad ggf. an
import { LoginResource } from '../Resources'; // Passe den Pfad ggf. an

const verkaeuferRouter = express.Router();
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

// Middleware: Validierungsergebnisse prüfen
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/* ---------------------------
   Routen für Verkaeufer
-----------------------------*/

// POST /verkaeufer
// Erstellt einen neuen Verkäufer (nur Admins)
verkaeuferRouter.post(
  '/',
  authenticate,
  [
    body('name')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Name ist erforderlich'),
    body('password')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Passwort ist erforderlich'),
    body('admin')
      .optional()
      .isBoolean()
      .withMessage('Admin muss ein Boolean-Wert sein'),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await createVerkaeufer(req.body, currentUser);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /verkaeufer
// Ruft alle Verkäufer ab (nur Admins)
verkaeuferRouter.get(
  '/',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await getAllVerkaeufer(currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /verkaeufer/:id
// Ruft einen Verkäufer anhand der ID ab
verkaeuferRouter.get(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await getVerkaeuferById(req.params.id, currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PUT /verkaeufer/:id
// Aktualisiert einen Verkäufer (nur Admins oder der eigene Account)
verkaeuferRouter.put(
  '/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Ungültige ID'),
    body('name').optional().isString().trim().notEmpty(),
    body('password').optional().isString().trim().notEmpty(),
    body('admin').optional().isBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await updateVerkaeufer(req.params.id, req.body, currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE /verkaeufer/:id
// Löscht einen Verkäufer (nur Admins)
verkaeuferRouter.delete(
  '/:id',
  authenticate,
  [param('id').isMongoId().withMessage('Ungültige ID')],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      await deleteVerkaeufer(req.params.id, currentUser);
      res.json({ message: 'Verkäufer gelöscht' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /verkaeufer/login
// Authentifiziert einen Verkäufer und gibt ein JWT zurück
verkaeuferRouter.post(
  '/login',
  [
    body('name')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Name ist erforderlich'),
    body('password')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('Passwort ist erforderlich'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const result = await loginVerkaeufer(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
);

export default verkaeuferRouter;