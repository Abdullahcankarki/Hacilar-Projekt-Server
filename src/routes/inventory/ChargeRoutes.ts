import express, { Request, Response, NextFunction } from "express";
import { body, param, query, validationResult } from "express-validator";
import jwt from "jsonwebtoken";

import {
  createCharge,
  getChargeById,
  listCharges,
  updateCharge,
  deleteCharge,
} from "../../services/inventory/ChargeService";
import { mergeCharge, umbuchen } from "../../services/inventory/UmbuchungService";
import { bookMuell } from "../../services/inventory/MuellService";
import { getChargeView } from "../../services/inventory/BestandsService";
import type { LoginResource, Lagerbereich, MitarbeiterRolle } from "../../Resources";

const chargeRouter = express.Router();
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

const authorize = (roles: MitarbeiterRolle[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // defensive: Falls Token ältere Struktur hat (string[]), sanft mappen
    const rawRoles = req.user?.role as unknown;
    const userRoles: MitarbeiterRolle[] = Array.isArray(rawRoles)
      ? (rawRoles as MitarbeiterRolle[])
      : [];

    const ok = roles.some((r) => userRoles.includes(r));
    if (!ok) return res.status(403).json({ error: "Keine Berechtigung" });
    next();
  };
};

const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

/* ----------------------------- ROUTES ---------------------------- */

/**
 * GET /charges
 * Liste & Filter (Pagination)
 * Query: artikelId?, q?, isTK?, mhdFrom?, mhdTo?, page?, limit?
 */
