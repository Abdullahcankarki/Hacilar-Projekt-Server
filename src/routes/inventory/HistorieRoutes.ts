import express, { Request, Response, NextFunction } from "express";
import { query, param, validationResult } from "express-validator";
import jwt from "jsonwebtoken";
import path from "path";

import {
  listBewegungen,
  getBewegungById,
  exportBewegungenCSV,
} from "../../services/inventory/HistorieService";
import type { LoginResource, Lagerbereich } from "../../Resources";

const historieRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

/* -------------------- Auth / Validate Helpers -------------------- */

interface AuthRequest extends Request {
  user?: LoginResource;
}

const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Kein Token vorhanden" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as LoginResource;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Ungültiges Token" });
  }
};

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

/* ----------------------------- ROUTES ---------------------------- */
/**
 * GET /api/historie
 * Query:
 *  - from?, to? (ISO)
 *  - typ? ("MULL,KOMMISSIONIERUNG,..." – CSV)
 *  - artikelId?, chargeId?, auftragId?
 *  - lagerbereich? ("TK"|"NON_TK")
 *  - q?
 *  - page?, limit?
 */
historieRouter.get(
  "/",
  authenticate,
  [
    query("from").optional().isISO8601().withMessage("from ist kein gültiges Datum"),
    query("to").optional().isISO8601().withMessage("to ist kein gültiges Datum"),
    query("typ").optional().isString().trim(),
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("chargeId").optional().isMongoId().withMessage("Ungültige chargeId"),
    query("auftragId").optional().isMongoId().withMessage("Ungültige auftragId"),
    query("lagerbereich").optional().isIn(["TK", "NON_TK"]).withMessage("lagerbereich muss TK oder NON_TK sein"),
    query("q").optional().isString().trim(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 500 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await listBewegungen({
        from: req.query.from?.toString(),
        to: req.query.to?.toString(),
        typ: req.query.typ?.toString(),
        artikelId: req.query.artikelId?.toString(),
        chargeId: req.query.chargeId?.toString(),
        auftragId: req.query.auftragId?.toString(),
        lagerbereich: req.query.lagerbereich as Lagerbereich | undefined,
        q: req.query.q?.toString(),
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /api/historie/:id
 * Einzelbewegung
 */
historieRouter.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Bewegungs-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const doc = await getBewegungById(req.params.id);
      if (!doc) return res.status(404).json({ error: "Bewegung nicht gefunden" });
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /api/historie/export.csv
 * Exportiert die gefilterten Bewegungen als CSV und triggert einen Download.
 * Query entspricht /api/historie, plus optional:
 *  - filename? (Standard: bewegungen_YYYY-MM-DD.csv)
 */
historieRouter.get(
  "/export.csv",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("typ").optional().isString().trim(),
    query("artikelId").optional().isMongoId(),
    query("chargeId").optional().isMongoId(),
    query("auftragId").optional().isMongoId(),
    query("lagerbereich").optional().isIn(["TK", "NON_TK"]),
    query("q").optional().isString().trim(),
    query("filename").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { path: filePath, filename } = await exportBewegungenCSV({
        from: req.query.from?.toString(),
        to: req.query.to?.toString(),
        typ: req.query.typ?.toString(),
        artikelId: req.query.artikelId?.toString(),
        chargeId: req.query.chargeId?.toString(),
        auftragId: req.query.auftragId?.toString(),
        lagerbereich: req.query.lagerbereich as Lagerbereich | undefined,
        q: req.query.q?.toString(),
        filename: req.query.filename?.toString(),
      });

      // Download ausliefern
      res.download(filePath, filename, (err) => {
        if (err) {
          console.error("[Historie Export] Download-Fehler:", err.message);
          return res.status(500).json({ error: "Export konnte nicht gesendet werden" });
        }
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default historieRouter;