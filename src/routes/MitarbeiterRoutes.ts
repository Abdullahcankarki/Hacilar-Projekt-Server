import express, { Request, Response, NextFunction } from "express";
import { body, param, validationResult } from "express-validator";
import jwt from "jsonwebtoken";

import { LoginResource } from "../Resources"; // Passe den Pfad ggf. an
import { createMitarbeiter, deleteMitarbeiter, getAllMitarbeiter, getMitarbeiterById, loginMitarbeiter, updateMitarbeiter } from "../services/MitarbeiterService";

const mitarbeiterRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Typdefinition für authentifizierte Requests
interface AuthRequest extends Request {
  user?: LoginResource;
}

// Middleware: Authentifizierung anhand des JWT-Tokens
const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Kein Token vorhanden" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as LoginResource;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Ungültiges Token" });
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
   Routen für Mitarbeiter
-----------------------------*/

// POST /mitarbeiter
// Erstellt einen neuen Mitarbeiter (nur Admins)
mitarbeiterRouter.post(
  "/",
  authenticate,
  [
    body("name")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Name ist erforderlich"),
    body("password")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Passwort ist erforderlich"),
    body("email").optional().isEmail().normalizeEmail(),
    body("rollen").optional().isArray(),
    body("rollen.*")
      .optional()
      .isString()
      .isIn([
        "admin",
        "verkauf",
        "kommissionierung",
        "kontrolle",
        "buchhaltung",
        "wareneingang",
        "lager",
        "fahrer",
        "zerleger",
        "statistik",
        "kunde",
        "support",
      ]),
    body("aktiv").optional().isBoolean().toBoolean(),
    body("telefon").optional().isString().trim(),
    body("abteilung").optional().isString().trim(),
    body("bemerkung").optional().isString().trim(),
    body("eintrittsdatum").optional().isISO8601().toDate(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await createMitarbeiter(req.body, currentUser);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /mitarbeiter
// Ruft alle Mitarbeiter ab (nur Admins)
mitarbeiterRouter.get(
  "/",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await getAllMitarbeiter(currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /mitarbeiter/:id
// Ruft einen Mitarbeiter anhand der ID ab
mitarbeiterRouter.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await getMitarbeiterById(req.params.id, currentUser);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// PUT /mitarbeiter/:id
// Aktualisiert einen Mitarbeiter (nur Admins oder der eigene Account)
mitarbeiterRouter.put(
  "/:id",
  authenticate,
  [
    param("id").isMongoId().withMessage("Ungültige ID"),
    body("name").optional().isString().trim().notEmpty(),
    body("password").optional().isString().trim().notEmpty(),
    body("email").optional().isEmail().normalizeEmail(),
    body("rollen").optional().isArray(),
    body("rollen.*")
      .optional()
      .isString()
      .isIn([
        "admin",
        "verkauf",
        "kommissionierung",
        "kontrolle",
        "buchhaltung",
        "wareneingang",
        "lager",
        "fahrer",
        "zerleger",
        "statistik",
        "kunde",
        "support",
      ]),
    body("aktiv").optional().isBoolean().toBoolean(),
    body("telefon").optional().isString().trim(),
    body("abteilung").optional().isString().trim(),
    body("bemerkung").optional().isString().trim(),
    body("eintrittsdatum").optional().isISO8601().toDate(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      const result = await updateMitarbeiter(
        req.params.id,
        req.body,
        currentUser
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// DELETE /mitarbeiter/:id
// Löscht einen Mitarbeiter (nur Admins)
mitarbeiterRouter.delete(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const currentUser = req.user as LoginResource;
      await deleteMitarbeiter(req.params.id, currentUser);
      res.json({ message: "Mitarbeiter gelöscht" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /mitarbeiter/login
// Authentifiziert einen Mitarbeiter und gibt ein JWT zurück
mitarbeiterRouter.post(
  "/login",
  [
    body("name")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Name ist erforderlich"),
    body("password")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Passwort ist erforderlich"),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const result = await loginMitarbeiter(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
);

export default mitarbeiterRouter;
