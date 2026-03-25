import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { param, body, validationResult } from "express-validator";
import {
  getImports,
  getEintraegeByImport,
  getLatestEintraege,
  createImport,
  deleteImport,
} from "../services/LeergutService";
import { LoginResource } from "../Resources";

const leergutRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

interface AuthRequest extends Request {
  user?: LoginResource;
}

const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Kein Token vorhanden" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = { id: decoded.id, role: decoded.role, exp: decoded.exp };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Ungültiges Token" });
  }
};

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// GET /api/leergut/imports — Liste aller Imports
leergutRouter.get(
  "/imports",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getImports());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/leergut/latest — Eintraege des letzten Imports
leergutRouter.get(
  "/latest",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getLatestEintraege());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/leergut/imports/:id — Eintraege eines bestimmten Imports
leergutRouter.get(
  "/imports/:id",
  authenticate,
  [param("id").isMongoId()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getEintraegeByImport(req.params.id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/leergut/imports — Neuer Import
leergutRouter.post(
  "/imports",
  authenticate,
  [
    body("anzahlDateien").isInt({ min: 1 }).withMessage("anzahlDateien muss >= 1 sein"),
    body("eintraege").isArray({ min: 1 }).withMessage("eintraege muss ein nicht-leeres Array sein"),
    body("eintraege.*.kundennr").isString().trim().notEmpty(),
    body("eintraege.*.kunde").isString().trim().notEmpty(),
    body("eintraege.*.artikel").isString().trim().notEmpty(),
    body("eintraege.*.alterBestand").isInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createImport(req.body);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/leergut/imports/:id — Import loeschen
leergutRouter.delete(
  "/imports/:id",
  authenticate,
  [param("id").isMongoId()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteImport(req.params.id);
      res.json({ message: "Import gelöscht" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /api/leergut/kunde/:kundennr — alle Eintraege eines Kunden loeschen
leergutRouter.delete(
  "/kunde/:kundennr",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { deleteKundeEintraege } = await import("../services/LeergutService");
      const result = await deleteKundeEintraege(req.params.kundennr);
      res.json({ message: `${result.deleted} Einträge gelöscht` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/leergut/send-email — Leergut-Bestätigung per E-Mail senden
leergutRouter.post(
  "/send-email",
  authenticate,
  [
    body("kundenEmail").isEmail().withMessage("Gültige E-Mail erforderlich"),
    body("kundenName").isString().trim().notEmpty(),
    body("pdfBase64").isString().notEmpty().withMessage("PDF-Daten erforderlich"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { sendLeergutEmail } = await import("../services/EmailService");
      await sendLeergutEmail(req.body);
      res.json({ message: "E-Mail gesendet" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default leergutRouter;
