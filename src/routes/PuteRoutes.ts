import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { param, body, query, validationResult } from "express-validator";
import {
  getPuteEintraegeByDatum,
  getPuteEintraegeByRange,
  upsertPuteEintrag,
  deletePuteEintrag,
  getAllPuteConfigs,
  upsertPuteConfig,
} from "../services/PuteService";
import { LoginResource } from "../Resources";

const puteRouter = express.Router();
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

// ── Einträge ──

puteRouter.get(
  "/eintraege",
  authenticate,
  [
    query("datum").isISO8601().withMessage("Datum im Format YYYY-MM-DD erforderlich"),
    query("kategorie").optional().isIn(["pute_fluegel", "pute_keule"]),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(
        await getPuteEintraegeByDatum(
          req.query.datum as string,
          req.query.kategorie as string,
          req.user!
        )
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

puteRouter.get(
  "/eintraege/range",
  authenticate,
  [
    query("von").isISO8601().withMessage("'von' im Format YYYY-MM-DD erforderlich"),
    query("bis").isISO8601().withMessage("'bis' im Format YYYY-MM-DD erforderlich"),
    query("kategorie").optional().isIn(["pute_fluegel", "pute_keule"]),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(
        await getPuteEintraegeByRange(
          req.query.von as string,
          req.query.bis as string,
          req.query.kategorie as string,
          req.user!
        )
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

puteRouter.post(
  "/eintraege",
  authenticate,
  [
    body("datum").isISO8601().withMessage("Datum erforderlich"),
    body("kategorie").isIn(["pute_fluegel", "pute_keule"]).withMessage("Kategorie muss pute_fluegel oder pute_keule sein"),
    body("zerlegerId").isMongoId().withMessage("Ungültige Zerleger-ID"),
    body("zerlegerName").isString().trim().notEmpty(),
    body("mitKnochen").isFloat({ min: 0 }).withMessage("mitKnochen muss >= 0 sein"),
    body("ohneKnochen").isFloat({ min: 0 }).withMessage("ohneKnochen muss >= 0 sein"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.status(201).json(await upsertPuteEintrag(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

puteRouter.delete(
  "/eintraege/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await deletePuteEintrag(req.params.id, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Config ──

puteRouter.get(
  "/config",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getAllPuteConfigs(req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

puteRouter.put(
  "/config",
  authenticate,
  [
    body("kategorie").isIn(["pute_fluegel", "pute_keule"]).withMessage("Ungültige Kategorie"),
    body("sollProzent").isFloat({ min: 0, max: 1 }).withMessage("SOLL-% muss zwischen 0 und 1 liegen"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await upsertPuteConfig(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default puteRouter;
