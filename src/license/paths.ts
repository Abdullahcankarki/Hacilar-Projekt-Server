import path from "path";
import fs from "fs";

const DIR = path.resolve(process.cwd(), ".license");

export const LICENSE_DIR = DIR;
export const MACHINE_ID_FILE = path.join(DIR, "machine-id");
export const STATE_FILE = path.join(DIR, "state.json");
export const LOG_FILE = path.join(DIR, "license.log");

export function ensureLicenseDir(): void {
  if (!fs.existsSync(DIR)) {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  }
}
