import fs from "fs";
import { STATE_FILE, ensureLicenseDir } from "./paths";

export interface LicenseState {
  licenseKey: string;
  token: string;
  validUntil: string;
  lastValidatedAt: string;
}

let cached: LicenseState | null = null;

export function readState(): LicenseState | null {
  if (cached) return cached;
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<LicenseState>;
    if (
      parsed &&
      typeof parsed.licenseKey === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.validUntil === "string" &&
      typeof parsed.lastValidatedAt === "string"
    ) {
      cached = parsed as LicenseState;
      return cached;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeState(s: LicenseState): void {
  ensureLicenseDir();
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
  cached = s;
}

export function clearStateCache(): void {
  cached = null;
}
