import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { param, body, query, validationResult } from "express-validator";
import {
  getBrustEintraegeByDatum,
  getBrustEintraegeByRange,
  upsertBrustEintrag,
  deleteBrustEintrag,
  getBrustConfig,
  updateBrustConfig,
} from "../services/BrustService";
import { LoginResource } from "../Resources";

const brustRouter = express.Router();
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

brustRouter.get(
  "/eintraege",
  authenticate,
  [query("datum").isISO8601().withMessage("Datum erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getBrustEintraegeByDatum(req.query.datum as string, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

brustRouter.get(
  "/eintraege/range",
  authenticate,
  [
    query("von").isISO8601(),
    query("bis").isISO8601(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(
        await getBrustEintraegeByRange(
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

brustRouter.post(
  "/eintraege",
  authenticate,
  [
    body("datum").isISO8601(),
    body("zerlegerId").isMongoId(),
    body("zerlegerName").isString().trim().notEmpty(),
    body("anzahlKisten").isFloat({ min: 0 }),
    body("gewichtMitKnochen").isFloat({ min: 0 }),
    body("brustMitHaut").isFloat({ min: 0 }),
    body("brustOhneHaut").isFloat({ min: 0 }),
    body("haut").isFloat({ min: 0 }),
    body("kosten").optional().isString(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.status(201).json(await upsertBrustEintrag(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

brustRouter.delete(
  "/eintraege/:id",
  authenticate,
  [param("id").isMongoId()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await deleteBrustEintrag(req.params.id, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Config ──

brustRouter.get(
  "/config",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await getBrustConfig(req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

brustRouter.put(
  "/config",
  authenticate,
  [
    body("sollMitHaut").isFloat({ min: 0, max: 1 }),
    body("sollOhneHaut").isFloat({ min: 0, max: 1 }),
    body("sollHaut").isFloat({ min: 0, max: 1 }),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await updateBrustConfig(req.body, req.user!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default brustRouter;
