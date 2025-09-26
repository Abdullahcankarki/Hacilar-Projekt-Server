// backend/src/routes/tour.routes.ts
import { Router, Response } from "express";
import { body, param, query } from "express-validator";
import { DateTime } from "luxon";

import {
  createTour,
  getTourById,
  listTours,
  updateTour,
  deleteTour,
  deleteAllTours,
  archiveTour,
  unarchiveTour,
  backfillTourDatumIso,
} from "../services/TourService";
import { authenticate, AuthRequest, isAdmin, validate } from "./helper-hooks";

const tourRouter = Router();

const isISODate = (v: any) => !Number.isNaN(new Date(v).valueOf());
const tourStatus = ["geplant", "laufend", "abgeschlossen", "archiviert"];

function toISODateBerlinSafe(input: any): string | null {
  if (!input) return null;
  const Z = "Europe/Berlin" as const;

  // 1) Direkter Date-Input (nach Schema-Umstellung ist tour.datum ein echtes Date)
  if (input instanceof Date && !Number.isNaN(input.valueOf())) {
    const dt = DateTime.fromJSDate(input, { zone: Z });
    return dt.isValid ? dt.toISODate() : null;
  }

  // 2) ISO-String o.ä.
  let dt = DateTime.fromISO(String(input), { zone: Z });
  if (!dt.isValid) dt = DateTime.fromFormat(String(input), "dd.LL.yyyy", { zone: Z });
  if (!dt.isValid) dt = DateTime.fromFormat(String(input), "yyyyLLdd", { zone: Z });
  if (!dt.isValid) {
    const js = new Date(String(input));
    if (!Number.isNaN(js.valueOf())) dt = DateTime.fromJSDate(js, { zone: Z });
  }
  return dt.isValid ? dt.toISODate() : null;
}

// Middleware: Admin always; Driver only if assigned to the tour and tour date is today (Europe/Berlin)
async function canEditTour(req: AuthRequest, res: Response, next: Function) {
  try {
    const user = req.user as any;
    if (user?.role.includes("admin") ) {
      // Admin: full set of allowed fields
      (req as any).allowedFieldsForRole = [
        "datum",
        "region",
        "name",
        "status",
        "fahrzeugId",
        "fahrerId",
        "maxGewichtKg",
        "reihenfolgeVorlageId",
        "isStandard",
        "parentTourId",
        "splitIndex",
        "archiviertAm",
      ];
      return next();
    }

    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "ID ist erforderlich" });

    let tour;
    try {
      tour = await getTourById(id);
    } catch (e: any) {
      return res.status(404).json({ error: "Tour nicht gefunden" });
    }
    if (!tour) return res.status(404).json({ error: "Tour nicht gefunden" });

    const isOwn =
      String(tour.fahrerId || "") === String(user?._id || user?.id || "");
    const todayBerlin = DateTime.now().setZone("Europe/Berlin").toISODate();
    const tourDate = toISODateBerlinSafe((tour as any).datum);
    const isToday = !!todayBerlin && !!tourDate && todayBerlin === tourDate;

    if (!isOwn || !isToday) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Fahrer: nur sichere Felder (z. B. Statusänderung)
    (req as any).allowedFieldsForRole = ["status"]; // ggf. erweitern, wenn gewünscht
    return next();
  } catch (err: any) {
    console.error("canEditTour error:", err);
    return res.status(500).json({ error: err.message });
  }
}


