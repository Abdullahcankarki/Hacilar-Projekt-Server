import { Request, Response, NextFunction, Router } from 'express';
import {validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { LoginResource } from '../Resources'; // Passe den Pfad ggf. an

export const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Typdefinition für authentifizierte Requests
export interface AuthRequest extends Request {
  user?: LoginResource;
}

// Middleware: Authentifizierung mittels JWT
export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
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
export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !req.user.role.includes('admin')) {
    return res.status(403).json({ error: 'Admin-Zugriff erforderlich' });
  }
  next();
};

// Middleware: Validierungsergebnisse prüfen
export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};