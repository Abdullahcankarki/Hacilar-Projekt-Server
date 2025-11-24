import { Router, Request, Response } from "express";
import { authenticate } from "./helper-hooks";
import { query } from "express-validator";
import { validate } from "./helper-hooks";

import {
  getAuftragsOverviewByLieferdatum,
  getUmsatzByRegion,
  getUmsatzByKundenKategorie,
  getUmsatzByArtikelKategorie,
  getTopArtikel,
  getKundenRanking,
  getTourOverview,
  getZerlegeOverview,
} from "../services/StatsService";

export const statsRouter = Router();

/** Helper für DateRange */
function buildRange(req: any) {
  const from = req.query.from ? new Date(req.query.from) : undefined;
  const to = req.query.to ? new Date(req.query.to) : undefined;
  return { from, to };
}


/* -------------------------------------------------------------
   1) AUFTRAGS-OVERVIEW
------------------------------------------------------------- */
statsRouter.get(
  "/overview/auftrag",
  authenticate,
  [
    query("from").optional().isISO8601().withMessage("from muss ein gültiges Datum sein"),
    query("to").optional().isISO8601().withMessage("to muss ein gültiges Datum sein"),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const range = buildRange(req);
      const stats = await getAuftragsOverviewByLieferdatum(range);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* -------------------------------------------------------------
   2) REGIONEN-UMSATZ
------------------------------------------------------------- */
statsRouter.get(
  "/overview/region",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const range = buildRange(req);
      const stats = await getUmsatzByRegion(range);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* -------------------------------------------------------------
   3) KUNDEN-KATEGORIE-UMSATZ
------------------------------------------------------------- */
statsRouter.get(
  "/overview/kategorie",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
  ],
  validate,
  async (req : Request, res: Response) => {
    try {
      const range = buildRange(req);
      const stats = await getUmsatzByKundenKategorie(range);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* -------------------------------------------------------------
   4) ARTIKEL-KATEGORIE-UMSATZ
------------------------------------------------------------- */
statsRouter.get(
  "/overview/artikel-kategorie",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
  ],
  validate,
  async (req : Request, res: Response) => {
    try {
      const range = buildRange(req);
      const stats = await getUmsatzByArtikelKategorie(range);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* -------------------------------------------------------------
   5) TOP-ARTIKEL
------------------------------------------------------------- */
statsRouter.get(
  "/top-artikel",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("limit").optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const range = buildRange(req);
      const limit = req.query.limit ? Number(req.query.limit) : 10;
      const stats = await getTopArtikel(range, limit);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* -------------------------------------------------------------
   6) KUNDEN-RANKING
------------------------------------------------------------- */
statsRouter.get(
  "/kunden-ranking",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("limit").optional().isInt({ min: 1, max: 500 }),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const range = buildRange(req);
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const stats = await getKundenRanking(range, limit);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* -------------------------------------------------------------
   7) TOUR-OVERVIEW
------------------------------------------------------------- */
statsRouter.get(
  "/overview/tour",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const range = buildRange(req);
      const stats = await getTourOverview(range);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* -------------------------------------------------------------
   8) ZERLEGE-OVERVIEW
------------------------------------------------------------- */
statsRouter.get(
  "/overview/zerlege",
  authenticate,
  [
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const range = buildRange(req);
      const stats = await getZerlegeOverview(range);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);


/* -------------------------------------------------------------
   9) GENERISCHE KPI-VERGLEICHSFUNKTION
   Beispiel-Aufruf:
   /compare?kpi=auftrag&fromA=2025-01-01&toA=2025-01-31&fromB=2024-01-01&toB=2024-01-31
------------------------------------------------------------- */
statsRouter.get(
  "/compare",
  authenticate,
  [
    query("kpi").isString().withMessage("kpi ist erforderlich"),
    query("fromA").optional().isISO8601(),
    query("toA").optional().isISO8601(),
    query("fromB").optional().isISO8601(),
    query("toB").optional().isISO8601(),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      const kpi = req.query.kpi as string;

      const rangeA = {
        from: req.query.fromA ? new Date(req.query.fromA as string) : undefined,
        to: req.query.toA ? new Date(req.query.toA as string) : undefined,
      };

      const rangeB = {
        from: req.query.fromB ? new Date(req.query.fromB as string) : undefined,
        to: req.query.toB ? new Date(req.query.toB as string) : undefined,
      };

      let fn: any = null;

      if (kpi === "auftrag") fn = getAuftragsOverviewByLieferdatum;
      else if (kpi === "region") fn = getUmsatzByRegion;
      else if (kpi === "kundenKategorie") fn = getUmsatzByKundenKategorie;
      else if (kpi === "artikelKategorie") fn = getUmsatzByArtikelKategorie;
      else if (kpi === "topArtikel") fn = getTopArtikel;
      else if (kpi === "kundenRanking") fn = getKundenRanking;
      else if (kpi === "tour") fn = getTourOverview;
      else if (kpi === "zerlege") fn = getZerlegeOverview;

      if (!fn) {
        return res.status(400).json({ error: "Ungültiger KPI-Typ" });
      }

      const [resultA, resultB] = await Promise.all([
        fn(rangeA),
        fn(rangeB),
      ]);

      res.json({
        rangeA: resultA,
        rangeB: resultB,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default statsRouter;