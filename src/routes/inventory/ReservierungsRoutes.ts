import express, { Request, Response, NextFunction } from "express";
import { body, param, query, validationResult } from "express-validator";
import jwt from "jsonwebtoken";

import {
  createReservierung,
  updateReservierung,
  cancelReservierung,
  listReservierungen,
  getReservierungById,
} from "../../services/inventory/ReservierungsService";
import type { LoginResource } from "../../Resources";

const reservierungenRouter = express.Router();
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
 * POST /api/reservierungen
 * Body: artikelId*, auftragId*, lieferDatum* (YYYY-MM-DD), menge* (number)
 */
reservierungenRouter.post(
  "/",
  authenticate,
  [
    body("artikelId").isMongoId().withMessage("Ungültige artikelId"),
    body("auftragId").isMongoId().withMessage("Ungültige auftragId"),
    body("lieferDatum").isISO8601().withMessage("lieferDatum muss YYYY-MM-DD sein"),
    body("menge").isNumeric().withMessage("menge muss eine Zahl sein"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const r = await createReservierung({
        artikelId: req.body.artikelId,
        auftragId: req.body.auftragId,
        lieferDatum: req.body.lieferDatum,
        menge: Number(req.body.menge),
      });
      res.status(201).json(r);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /api/reservierungen
 * Query: artikelId?, auftragId?, status? (AKTIV|ERFUELLT|AUFGELOEST), from?, to?, q?, page?, limit?
 */
reservierungenRouter.get(
  "/",
  authenticate,
  [
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("auftragId").optional().isMongoId().withMessage("Ungültige auftragId"),
    query("status").optional().isIn(["AKTIV", "ERFUELLT", "AUFGELOEST"]).withMessage("Ungültiger Status"),
    query("from").optional().isISO8601().withMessage("from ist kein Datum"),
    query("to").optional().isISO8601().withMessage("to ist kein Datum"),
    query("q").optional().isString().trim(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await listReservierungen({
        artikelId: req.query.artikelId?.toString(),
        auftragId: req.query.auftragId?.toString(),
        status: req.query.status?.toString() as "AKTIV" | "ERFUELLT" | "AUFGELOEST" | undefined,
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
 * GET /api/reservierungen/:id
 */
reservierungenRouter.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Reservierungs-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const doc = await getReservierungById(req.params.id);
      if (!doc) return res.status(404).json({ error: "Reservierung nicht gefunden" });
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * PUT /api/reservierungen/:id
 * Body: menge?, lieferDatum?, status? (AKTIV|ERFUELLT|AUFGELOEST)
 * Hinweis: In deinem Business-Flow setzt i. d. R. Picking die Erfüllung.
 */
reservierungenRouter.put(
  "/:id",
  authenticate,
  [
    param("id").isMongoId().withMessage("Ungültige Reservierungs-ID"),
    body("menge").optional().isNumeric().withMessage("menge muss eine Zahl sein"),
    body("lieferDatum").optional().isISO8601().withMessage("lieferDatum muss YYYY-MM-DD sein"),
    body("status").optional().isIn(["AKTIV", "ERFUELLT", "AUFGELOEST"]).withMessage("Ungültiger Status"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const r = await updateReservierung(req.params.id, {
        menge: typeof req.body.menge === "number" ? req.body.menge : req.body.menge ? Number(req.body.menge) : undefined,
        lieferDatum: req.body.lieferDatum,
        status: req.body.status,
      });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * POST /api/reservierungen/:id/cancel
 * Setzt Status auf AUFGELOEST (Auflösung/Storno).
 */
reservierungenRouter.post(
  "/:id/cancel",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Reservierungs-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const r = await cancelReservierung(req.params.id);
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default reservierungenRouter;