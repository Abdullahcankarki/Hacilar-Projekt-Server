import express, { Request, Response, NextFunction } from "express";
import { query, param, validationResult, body } from "express-validator";
import jwt from "jsonwebtoken";

import {
  getBestandUebersicht,
  getChargeView,
  getZeitreiseBestand,
  manuellerZugang,
} from "../../services/inventory/BestandsService";
import type { LoginResource, Lagerbereich } from "../../Resources";

const bestandRouter = express.Router();
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
 * GET /bestand/uebersicht
 * Materialisierte Bestandsübersicht (oder Zeitreise via ?datum)
 * Query:
 *  - artikelId?, chargeId?, lagerbereich? ("TK"|"NON_TK")
 *  - datum? (YYYY-MM-DD) -> Zeitreise
 *  - q? (Volltext), kritisch? (bool), thresholdDays? (int)
 *  - page?, limit?
 */
bestandRouter.get(
  "/uebersicht",
  authenticate,
  [
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("chargeId").optional().isMongoId().withMessage("Ungültige chargeId"),
    query("lagerbereich").optional().isIn(["TK", "NON_TK"]).withMessage("lagerbereich muss TK oder NON_TK sein"),
    query("datum").optional().isISO8601().withMessage("datum muss YYYY-MM-DD sein"),
    query("q").optional().isString().trim(),
    query("kritisch").optional().isBoolean().toBoolean(),
    query("thresholdDays").optional().isInt({ min: 1, max: 365 }).toInt(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await getBestandUebersicht({
        artikelId: req.query.artikelId?.toString(),
        chargeId: req.query.chargeId?.toString(),
        lagerbereich: req.query.lagerbereich as Lagerbereich | undefined,
        datum: req.query.datum?.toString(),
        q: req.query.q?.toString(),
        kritisch: typeof req.query.kritisch === "boolean" ? (req.query.kritisch as boolean) : undefined,
        thresholdDays: req.query.thresholdDays ? Number(req.query.thresholdDays) : undefined,
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
 * GET /bestand/charge/:id
 * Charge-Detail-Ansicht (Stammdaten, Reservierungen, Bewegungen)
 */
bestandRouter.get(
  "/charge/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Charge-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await getChargeView(req.params.id);
      if (!data.charge) return res.status(404).json({ error: "Charge nicht gefunden" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /bestand/zeitreise
 * Bestand zum Stichtag rekonstruieren (aus Bewegungen)
 * Query: datum* (YYYY-MM-DD), artikelId?, chargeId?
 */
bestandRouter.get(
  "/zeitreise",
  authenticate,
  [
    query("datum").isISO8601().withMessage("datum (YYYY-MM-DD) ist erforderlich"),
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("chargeId").optional().isMongoId().withMessage("Ungültige chargeId"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const items = await getZeitreiseBestand({
        datum: req.query.datum!.toString(),
        artikelId: req.query.artikelId?.toString(),
        chargeId: req.query.chargeId?.toString(),
      });
      res.json({ items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * POST /bestand/manuell-zugang
 * Manueller Zugang ohne Wareneingang – positive Bestandskorrektur
 * Body:
 *  - artikelId* (mongoId)
 *  - menge* (number > 0)
 *  - lagerbereich* ("TK"|"NON_TK")
 *  - notiz? (string)
 *  - chargeId? (mongoId) – wenn angegeben, wird diese Charge verwendet
 *  - createNewCharge? ({ mhd*: YYYY-MM-DD, isTK*: boolean, schlachtDatum?: YYYY-MM-DD, lieferantId?: mongoId })
 */
bestandRouter.post(
  "/manuell-zugang",
  authenticate,
  [
    body("artikelId").isMongoId().withMessage("Ungültige artikelId"),
    body("menge").isFloat({ gt: 0 }).withMessage("menge muss > 0 sein").toFloat(),
    body("lagerbereich").isIn(["TK", "NON_TK"]).withMessage("lagerbereich muss TK oder NON_TK sein"),
    body("notiz").optional().isString().trim(),
    body("chargeId").optional().isMongoId().withMessage("Ungültige chargeId"),
    // createNewCharge (optional object)
    body("createNewCharge").optional().isObject(),
    body("createNewCharge.mhd").optional().isISO8601().withMessage("createNewCharge.mhd muss YYYY-MM-DD sein"),
    body("createNewCharge.isTK").optional().isBoolean().withMessage("createNewCharge.isTK muss boolean sein").toBoolean(),
    body("createNewCharge.schlachtDatum").optional().isISO8601().withMessage("createNewCharge.schlachtDatum muss YYYY-MM-DD sein"),
    body("createNewCharge.lieferantId").optional().isMongoId().withMessage("Ungültige createNewCharge.lieferantId"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const result = await manuellerZugang({
        artikelId: req.body.artikelId,
        menge: Number(req.body.menge),
        lagerbereich: req.body.lagerbereich,
        userId,
        notiz: req.body.notiz,
        chargeId: req.body.chargeId,
        createNewCharge: req.body.createNewCharge
          ? {
              mhd: req.body.createNewCharge.mhd,
              isTK: !!req.body.createNewCharge.isTK,
              schlachtDatum: req.body.createNewCharge.schlachtDatum,
              lieferantId: req.body.createNewCharge.lieferantId,
            }
          : undefined,
      });
      res.status(201).json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default bestandRouter;