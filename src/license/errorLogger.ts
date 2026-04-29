import winston from "winston";
import { LOG_FILE, ensureLicenseDir } from "./paths";

ensureLicenseDir();

export const licenseLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: LOG_FILE, maxsize: 1_000_000, maxFiles: 3 }),
  ],
});

export function logLicenseEvent(
  event: string,
  fields: { licenseKey?: string; reason?: string; machineId?: string; extra?: unknown } = {}
): void {
  const { licenseKey, reason, machineId, extra } = fields;
  licenseLogger.info(event, {
    licenseKey: licenseKey ? maskKey(licenseKey) : undefined,
    reason,
    machineId,
    extra,
  });
}

function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 4) + "-***-***-" + key.slice(-4);
}
