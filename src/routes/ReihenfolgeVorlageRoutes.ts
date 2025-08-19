// backend/src/routes/reihenfolge-vorlage.routes.ts
import { Router, Response } from "express";
import { body, param, query } from "express-validator";

import {
  createReihenfolgeVorlage,
  getReihenfolgeVorlageById,
  listReihenfolgeVorlagen,
  updateReihenfolgeVorlage,
  deleteReihenfolgeVorlage,
  deleteAllReihenfolgeVorlagen,
} from "../services/ReihenfolgeVorlageService";
import { authenticate, AuthRequest, isAdmin, validate } from "./helper-hooks";

const reihenfolgeVorlageRouter = Router();

/* ------------------------------- CREATE ------------------------------- */
reihenfolgeVorlageRouter.post(
  "/",
  authenticate,
  isAdmin,
  [
    body("region")
      .isString().withMessage("region muss ein String sein")
      .trim().notEmpty().withMessage("region ist erforderlich"),
    body("name")
      .isString().withMessage("name muss ein String sein")
      .trim().notEmpty().withMessage("name ist erforderlich"),
    body("kundenIdsInReihenfolge")
      .isArray().withMessage("kundenIdsInReihenfolge muss ein Array sein"),
    body("kundenIdsInReihenfolge.*")
      .isString().trim().isLength({ min: 1 }).withMessage("Kunden-ID muss String sein"),
    // wenn du echte MongoIDs erzwingen willst, nimm stattdessen:
    // body("kundenIdsInReihenfolge.*").isMongoId().withMessage("Ungültige Kunden-ID"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createReihenfolgeVorlage(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* -------------------------------- READ -------------------------------- */
reihenfolgeVorlageRouter.get(
  "/:id",
  authenticate,
  [param("id").isString().notEmpty().withMessage("ID ist erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getReihenfolgeVorlageById(req.params.id);
      if (!result) return res.status(404).json({ error: "ReihenfolgeVorlage nicht gefunden" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------ LIST/QUERY ---------------------------- */
reihenfolgeVorlageRouter.get(
  "/",
  authenticate,
  [
    query("region").optional().isString().trim(),
    query("q").optional().isString().trim(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { region, q, page, limit } = req.query as any;
      const result = await listReihenfolgeVorlagen({ region, q, page, limit });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- UPDATE ------------------------------- */
reihenfolgeVorlageRouter.patch(
  "/:id",
  authenticate,
  isAdmin,
  [
    param("id").isString().notEmpty(),
    body().custom((value) => {
      if (!value || typeof value !== "object") throw new Error("Body erforderlich");
      const keys = Object.keys(value);
      const allowed = ["region", "name", "kundenIdsInReihenfolge"];
      if (!keys.some((k) => allowed.includes(k))) {
        throw new Error("Mindestens ein gültiges Feld muss übergeben werden");
      }
      return true;
    }),
    body("region").optional().isString().trim().notEmpty(),
    body("name").optional().isString().trim().notEmpty(),
    body("kundenIdsInReihenfolge").optional().isArray(),
    body("kundenIdsInReihenfolge.*")
      .optional()
      .isString().trim().isLength({ min: 1 }),
    // oder: .isMongoId() falls deine IDs echte ObjectIds sind
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateReihenfolgeVorlage(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("ReihenfolgeVorlage nicht gefunden")) {
        return res.status(404).json({ error: "ReihenfolgeVorlage nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- DELETE ------------------------------- */
reihenfolgeVorlageRouter.delete(
  "/:id",
  authenticate,
  isAdmin,
  [param("id").isString().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteReihenfolgeVorlage(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      if (String(error.message || "").includes("ReihenfolgeVorlage nicht gefunden")) {
        return res.status(404).json({ error: "ReihenfolgeVorlage nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* --------------------------- DELETE ALL (DANGER) ---------------------- */
reihenfolgeVorlageRouter.delete(
  "/",
  authenticate,
  isAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      await deleteAllReihenfolgeVorlagen();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default reihenfolgeVorlageRouter;
