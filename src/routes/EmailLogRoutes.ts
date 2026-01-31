import express, { Request, Response } from "express";
import { getEmailLogs, getEmailLogPdf } from "../services/EmailLogService";

export const emailLogRouter = express.Router();

/**
 * GET / — Paginierte Liste aller Email-Logs mit optionalen Filtern.
 * Query-Params: page, limit, typ, status, search, from, to
 */
emailLogRouter.get("/", async (req: Request, res: Response) => {
  try {
    const result = await getEmailLogs({
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      typ: req.query.typ as string | undefined,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Fehler beim Laden der Email-Logs" });
  }
});

/**
 * GET /:id/pdf — PDF-Download eines Email-Log-Eintrags.
 */
emailLogRouter.get("/:id/pdf", async (req: Request, res: Response) => {
  try {
    const result = await getEmailLogPdf(req.params.id);
    if (!result) {
      return res.status(404).json({ error: "Kein PDF vorhanden" });
    }
    res.json({ base64: result.base64, filename: result.filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Fehler beim Laden des PDFs" });
  }
});
