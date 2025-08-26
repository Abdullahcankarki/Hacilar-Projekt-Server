// backend/src/routes/tourstop.routes.ts
import { Router, Response } from "express";
import { body, param, query } from "express-validator";


import {
  createTourStop,
  getTourStopById,
  listTourStops,
  updateTourStop,
  deleteTourStop,
  deleteAllTourStops,
  moveTourStopAcrossTours,
} from "../services/TourStopService";
import { authenticate, AuthRequest, isAdmin, validate } from "./helper-hooks";

const tourStopRouter = Router();

// Wenn du Stop-Status als Enum hast, trage ihn hier ein:
const stopStatusValues = ["offen", "in_bearbeitung", "fertig", "abgebrochen"];

/* ------------------------------- CREATE ------------------------------- */
tourStopRouter.post(
  "/",
  authenticate,
  isAdmin,
  [
    body("tourId").isString().trim().notEmpty().withMessage("tourId ist erforderlich"),
    body("auftragId").isString().trim().notEmpty().withMessage("auftragId ist erforderlich"),
    body("kundeId").isString().trim().notEmpty().withMessage("kundeId ist erforderlich"),
    body("kundeName").optional().isString().trim(),
    body("position").optional().isInt({ min: 1 }).toInt(), // wenn weggelassen → Service hängt ans Ende
    body("gewichtKg").optional().isNumeric().toFloat(),
    body("status")
      .isString().trim().notEmpty().withMessage("status ist erforderlich")
      .isIn(stopStatusValues).withMessage(`status muss eines von ${stopStatusValues.join(", ")} sein`),
    body("fehlgrund").optional().isObject(),
    body("fehlgrund.code").optional().isString().trim(),
    body("fehlgrund.text").optional().isString().trim(),
    body("signaturPngBase64").optional().isString(),
    body("signTimestampUtc").optional().isString().trim(),
    body("signedByName").optional().isString().trim(),
    body("leergutMitnahme").optional().isArray(),
    body("leergutMitnahme.*.art").optional().isString().trim(),
    body("leergutMitnahme.*.anzahl").optional().isNumeric().toFloat(),
    body("leergutMitnahme.*.gewichtKg").optional().isNumeric().toFloat(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createTourStop(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* -------------------------------- READ -------------------------------- */
tourStopRouter.get(
  "/:id",
  authenticate,
  [param("id").isString().trim().notEmpty().withMessage("ID ist erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getTourStopById(req.params.id);
      if (!result) return res.status(404).json({ error: "TourStop nicht gefunden" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------ LIST/QUERY ---------------------------- */
tourStopRouter.get(
  "/",
  authenticate,
  [
    query("tourId").optional().isString().trim(),
    query("auftragId").optional().isString().trim(),
    query("kundeId").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await listTourStops({
        tourId: req.query.tourId as string | undefined,
        auftragId: req.query.auftragId as string | undefined,
        kundeId: req.query.kundeId as string | undefined,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- UPDATE ------------------------------- */
tourStopRouter.patch(
  "/:id",
  authenticate,
  isAdmin,
  [
    param("id").isString().trim().notEmpty(),
    body().custom((value) => {
      if (!value || typeof value !== "object") throw new Error("Body erforderlich");
      const allowed = [
        "position",
        "gewichtKg",
        "status",
        "fehlgrund",
        "signaturPngBase64",
        "signTimestampUtc",
        "signedByName",
        "leergutMitnahme",
        "abgeschlossenAm",
      ];
      if (!Object.keys(value).some((k) => allowed.includes(k))) {
        throw new Error("Mindestens ein gültiges Feld muss übergeben werden");
      }
      return true;
    }),
    body("position").optional().isInt({ min: 1 }).toInt(),
    body("gewichtKg").optional().isNumeric().toFloat(),
    body("status").optional().isString().trim().isIn(stopStatusValues),
    body("fehlgrund").optional().isObject(),
    body("fehlgrund.code").optional().isString().trim(),
    body("fehlgrund.text").optional().isString().trim(),
    body("signaturPngBase64").optional().isString(),
    body("signTimestampUtc").optional().isString().trim(),
    body("signedByName").optional().isString().trim(),
    body("leergutMitnahme").optional().isArray(),
    body("leergutMitnahme.*.art").optional().isString().trim(),
    body("leergutMitnahme.*.anzahl").optional().isNumeric().toFloat(),
    body("leergutMitnahme.*.gewichtKg").optional().isNumeric().toFloat(),
    body("abgeschlossenAm").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateTourStop(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("TourStop nicht gefunden")) {
        return res.status(404).json({ error: "TourStop nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------ MOVE (X-Tour) ----------------------------- */
tourStopRouter.post(
  "/:id/move",
  authenticate,
  isAdmin,
  [
    param("id").isString().trim().notEmpty(),
    body("toTourId").isString().trim().notEmpty().withMessage("toTourId ist erforderlich"),
    body("targetIndex").optional().isInt({ min: 0 }).toInt(), // 0-basiert aus dem Frontend
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await moveTourStopAcrossTours({
        stopId: req.params.id,
        toTourId: req.body.toTourId,
        targetIndex: req.body.targetIndex,
      });
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("TourStop nicht gefunden")) {
        return res.status(404).json({ error: "TourStop nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- DELETE ------------------------------- */
tourStopRouter.delete(
  "/:id",
  authenticate,
  isAdmin,
  [param("id").isString().trim().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteTourStop(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      if (String(error.message || "").includes("TourStop nicht gefunden")) {
        return res.status(404).json({ error: "TourStop nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* --------------------------- DELETE ALL (DANGER) ---------------------- */
tourStopRouter.delete(
  "/",
  authenticate,
  isAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      await deleteAllTourStops();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default tourStopRouter;
