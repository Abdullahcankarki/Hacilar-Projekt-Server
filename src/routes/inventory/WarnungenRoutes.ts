import express, { Request, Response, NextFunction } from "express";
import { query, validationResult } from "express-validator";
import jwt from "jsonwebtoken";

import {
  listMhdWarnungen,
  listUeberreserviert,
  listTkMismatch,
} from "../../services/inventory/WarnungenService";
import type { LoginResource } from "../../Resources";

const warnungenRouter = express.Router();
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
 * GET /api/warnungen/mhd
 * Query: thresholdDays? (int, default 5), onlyCritical? (bool), artikelId?, page?, limit?
 */
warnungenRouter.get(
  "/mhd",
  authenticate,
  [
    query("thresholdDays").optional().isInt({ min: 1, max: 365 }).toInt(),
    query("onlyCritical").optional().isBoolean().toBoolean(),
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await listMhdWarnungen({
        thresholdDays: req.query.thresholdDays ? Number(req.query.thresholdDays) : undefined,
        onlyCritical: typeof req.query.onlyCritical === "boolean" ? (req.query.onlyCritical as boolean) : undefined,
        artikelId: req.query.artikelId?.toString(),
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
 * GET /api/warnungen/ueberreserviert
 * Query: bisDatum? (YYYY-MM-DD), artikelId?
 */
warnungenRouter.get(
  "/ueberreserviert",
  authenticate,
  [
    query("bisDatum").optional().isISO8601().withMessage("bisDatum muss YYYY-MM-DD sein"),
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await listUeberreserviert({
        bisDatum: req.query.bisDatum?.toString(),
        artikelId: req.query.artikelId?.toString(),
      });
      res.json({ items: rows, total: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /api/warnungen/tk-mismatch
 * Query: from? (ISO), to? (ISO), artikelId?, page?, limit?
 */
warnungenRouter.get(
  "/tk-mismatch",
  authenticate,
  [
    query("from").optional().isISO8601().withMessage("from ist kein gültiges Datum"),
    query("to").optional().isISO8601().withMessage("to ist kein gültiges Datum"),
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await listTkMismatch({
        from: req.query.from?.toString(),
        to: req.query.to?.toString(),
        artikelId: req.query.artikelId?.toString(),
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
 * GET /api/warnungen/summary
 * Kleine Zusammenfassung (Counts) – ideal fürs Dashboard.
 * Optional: thresholdDays? (MHD), bisDatum? (Überreserviert-Blick nach vorn)
 */
warnungenRouter.get(
  "/summary",
  authenticate,
  [
    query("thresholdDays").optional().isInt({ min: 1, max: 365 }).toInt(),
    query("bisDatum").optional().isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const [mhdAll, mhdCritical, ueber, tk] = await Promise.all([
        listMhdWarnungen({
          thresholdDays: req.query.thresholdDays ? Number(req.query.thresholdDays) : undefined,
        }),
        listMhdWarnungen({
          thresholdDays: req.query.thresholdDays ? Number(req.query.thresholdDays) : undefined,
          onlyCritical: true,
        }),
        listUeberreserviert({ bisDatum: req.query.bisDatum?.toString() }),
        listTkMismatch({ page: 1, limit: 1 }), // wir brauchen nur total
      ]);

      res.json({
        mhd: {
          total: mhdAll.total,
          critical: mhdCritical.items.length,
        },
        ueberreserviert: {
          total: ueber.length,
        },
        tkMismatch: {
          total: tk.total,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default warnungenRouter;