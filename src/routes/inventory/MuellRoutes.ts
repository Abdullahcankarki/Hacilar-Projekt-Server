import express, { Request, Response, NextFunction } from "express";
import { body, param, query, validationResult } from "express-validator";
import jwt from "jsonwebtoken";

import { bookMuell, listMuell, undoMuell } from "../../services/inventory/MuellService";
import type { LoginResource, Lagerbereich } from "../../Resources";

const muellRouter = express.Router();
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
 * POST /api/muell
 * Müll/Verlust buchen (schreibt Journal-Eintrag und senkt Verfügbar in BestandAgg).
 * Body: artikelId*, chargeId*, menge*, lagerbereich* ("TK"|"NON_TK"), grund* (Enum), notiz?
 * Rollen: admin/lager (falls du ein authorize brauchst, einfach ergänzen)
 */
muellRouter.post(
  "/",
  authenticate,
  [
    body("artikelId").isMongoId().withMessage("Ungültige artikelId"),
    body("chargeId").isMongoId().withMessage("Ungültige chargeId"),
    body("menge").isNumeric().withMessage("menge muss eine Zahl sein"),
    body("lagerbereich").isIn(["TK", "NON_TK"]).withMessage("lagerbereich muss TK oder NON_TK sein"),
    body("grund")
      .isIn(["MHD_ABGELAUFEN", "BESCHAEDIGT", "VERDERB", "RUECKWEISUNG_KUNDE", "SONSTIGES"])
      .withMessage("Ungültiger Grund"),
    body("notiz").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await bookMuell({
        artikelId: req.body.artikelId,
        chargeId: req.body.chargeId,
        menge: Number(req.body.menge),
        lagerbereich: req.body.lagerbereich as Lagerbereich,
        grund: req.body.grund,
        notiz: req.body.notiz,
        userId: req.user?.id,
      });
      res.status(201).json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

/**
 * GET /api/muell
 * Müll-Bewegungen listen (typ=MULL) mit Filtern & Pagination.
 * Query: from?, to?, artikelId?, chargeId?, q?, page?, limit?
 */
muellRouter.get(
  "/",
  authenticate,
  [
    query("from").optional().isISO8601().withMessage("from ist kein gültiges Datum"),
    query("to").optional().isISO8601().withMessage("to ist kein gültiges Datum"),
    query("artikelId").optional().isMongoId().withMessage("Ungültige artikelId"),
    query("chargeId").optional().isMongoId().withMessage("Ungültige chargeId"),
    query("q").optional().isString().trim(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = await listMuell({
        from: req.query.from?.toString(),
        to: req.query.to?.toString(),
        artikelId: req.query.artikelId?.toString(),
        chargeId: req.query.chargeId?.toString(),
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
 * POST /api/muell/:bewegungId/undo
 * Gegenbuchung (INVENTUR_KORREKTUR +) zu einer MÜLL-Bewegung erzeugen.
 * Body: begruendung? (optional)
 */
muellRouter.post(
  "/:bewegungId/undo",
  authenticate,
  [param("bewegungId").isMongoId().withMessage("Ungültige Bewegungs-ID"), body("begruendung").optional().isString().trim()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await undoMuell({
        bewegungId: req.params.bewegungId,
        begruendung: req.body?.begruendung,
        userId: req.user?.id,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default muellRouter;