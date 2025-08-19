// backend/src/routes/region-rule.routes.ts
import { Router, Response } from "express";
import { body, param, query } from "express-validator";
import {
  createRegionRule,
  getRegionRuleById,
  listRegionRules,
  updateRegionRule,
  deleteRegionRule,
  deleteAllRegionRules,
} from "../services/RegionRuleService";
import { authenticate, AuthRequest, isAdmin, validate } from "./helper-hooks";

const regionRuleRouter = Router();

// Helpers: Validatoren
const isHHmm = (s: string) =>
  /^([01]\d|2[0-3]):([0-5]\d)$/.test(s);

const isYMD = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ------------------------------- CREATE ------------------------------- */
regionRuleRouter.post(
  "/",
  authenticate,
  isAdmin,
  [
    body("region")
      .isString().withMessage("region muss ein String sein")
      .trim().notEmpty().withMessage("region ist erforderlich"),
    body("allowedWeekdays")
      .isArray({ min: 1 }).withMessage("allowedWeekdays muss ein nicht-leeres Array sein"),
    body("allowedWeekdays.*")
      .isInt({ min: 1, max: 7 }).withMessage("allowedWeekdays-Werte müssen 1..7 sein")
      .toInt(),
    body("orderCutoff")
      .optional()
      .isString().custom(isHHmm).withMessage('orderCutoff muss "HH:mm" sein'),
    body("exceptionDates")
      .optional()
      .isArray().withMessage("exceptionDates muss ein Array sein"),
    body("exceptionDates.*")
      .optional()
      .isString().custom(isYMD).withMessage('exceptionDates-Elemente müssen "YYYY-MM-DD" sein'),
    body("isActive")
      .optional()
      .isBoolean().withMessage("isActive muss boolean sein")
      .toBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createRegionRule(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* -------------------------------- READ -------------------------------- */
regionRuleRouter.get(
  "/:id",
  authenticate,
  [param("id").isString().notEmpty().withMessage("ID ist erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getRegionRuleById(req.params.id);
      if (!result) return res.status(404).json({ error: "RegionRule nicht gefunden" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------ LIST/QUERY ---------------------------- */
regionRuleRouter.get(
  "/",
  authenticate,
  [
    query("active").optional().isBoolean().toBoolean(),
    query("region").optional().isString().trim(),
    query("q").optional().isString().trim(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { active, region, q, page, limit } = req.query as any;
      const result = await listRegionRules({ active, region, q, page, limit });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- UPDATE ------------------------------- */
regionRuleRouter.patch(
  "/:id",
  authenticate,
  isAdmin,
  [
    param("id").isString().notEmpty(),
    body().custom((value) => {
      if (!value || typeof value !== "object") throw new Error("Body erforderlich");
      const keys = Object.keys(value);
      const allowed = ["region", "allowedWeekdays", "orderCutoff", "exceptionDates", "isActive"];
      if (!keys.some((k) => allowed.includes(k))) {
        throw new Error("Mindestens ein gültiges Feld muss übergeben werden");
      }
      return true;
    }),
    body("region").optional().isString().trim().notEmpty(),
    body("allowedWeekdays").optional().isArray({ min: 1 }),
    body("allowedWeekdays.*")
      .optional()
      .isInt({ min: 1, max: 7 }).withMessage("allowedWeekdays-Werte müssen 1..7 sein")
      .toInt(),
    body("orderCutoff").optional().isString().custom(isHHmm).withMessage('orderCutoff muss "HH:mm" sein'),
    body("exceptionDates").optional().isArray(),
    body("exceptionDates.*").optional().isString().custom(isYMD).withMessage('exceptionDates-Elemente müssen "YYYY-MM-DD" sein'),
    body("isActive").optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateRegionRule(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("RegionRule nicht gefunden")) {
        return res.status(404).json({ error: "RegionRule nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- DELETE ------------------------------- */
regionRuleRouter.delete(
  "/:id",
  authenticate,
  isAdmin,
  [param("id").isString().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteRegionRule(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      if (String(error.message || "").includes("RegionRule nicht gefunden")) {
        return res.status(404).json({ error: "RegionRule nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* --------------------------- DELETE ALL (DANGER) ---------------------- */
regionRuleRouter.delete(
  "/",
  authenticate,
  isAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      await deleteAllRegionRules();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default regionRuleRouter;
