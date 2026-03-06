import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { param, body, query, validationResult } from "express-validator";
import {
  getAllLieferanten,
  createLieferant,
  updateLieferant,
  deleteLieferant,
  getAllZerleger,
  createZerleger,
  updateZerleger,
  deleteZerleger,
  getEintraegeByDatum,
  getEintraegeByRange,
  upsertEintrag,
  updateEintrag,
  deleteEintrag,
  getTagesConfig,
  upsertTagesConfig,
} from "../services/GefluegelService";
import { LoginResource } from "../Resources";

const gefluegelRouter = express.Router();
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

// ── Lieferanten ──

gefluegelRouter.get(
  "/lieferanten",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getAllLieferanten());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.post(
  "/lieferanten",
  authenticate,
  [
    body("name").isString().trim().notEmpty().withMessage("Name ist erforderlich"),
    body("sollProzent").isFloat({ min: 0, max: 1 }).withMessage("SOLL-% muss zwischen 0 und 1 liegen"),
    body("ekProKg").isFloat({ min: 0 }).withMessage("EK pro Kg muss >= 0 sein"),
    body("zerlegungskostenProKiste").isFloat({ min: 0 }).withMessage("Zerlegungskosten muss >= 0 sein"),
    body("kistenGewichtKg").optional().isFloat({ min: 0 }),
    body("aktiv").optional().isBoolean(),
    body("reihenfolge").optional().isInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.status(201).json(await createLieferant(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.put(
  "/lieferanten/:id",
  authenticate,
  [
    param("id").isMongoId().withMessage("Ungültige ID"),
    body("name").optional().isString().trim().notEmpty(),
    body("sollProzent").optional().isFloat({ min: 0, max: 1 }),
    body("ekProKg").optional().isFloat({ min: 0 }),
    body("zerlegungskostenProKiste").optional().isFloat({ min: 0 }),
    body("kistenGewichtKg").optional().isFloat({ min: 0 }),
    body("aktiv").optional().isBoolean(),
    body("reihenfolge").optional().isInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await updateLieferant(req.params.id, req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.delete(
  "/lieferanten/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await deleteLieferant(req.params.id, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Zerleger ──

gefluegelRouter.get(
  "/zerleger",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getAllZerleger());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.post(
  "/zerleger",
  authenticate,
  [
    body("name").isString().trim().notEmpty().withMessage("Name ist erforderlich"),
    body("aktiv").optional().isBoolean(),
    body("reihenfolge").optional().isInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.status(201).json(await createZerleger(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.put(
  "/zerleger/:id",
  authenticate,
  [
    param("id").isMongoId().withMessage("Ungültige ID"),
    body("name").optional().isString().trim().notEmpty(),
    body("aktiv").optional().isBoolean(),
    body("reihenfolge").optional().isInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await updateZerleger(req.params.id, req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.delete(
  "/zerleger/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await deleteZerleger(req.params.id, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Einträge ──

gefluegelRouter.get(
  "/eintraege",
  authenticate,
  [query("datum").isISO8601().withMessage("Datum im Format YYYY-MM-DD erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getEintraegeByDatum(req.query.datum as string, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.get(
  "/eintraege/range",
  authenticate,
  [
    query("von").isISO8601().withMessage("'von' im Format YYYY-MM-DD erforderlich"),
    query("bis").isISO8601().withMessage("'bis' im Format YYYY-MM-DD erforderlich"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getEintraegeByRange(req.query.von as string, req.query.bis as string, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.post(
  "/eintraege",
  authenticate,
  [
    body("datum").isISO8601().withMessage("Datum erforderlich"),
    body("zerlegerId").isMongoId().withMessage("Ungültige Zerleger-ID"),
    body("zerlegerName").isString().trim().notEmpty(),
    body("lieferantId").isMongoId().withMessage("Ungültige Lieferant-ID"),
    body("lieferantName").isString().trim().notEmpty(),
    body("kisten").isFloat({ min: 0 }).withMessage("Kisten muss >= 0 sein"),
    body("kg").isFloat({ min: 0 }).withMessage("Kg muss >= 0 sein"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.status(201).json(await upsertEintrag(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.put(
  "/eintraege/:id",
  authenticate,
  [
    param("id").isMongoId().withMessage("Ungültige ID"),
    body("kisten").optional().isFloat({ min: 0 }),
    body("kg").optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await updateEintrag(req.params.id, req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.delete(
  "/eintraege/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await deleteEintrag(req.params.id, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── TagesConfig ──

gefluegelRouter.get(
  "/tagesconfig",
  authenticate,
  [query("datum").isISO8601().withMessage("Datum im Format YYYY-MM-DD erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getTagesConfig(req.query.datum as string, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

gefluegelRouter.put(
  "/tagesconfig",
  authenticate,
  [
    body("datum").isISO8601().withMessage("Datum erforderlich"),
    body("hiddenLieferanten").isArray().withMessage("hiddenLieferanten muss ein Array sein"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await upsertTagesConfig(req.body.datum, req.body.hiddenLieferanten, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default gefluegelRouter;
