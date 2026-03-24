import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { param, body, validationResult } from "express-validator";
import {
  getImports,
  getPostenByImport,
  getLatestPosten,
  createImport,
  deleteImport,
} from "../services/OffenePostenService";
import { LoginResource } from "../Resources";

const offenePostenRouter = express.Router();
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

// GET /api/offene-posten/imports — Liste aller Imports
offenePostenRouter.get(
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

// GET /api/offene-posten/latest — Posten des letzten Imports
offenePostenRouter.get(
  "/latest",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getLatestPosten());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/offene-posten/imports/:id — Posten eines bestimmten Imports
offenePostenRouter.get(
  "/imports/:id",
  authenticate,
  [param("id").isMongoId()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getPostenByImport(req.params.id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/offene-posten/imports — Neuer Import
offenePostenRouter.post(
  "/imports",
  authenticate,
  [
    body("berichtsDatum").isISO8601().withMessage("berichtsDatum muss ein gültiges Datum sein"),
    body("dateiname").isString().trim().notEmpty().withMessage("dateiname ist erforderlich"),
    body("posten").isArray({ min: 1 }).withMessage("posten muss ein nicht-leeres Array sein"),
    body("posten.*.kontonr").isString().trim().notEmpty(),
    body("posten.*.kunde").isString().trim().notEmpty(),
    body("posten.*.buchNr").isString().trim().notEmpty(),
    body("posten.*.datum").isISO8601(),
    body("posten.*.reNr").isString().trim().notEmpty(),
    body("posten.*.betrag").isFloat(),
    body("posten.*.tageOffen").isInt({ min: 0 }),
    body("posten.*.stufe").optional().isString(),
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

// DELETE /api/offene-posten/imports/:id — Import loeschen
offenePostenRouter.delete(
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

export default offenePostenRouter;
