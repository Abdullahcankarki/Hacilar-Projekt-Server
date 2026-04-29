import fs from "fs";
import os from "os";
import crypto from "crypto";
import { MACHINE_ID_FILE, ensureLicenseDir } from "./paths";

let cached: string | null = null;

export function getMachineId(): string {
  if (cached) return cached;

  const fromEnv = process.env.LICENSE_MACHINE_ID?.trim();
  if (fromEnv && fromEnv.length >= 8) {
    cached = fromEnv;
    return fromEnv;
  }

  ensureLicenseDir();

  if (fs.existsSync(MACHINE_ID_FILE)) {
    const stored = fs.readFileSync(MACHINE_ID_FILE, "utf8").trim();
    if (/^[a-f0-9]{64}$/.test(stored)) {
      cached = stored;
      return stored;
    }
  }

  const id = computeMachineId();
  fs.writeFileSync(MACHINE_ID_FILE, id, { mode: 0o600 });
  cached = id;
  return id;
}

function computeMachineId(): string {
  const ifaces = os.networkInterfaces();
  let mac = "";
  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!list) continue;
    for (const i of list) {
      if (!i.internal && i.mac && i.mac !== "00:00:00:00:00:00") {
        mac = i.mac;
        break;
      }
    }
    if (mac) break;
  }
  const cpu = os.cpus()[0]?.model ?? "";
  const host = os.hostname();
  const raw = `${mac}|${host}|${cpu}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}