chargeRouter.get(
  "/",
  authenticate,
  [
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("q").optional().isString().trim(),
    query("isTK").optional().isBoolean().toBoolean(),
    query("mhdFrom").optional().isISO8601().withMessage("mhdFrom ist kein gültiges Datum"),
    query("mhdTo").optional().isISO8601().withMessage("mhdTo ist kein gültiges Datum"),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const items = await listCharges({
        artikelId: req.query.artikelId?.toString(),
        q: req.query.q?.toString(),
        isTK:
          typeof req.query.isTK !== "undefined"
            ? req.query.isTK === "true"
            : undefined,
        mhdFrom: req.query.mhdFrom?.toString(),
        mhdTo: req.query.mhdTo?.toString(),
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json(items);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /charges/:id
 * Einzelne Charge laden
 */
chargeRouter.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Charge-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const doc = await getChargeById(req.params.id);
      if (!doc) return res.status(404).json({ error: "Charge nicht gefunden" });
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /charges/:id/view
 * Charge-Detail inkl. Bewegungen & Reservierungen
 */
chargeRouter.get(
  "/:id/view",
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
 * POST /charges
 * Charge anlegen
 * Body: artikelId*, mhd* (YYYY-MM-DD), isTK* (bool), schlachtDatum?, lieferantId?
 * Admin oder Lager
 */
chargeRouter.post(
  "/",
  authenticate,
  authorize(["admin", "lager"]),
  [
    body("artikelId").isMongoId().withMessage("artikelId erforderlich/ungültig"),
    body("mhd").isISO8601().withMessage("mhd muss Datum (YYYY-MM-DD) sein"),
    body("isTK").isBoolean().withMessage("isTK muss boolean sein"),
    body("schlachtDatum").optional().isISO8601().withMessage("schlachtDatum ist kein Datum"),
    body("lieferantId").optional().isMongoId().withMessage("Ungültige lieferantId"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const created = await createCharge({
        artikelId: req.body.artikelId,
        mhd: req.body.mhd,
        isTK: !!req.body.isTK,
        schlachtDatum: req.body.schlachtDatum,
        lieferantId: req.body.lieferantId,
      });
      res.status(201).json(created);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * PUT /charges/:id
 * Charge aktualisieren
 * Body: mhd?, isTK?, schlachtDatum?, lieferantId?
 * Admin oder Lager
 */
chargeRouter.put(
  "/:id",
  authenticate,
  authorize(["admin", "lager"]),
  [
    param("id").isMongoId().withMessage("Ungültige Charge-ID"),
    body("mhd").optional().isISO8601().withMessage("mhd ist kein Datum"),
    body("isTK").optional().isBoolean().withMessage("isTK muss boolean sein"),
    body("schlachtDatum").optional().isISO8601().withMessage("schlachtDatum ist kein Datum"),
    body("lieferantId").optional().isMongoId().withMessage("Ungültige lieferantId"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const updated = await updateCharge(req.params.id, {
        mhd: req.body.mhd,
        isTK: typeof req.body.isTK === "boolean" ? req.body.isTK : undefined,
        schlachtDatum: req.body.schlachtDatum,
        lieferantId: req.body.lieferantId,
        artikelId: req.body.artikelId
      });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * POST /charges/:id/merge
 * Charge zusammenführen (Quelle=:id → Ziel=body.zielChargeId)
 * Body: zielChargeId*, menge?, zielLagerbereich* ("TK"|"NON_TK"), notiz?
 * Admin oder Lager
 */
chargeRouter.post(
  "/:id/merge",
  authenticate,
  authorize(["admin", "lager"]),
  [
    param("id").isMongoId().withMessage("Ungültige Quell-Charge-ID"),
    body("zielChargeId").isMongoId().withMessage("Ungültige Ziel-Charge-ID"),
    body("menge").optional().isNumeric().withMessage("menge muss Zahl sein"),
    body("zielLagerbereich")
      .isIn(["TK", "NON_TK"])
      .withMessage("zielLagerbereich muss TK oder NON_TK sein"),
    body("notiz").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { zielChargeId, menge, zielLagerbereich, notiz } = req.body as {
        zielChargeId: string;
        menge?: number;
        zielLagerbereich: Lagerbereich;
        notiz?: string;
      };

      // artikelId aus Ziel/Quelle wird im Service validiert; hier nur Durchreichen
      const source = await getChargeById(req.params.id);
      if (!source) return res.status(404).json({ error: "Quell-Charge nicht gefunden" });

      const result = await mergeCharge({
        artikelId: source.artikelId!,
        quelleChargeId: req.params.id,
        zielChargeId,
        menge,
        zielLagerbereich,
        notiz,
        userId: req.user?.id,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * POST /charges/:id/umbuchen
 * Umbuchen Quelle=:id → nach.{chargeId? | newCharge{...}}, nach.lagerbereich*, menge*
 * Body: { nach: { chargeId?: string, lagerbereich: "TK"|"NON_TK", newCharge?: { mhd, isTK, schlachtDatum?, lieferantId? } }, menge*, notiz? }
 * Admin oder Lager
 */
chargeRouter.post(
  "/:id/umbuchen",
  authenticate,
  authorize(["admin", "lager"]),
  [
    param("id").isMongoId().withMessage("Ungültige Quell-Charge-ID"),
    body("nach.lagerbereich").isIn(["TK", "NON_TK"]).withMessage("lagerbereich muss TK/NON_TK sein"),
    body("nach.chargeId").optional().isMongoId().withMessage("Ungültige Ziel-Charge-ID"),
    body("nach.newCharge").optional().isObject(),
    body("nach.newCharge.mhd").optional().isISO8601(),
    body("nach.newCharge.isTK").optional().isBoolean(),
    body("nach.newCharge.schlachtDatum").optional().isISO8601(),
    body("nach.newCharge.lieferantId").optional().isMongoId(),
    body("menge").isNumeric().withMessage("menge muss Zahl sein"),
    body("notiz").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const src = await getChargeById(req.params.id);
      if (!src) return res.status(404).json({ error: "Quell-Charge nicht gefunden" });

      const result = await umbuchen({
        artikelId: src.artikelId!,
        von: { chargeId: req.params.id, lagerbereich: (src as any).isTK ? "TK" : "NON_TK" },
        nach: {
          chargeId: req.body?.nach?.chargeId,
          lagerbereich: req.body?.nach?.lagerbereich,
          newCharge: req.body?.nach?.newCharge,
        },
        menge: Number(req.body.menge),
        notiz: req.body.notiz,
        userId: req.user?.id,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * POST /charges/:id/muell
 * Müll buchen (Abschreibung) von Charge :id
 * Body: menge*, lagerbereich* ("TK"|"NON_TK"), grund* (Enum), notiz?
 * Admin oder Lager
 */
chargeRouter.post(
  "/:id/muell",
  authenticate,
  authorize(["admin", "lager"]),
  [
    param("id").isMongoId().withMessage("Ungültige Charge-ID"),
    body("menge").isNumeric().withMessage("menge muss Zahl sein"),
    body("lagerbereich").isIn(["TK", "NON_TK"]).withMessage("lagerbereich muss TK/NON_TK sein"),
    body("grund")
      .isIn(["MHD_ABGELAUFEN", "BESCHAEDIGT", "VERDERB", "RUECKWEISUNG_KUNDE", "SONSTIGES"])
      .withMessage("Ungültiger Grund"),
    body("notiz").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const ch = await getChargeById(req.params.id);
      if (!ch) return res.status(404).json({ error: "Charge nicht gefunden" });

      const result = await bookMuell({
        artikelId: ch.artikelId!,
        chargeId: req.params.id,
        menge: Number(req.body.menge),
        lagerbereich: req.body.lagerbereich as Lagerbereich,
        grund: req.body.grund,
        notiz: req.body.notiz,
        userId: req.user?.id,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * DELETE /charges/:id
 * Charge löschen (Achtung: nur wenn historisch/Bestand dies erlaubt)
 * Admin oder Admin+Sonderrecht
 */
chargeRouter.delete(
  "/:id",
  authenticate,
  authorize(["admin"]),
  [param("id").isMongoId().withMessage("Ungültige Charge-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteCharge(req.params.id);
      res.json({ message: "Charge gelöscht" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default chargeRouter;