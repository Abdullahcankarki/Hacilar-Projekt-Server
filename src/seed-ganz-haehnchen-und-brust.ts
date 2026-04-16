/**
 * Seed-Script: Ganze Hähnchen + Brust Zerlegung aus Excel importieren.
 *
 * Ausführen:  npx ts-node src/seed-ganz-haehnchen-und-brust.ts
 *
 * Erwartet die beiden Dateien im Projekt-Root (eine Ebene über backend/):
 *   - "Ganze Hähnchen Januar 2026.xlsx"
 *   - "Brust Januar 2026.xlsx"
 *
 * Verhalten:
 *   - Zerleger die in den Excels vorkommen werden (falls nicht vorhanden)
 *     mit der entsprechenden Kategorie angelegt bzw. die Kategorie ergänzt.
 *   - Einträge werden per (datum, zerlegerId) upserted — Re-Run ist idempotent.
 *   - SOLL-Konfigurationen werden aus Zeile 2 der Excel-Tabellen übernommen.
 */
import mongoose from "mongoose";
import path from "path";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
dotenv.config();

import { GefluegelZerleger } from "./model/GefluegelZerlegerModel";
import { GanzHaehnchenEintrag } from "./model/GanzHaehnchenEintragModel";
import { GanzHaehnchenConfig } from "./model/GanzHaehnchenConfigModel";
import { BrustEintrag } from "./model/BrustEintragModel";
import { BrustConfig } from "./model/BrustConfigModel";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const GANZ_FILE = path.join(PROJECT_ROOT, "Ganze Hähnchen Januar 2026.xlsx");
const BRUST_FILE = path.join(PROJECT_ROOT, "Brust Januar 2026.xlsx");

function toNumber(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return s ? parseFloat(s[0]) : 0;
}

function toKisten(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Math.round(v);
  const s = String(v).match(/\d+/);
  return s ? parseInt(s[0], 10) : 0;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === "number") {
    // Excel serial date → JS Date (xlsx typically converts already, aber falls nicht)
    const utcDays = Math.floor(v - 25569);
    const ms = utcDays * 86400 * 1000;
    return new Date(ms);
  }
  const parsed = new Date(v);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function cleanName(v: any): string {
  return String(v ?? "").trim();
}

async function ensureZerleger(name: string, kategorie: string): Promise<string> {
  if (!name) return "";
  const existing = await GefluegelZerleger.findOne({ name });
  if (existing) {
    if (!existing.kategorien.includes(kategorie as any)) {
      existing.kategorien = [...existing.kategorien, kategorie as any];
      await existing.save();
      console.log(`  Zerleger '${name}': Kategorie '${kategorie}' ergänzt`);
    }
    return existing._id.toString();
  }
  const created = await GefluegelZerleger.create({
    name,
    kategorien: [kategorie],
    aktiv: true,
    reihenfolge: 9999,
  });
  console.log(`  Zerleger '${name}' neu angelegt (${kategorie})`);
  return created._id.toString();
}

async function importGanzHaehnchen() {
  console.log("\n== Ganz Hähnchen ==");
  const wb = XLSX.readFile(GANZ_FILE, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  // Row 1 (index 1) has SOLL, Row 2 (index 2) has header, Data starts at row 3 (index 3)
  const sollRow = rows[1] ?? [];
  const sollBrust = toNumber(sollRow[4]) || 0.436;
  const sollKeule = toNumber(sollRow[5]) || 0.358;
  const sollFluegel = toNumber(sollRow[6]) || 0.087;

  await GanzHaehnchenConfig.findOneAndUpdate(
    { key: "singleton" },
    { key: "singleton", sollBrust, sollKeule, sollFluegel },
    { upsert: true, new: true }
  );
  console.log(`  Config: Brust=${(sollBrust * 100).toFixed(1)}%  Keule=${(sollKeule * 100).toFixed(1)}%  Flügel=${(sollFluegel * 100).toFixed(1)}%`);

  let imported = 0;
  let skipped = 0;
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const datum = toDate(row[0]);
    const name = cleanName(row[1]);
    if (!datum || !name) {
      skipped++;
      continue;
    }

    const anzahlKisten = toKisten(row[2]);
    const gewichtGesamt = toNumber(row[3]);
    const brust = toNumber(row[4]);
    const keule = toNumber(row[5]);
    const fluegel = toNumber(row[6]);
    const kosten = row[13] ? String(row[13]).trim() : undefined;

    if (gewichtGesamt === 0) {
      skipped++;
      continue;
    }

    const zerlegerId = await ensureZerleger(name, "ganz_haehnchen");

    await GanzHaehnchenEintrag.findOneAndUpdate(
      { datum, zerlegerId },
      {
        datum,
        zerlegerId,
        zerlegerName: name,
        anzahlKisten,
        gewichtGesamt,
        brust,
        keule,
        fluegel,
        kosten,
      },
      { upsert: true, new: true }
    );
    imported++;
  }
  console.log(`  ${imported} Einträge importiert (${skipped} übersprungen).`);
}

async function importBrust() {
  console.log("\n== Brust ==");
  const wb = XLSX.readFile(BRUST_FILE, { cellDates: true });
  const sheetName = wb.SheetNames.find((n) => /januar|tabelle1/i.test(n)) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  const sollRow = rows[1] ?? [];
  const sollMitHaut = toNumber(sollRow[4]) || 0.9;
  const sollOhneHaut = toNumber(sollRow[7]) || 0.81;
  const sollHaut = toNumber(sollRow[10]) || 0.09;

  await BrustConfig.findOneAndUpdate(
    { key: "singleton" },
    { key: "singleton", sollMitHaut, sollOhneHaut, sollHaut },
    { upsert: true, new: true }
  );
  console.log(`  Config: mitHaut=${(sollMitHaut * 100).toFixed(1)}%  ohneHaut=${(sollOhneHaut * 100).toFixed(1)}%  Haut=${(sollHaut * 100).toFixed(1)}%`);

  let imported = 0;
  let skipped = 0;
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const datum = toDate(row[0]);
    const name = cleanName(row[1]);
    if (!datum || !name) {
      skipped++;
      continue;
    }

    const anzahlKisten = toKisten(row[2]);
    const gewichtMitKnochen = toNumber(row[3]);
    const brustMitHaut = toNumber(row[4]);
    const brustOhneHaut = toNumber(row[7]);
    const haut = toNumber(row[10]);
    const kosten = row[13] ? String(row[13]).trim() : undefined;

    if (gewichtMitKnochen === 0) {
      skipped++;
      continue;
    }

    const zerlegerId = await ensureZerleger(name, "brust");

    await BrustEintrag.findOneAndUpdate(
      { datum, zerlegerId },
      {
        datum,
        zerlegerId,
        zerlegerName: name,
        anzahlKisten,
        gewichtMitKnochen,
        brustMitHaut,
        brustOhneHaut,
        haut,
        kosten,
      },
      { upsert: true, new: true }
    );
    imported++;
  }
  console.log(`  ${imported} Einträge importiert (${skipped} übersprungen).`);
}

async function main() {
  const dbUrl = process.env.DB_CONNECTION_STRING;
  if (!dbUrl) {
    console.error("DB_CONNECTION_STRING nicht gesetzt!");
    process.exit(1);
  }

  await mongoose.connect(dbUrl);
  console.log("DB verbunden.");

  try {
    await importGanzHaehnchen();
    await importBrust();
    console.log("\nImport abgeschlossen.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
