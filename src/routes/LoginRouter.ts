import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import { loginKunde } from '../services/KundeService'; // Pfad ggf. anpassen
import { loginVerkaeufer } from '../services/VerkaeuferService'; // Pfad ggf. anpassen
import { LoginResource } from '../Resources'; // Pfad ggf. anpassen

const loginRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Middleware: Validierungsergebnisse prüfen
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /login
 * Kombinierter Login-Endpoint.
 * - Wenn im Body eine "email" enthalten ist, wird der Kundenlogin genutzt.
 * - Wenn stattdessen "name" angegeben wird, erfolgt der Verkäuferlogin.
 */
loginRouter.post(
  '/',
  [
    // Es muss mindestens email oder name vorhanden sein:
    body().custom(body => {
      if (!body.email && !body.name) {
        throw new Error('Entweder "email" oder "name" muss angegeben werden.');
      }
      return true;
    }),
    // Falls email vorhanden ist, validiere sie:
    body('email')
      .if(body('email').exists())
      .isEmail().withMessage('Ungültige Email'),
    // Falls name vorhanden ist, validiere:
    body('name')
      .if(body('name').exists())
      .isString().trim().notEmpty().withMessage('Name ist erforderlich'),
    // Passwort ist in beiden Fällen Pflicht:
    body('password')
      .isString().trim().notEmpty().withMessage('Passwort ist erforderlich'),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      let result: { token: string; user: LoginResource };
      if (req.body.email) {
        // Kunden-Login verwenden
        result = await loginKunde(req.body);
      } else if (req.body.name) {
        // Verkäufer-Login verwenden
        result = await loginVerkaeufer(req.body);
      } else {
        throw new Error('Ungültige Login-Daten');
      }
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
);

loginRouter.get('/check-token', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) return res.status(401).json({ message: 'Kein Token gesendet' });

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
    return res.status(200).json({ valid: true, user: decoded });
  } catch (err) {
    return res.status(401).json({ message: 'Token ungültig oder abgelaufen' });
  }
});

export default loginRouter;