tourRouter.patch(
  "/lalalolo",
  authenticate,
  isAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const result = await backfillTourDatumIso();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- CREATE ------------------------------- */
tourRouter.post(
  "/",
  authenticate,
  isAdmin,
  [
    body("datum")
      .exists()
      .withMessage("datum ist erforderlich")
      .custom(isISODate)
      .withMessage("datum muss ein gültiges Datum sein"),
    body("region")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("region ist erforderlich"),
    body("name").optional().isString().trim(),
    body("fahrzeugId").optional().isString().trim(),
    body("fahrerId").optional().isString().trim(),
    body("maxGewichtKg")
      .optional()
      .isNumeric()
      .withMessage("maxGewichtKg muss eine Zahl sein"),
    body("status")
      .optional()
      .isIn(tourStatus)
      .withMessage(`status muss eines von ${tourStatus.join(", ")} sein`),
    body("reihenfolgeVorlageId").optional().isString().trim(),
    body("isStandard").optional().isBoolean().toBoolean(),
    body("parentTourId").optional().isString().trim(),
    body("splitIndex").optional().isInt({ min: 1 }).toInt(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createTour(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* -------------------------------- READ -------------------------------- */
tourRouter.get(
  "/:id",
  authenticate,
  [param("id").isString().notEmpty().withMessage("ID ist erforderlich")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getTourById(req.params.id);
      if (!result)
        return res.status(404).json({ error: "Tour nicht gefunden" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------ LIST/QUERY ---------------------------- */
tourRouter.get(
  "/",
  authenticate,
  [
    query("dateFrom")
      .optional()
      .custom(isISODate)
      .withMessage("dateFrom muss ein gültiges Datum sein"),
    query("dateTo")
      .optional()
      .custom(isISODate)
      .withMessage("dateTo muss ein gültiges Datum sein"),
    query("region").optional().isString().trim(),
    // status kann als Komma-String oder als Array kommen; beide Fälle validieren
    query("status")
      .optional()
      .custom((v) => {
        if (Array.isArray(v)) {
          return v.every((x) => tourStatus.includes(String(x)));
        }
        const arr = String(v)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return arr.every((x) => tourStatus.includes(x));
      })
      .withMessage(`status muss eines von ${tourStatus.join(", ")} sein (einzeln oder kommasepariert)`),
    query("status[]")
      .optional()
      .custom((v) => {
        const arr = Array.isArray(v) ? v : [v];
        return arr.every((x) => tourStatus.includes(String(x)));
      })
      .withMessage(`status[] muss nur Werte aus ${tourStatus.join(", ")} enthalten`),
    query("fahrzeugId").optional().isString().trim(),
    query("fahrerId").optional().isString().trim(),
    query("isStandard").optional().isBoolean().toBoolean(),
    query("q").optional().isString().trim(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 200 }).toInt(),
    query("sort").optional().isIn(["datumAsc", "datumDesc", "createdDesc"]),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Unterstützung sowohl für status als string als auch Array (status[])
      let statusParam: any = (req.query as any).status;
      const statusArray = (req.query as any)["status[]"];
      if (Array.isArray(statusArray) && statusArray.length) {
        statusParam = statusArray;
      }

      const result = await listTours({
        dateFrom: req.query.dateFrom as any,
        dateTo: req.query.dateTo as any,
        region: req.query.region as any,
        status: statusParam,
        fahrzeugId: req.query.fahrzeugId as any,
        fahrerId: req.query.fahrerId as any,
        isStandard:
          req.query.isStandard === undefined
            ? undefined
            : (req.query.isStandard as any),
        q: req.query.q as any,
        page: (req.query.page as any) ?? 1,
        limit: (req.query.limit as any) ?? 50,
        sort: (req.query.sort as any) ?? "datumAsc",
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- UPDATE ------------------------------- */
tourRouter.patch(
  "/:id",
  authenticate,
  canEditTour,
  [
    param("id").isString().notEmpty(),
    body().custom((value, { req }) => {
      if (!value || typeof value !== "object")
        throw new Error("Body erforderlich");
      const fallbackAllowed = [
        "datum",
        "region",
        "name",
        "fahrzeugId",
        "fahrerId",
        "maxGewichtKg",
        "status",
        "reihenfolgeVorlageId",
        "isStandard",
        "parentTourId",
        "splitIndex",
        "archiviertAm",
      ];
      const allowed: string[] =
        (req as any).allowedFieldsForRole || fallbackAllowed;
      const keys = Object.keys(value);
      if (!keys.some((k) => allowed.includes(k))) {
        throw new Error("Mindestens ein gültiges Feld muss übergeben werden");
      }
      // Keine verbotenen Felder zulassen
      for (const k of keys) {
        if (!allowed.includes(k)) throw new Error(`Feld nicht erlaubt: ${k}`);
      }
      return true;
    }),
    body("datum").optional().custom(isISODate),
    body("region").optional().isString().trim().notEmpty(),
    body("name").optional().isString().trim(),
    body("fahrzeugId").optional().isString().trim(),
    body("fahrerId").optional().isString().trim(),
    body("maxGewichtKg").optional().isNumeric(),
    body("status").optional().isIn(tourStatus),
    body("reihenfolgeVorlageId").optional().isString().trim(),
    body("isStandard").optional().isBoolean().toBoolean(),
    body("parentTourId").optional().isString().trim(),
    body("splitIndex").optional().isInt({ min: 1 }).toInt(),
    body("archiviertAm").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateTour(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("Tour nicht gefunden")) {
        return res.status(404).json({ error: "Tour nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------ ARCHIVE/RESTORE ----------------------------- */
tourRouter.post(
  "/:id/archive",
  authenticate,
  isAdmin,
  [param("id").isString().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await archiveTour(req.params.id);
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("Tour nicht gefunden")) {
        return res.status(404).json({ error: "Tour nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

tourRouter.post(
  "/:id/unarchive",
  authenticate,
  isAdmin,
  [param("id").isString().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await unarchiveTour(req.params.id);
      res.json(result);
    } catch (error: any) {
      if (String(error.message || "").includes("Tour nicht gefunden")) {
        return res.status(404).json({ error: "Tour nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* ------------------------------- DELETE ------------------------------- */
tourRouter.delete(
  "/:id",
  authenticate,
  isAdmin,
  [param("id").isString().notEmpty()],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteTour(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      if (String(error.message || "").includes("Tour nicht gefunden")) {
        return res.status(404).json({ error: "Tour nicht gefunden" });
      }
      res.status(500).json({ error: error.message });
    }
  }
);

/* --------------------------- DELETE ALL (DANGER) ---------------------- */
tourRouter.delete(
  "/",
  authenticate,
  isAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      await deleteAllTours();
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default tourRouter;
