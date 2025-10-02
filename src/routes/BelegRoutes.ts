import express, { Request, Response } from "express";
import { body, param } from "express-validator";
import {
  generateBelegPdf,
  addBelegToAuftrag,
  logEmailVersand,
  getBelegeForAuftrag,
  getEmailLogsForAuftrag,
} from "../services/BelegService";
import { BelegResource, BelegTyp } from "../Resources";
import { validate } from "./helper-hooks";

export const belegRouter = express.Router();

/**
 * PDF eines Belegs generieren
 * Für Rechnung und Lieferschein: Daten aus Auftrag.
 * Für Gutschrift und Preisdifferenz: Input erforderlich.
 */
belegRouter.post(
  "/:auftragId/:typ/pdf",
  [
    param("auftragId").isString().notEmpty(),
    param("typ").isIn(["lieferschein", "rechnung", "gutschrift", "preisdifferenz"]),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { auftragId, typ } = req.params;
    const inputData = req.body as Partial<BelegResource>;
    try {
      const pdfBuffer = await generateBelegPdf(auftragId, typ as BelegTyp, inputData);
      res.setHeader("Content-Type", "application/pdf");
      res.send(pdfBuffer);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * Beleg in Auftrag eintragen
 */
belegRouter.post(
  "/:auftragId/add",
  [
    param("auftragId").isString().notEmpty(),
    body("typ").isIn(["lieferschein", "rechnung", "gutschrift", "preisdifferenz"]),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { auftragId } = req.params;
    const belegData = req.body as BelegResource;
    try {
      const beleg = await addBelegToAuftrag(auftragId, belegData);
      res.json(beleg);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * E-Mail-Versand protokollieren
 */
belegRouter.post(
  "/:auftragId/email-log",
  [
    param("auftragId").isString().notEmpty(),
    body("belegTyp").isIn(["lieferschein", "rechnung", "gutschrift", "preisdifferenz"]),
    body("empfaenger").isArray({ min: 1 }),
    body("status").isIn(["geplant", "gesendet", "fehlgeschlagen"]),
  ],
  validate,
  async (req: Request, res: Response) => {
    const { auftragId } = req.params;
    try {
      const log = await logEmailVersand(auftragId, req.body);
      res.json(log);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * Alle Belege eines Auftrags abrufen
 */
belegRouter.get(
  "/:auftragId",
  [param("auftragId").isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    const { auftragId } = req.params;
    try {
      const belege = await getBelegeForAuftrag(auftragId);
      res.json(belege);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * Alle E-Mail-Logs eines Auftrags abrufen
 */
belegRouter.get(
  "/:auftragId/email-logs",
  [param("auftragId").isString().notEmpty()],
  validate,
  async (req: Request, res: Response) => {
    const { auftragId } = req.params;
    try {
      const logs = await getEmailLogsForAuftrag(auftragId);
      res.json(logs);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);