import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { param, body, query, validationResult } from "express-validator";
import {
  getGanzHaehnchenEintraegeByDatum,
  getGanzHaehnchenEintraegeByRange,
  upsertGanzHaehnchenEintrag,
  deleteGanzHaehnchenEintrag,
  getGanzHaehnchenConfig,
  updateGanzHaehnchenConfig,
} from "../services/GanzHaehnchenService";
import { LoginResource } from "../Resources";

const ganzHaehnchenRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

interface AuthRequest extends Request {
  user?: LoginResource;
}

const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Kein Token vorhanden" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = { id: decoded.id, role: decoded.role, exp: decoded.exp };
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

// ── Einträge ──

ganzHaehnchenRouter.get(
  "/eintraege",
  authenticate,
  [query("datum").isISO8601().withMessage("Datum im Format YYYY-MM-DD erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getGanzHaehnchenEintraegeByDatum(req.query.datum as string, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

ganzHaehnchenRouter.get(
  "/eintraege/range",
  authenticate,
  [
    query("von").isISO8601().withMessage("'von' erforderlich"),
    query("bis").isISO8601().withMessage("'bis' erforderlich"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(
        await getGanzHaehnchenEintraegeByRange(
          req.query.von as string,
          req.query.bis as string,
          req.user!
        )
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

ganzHaehnchenRouter.post(
  "/eintraege",
  authenticate,
  [
    body("datum").isISO8601().withMessage("Datum erforderlich"),
    body("zerlegerId").isMongoId(),
    body("zerlegerName").isString().trim().notEmpty(),
    body("anzahlKisten").isFloat({ min: 0 }),
    body("gewichtGesamt").isFloat({ min: 0 }),
    body("brust").isFloat({ min: 0 }),
    body("keule").isFloat({ min: 0 }),
    body("fluegel").isFloat({ min: 0 }),
    body("kosten").optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.status(201).json(await upsertGanzHaehnchenEintrag(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

ganzHaehnchenRouter.delete(
  "/eintraege/:id",
  authenticate,
  [param("id").isMongoId()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await deleteGanzHaehnchenEintrag(req.params.id, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Config ──

ganzHaehnchenRouter.get(
  "/config",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getGanzHaehnchenConfig(req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

ganzHaehnchenRouter.put(
  "/config",
  authenticate,
  [
    body("sollBrust").isFloat({ min: 0, max: 1 }),
    body("sollKeule").isFloat({ min: 0, max: 1 }),
    body("sollFluegel").isFloat({ min: 0, max: 1 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await updateGanzHaehnchenConfig(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default ganzHaehnchenRouter;
