// backend/src/routes/fahrzeug.routes.ts
import { Request, Response, NextFunction, Router } from 'express';
import { body, param, validationResult, query } from 'express-validator';
import jwt from 'jsonwebtoken';
import {
  createFahrzeug,
  getFahrzeugById,
  listFahrzeuge,
  updateFahrzeug,
  deleteFahrzeug,
  deleteAllFahrzeuge,
} from "../services/FahrzeugService";
import { LoginResource } from '../Resources'; // Passe den Pfad ggf. an
import { authenticate, AuthRequest, isAdmin, validate } from './helper-hooks';

const fahrzeugRouter = Router();

/* ------------------------------- CREATE ------------------------------- */
fahrzeugRouter.post(
  "/",
  authenticate,
  isAdmin,
  [
    body("kennzeichen")
      .isString().withMessage("Kennzeichen muss ein String sein")
      .trim()
      .notEmpty().withMessage("Kennzeichen ist erforderlich"),
    body("name").optional().isString().trim(),
    body("maxGewichtKg")
      .isNumeric().withMessage("maxGewichtKg muss eine Zahl sein"),
    body("aktiv").optional().isBoolean().withMessage("aktiv muss boolean sein").toBoolean(),
    body("regionen").optional().isArray().withMessage("regionen muss ein Array sein"),
    body("regionen.*").optional().isString().trim().withMessage("regionen-Elemente müssen Strings sein"),
    body("samsaraVehicleId").optional().isString().trim(),
    body("bemerkung").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createFahrzeug(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* -------------------------------- READ -------------------------------- */
fahrzeugRouter.get(
  "/:id",
  authenticate,
  [
    param("id").isString().notEmpty().withMessage("ID ist erforderlich"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getFahrzeugById(req.params.id);
      if (!result) return res.status(404).json({ error: "Fahrzeug nicht gefunden" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------ LIST/QUERY ---------------------------- */
fahrzeugRouter.get(
  "/",
  authenticate,
  [
    query("aktiv").optional().isBoolean().toBoolean(),
    query("region").optional().isString().trim(),
    query("q").optional().isString().trim(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { aktiv, region, q, page, limit } = req.query as any;
      const result = await listFahrzeuge({ aktiv, region, q, page, limit });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- UPDATE ------------------------------- */
fahrzeugRouter.patch(
  "/:id",
  authenticate,
  isAdmin,
  [
    param("id").isString().notEmpty(),
    body().custom((value) => {
      if (!value || typeof value !== "object") throw new Error("Body erforderlich");
      const keys = Object.keys(value);
      const allowed = ["kennzeichen", "name", "maxGewichtKg", "aktiv", "regionen", "samsaraVehicleId", "bemerkung"];
      const anyAllowed = keys.some((k) => allowed.includes(k));
      if (!anyAllowed) throw new Error("Mindestens ein gültiges Feld muss übergeben werden");
      return true;
    }),
    body("kennzeichen").optional().isString().trim().notEmpty(),
    body("name").optional().isString().trim(),
    body("maxGewichtKg").optional().isNumeric(),
    body("aktiv").optional().isBoolean().toBoolean(),
    body("regionen").optional().isArray(),
    body("regionen.*").optional().isString().trim(),
    body("samsaraVehicleId").optional().isString().trim(),
    body("bemerkung").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateFahrzeug(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("Fahrzeug nicht gefunden")) {
        return res.status(404).json({ error: "Fahrzeug nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- DELETE ------------------------------- */
fahrzeugRouter.delete(
  "/:id",
  authenticate,
  isAdmin,
  [param("id").isString().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteFahrzeug(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      if (String(error.message || "").includes("Fahrzeug nicht gefunden")) {
        return res.status(404).json({ error: "Fahrzeug nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* --------------------------- DELETE ALL (DANGER) ---------------------- */
fahrzeugRouter.delete(
  "/",
  authenticate,
  isAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      await deleteAllFahrzeuge();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default fahrzeugRouter;
