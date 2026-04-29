import express, { Request, Response } from "express";
import { LICENSE_KEY_REGEX } from "../license/constants";
import { activate, getStatus } from "../license/manager";
import { logLicenseEvent } from "../license/errorLogger";

const router = express.Router();

router.get("/status", (_req: Request, res: Response) => {
  const s = getStatus();
  res.json({
    ok: s.status === "valid",
    hasKey: s.hasKey,
    validUntil: s.status === "valid" ? s.validUntil : undefined,
  });
});

router.post("/activate", async (req: Request, res: Response) => {
  const licenseKey = typeof req.body?.licenseKey === "string" ? req.body.licenseKey.trim().toUpperCase() : "";
  if (!LICENSE_KEY_REGEX.test(licenseKey)) {
    logLicenseEvent("activate_invalid_format", { licenseKey });
    res.status(400).json({ error: "5005" });
    return;
  }
  try {
    await activate(licenseKey);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "5005" });
  }
});

export default router;
