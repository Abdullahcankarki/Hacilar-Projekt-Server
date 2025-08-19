// backend/src/services/RegionRuleService.ts
import { FilterQuery } from "mongoose";
import { RegionRule as RegionRuleModel } from "../model/RegionRuleModel";
import { RegionRuleResource } from "src/Resources";

/* ------------------------------- Helpers ------------------------------- */

const WEEKDAY_NUM_TO_DE: Record<number, string> = {
  1: "Montag",
  2: "Dienstag",
  3: "Mittwoch",
  4: "Donnerstag",
  5: "Freitag",
  6: "Samstag",
  7: "Sonntag",
};

const WEEKDAY_DE_TO_NUM: Record<string, number> = Object.fromEntries(
  Object.entries(WEEKDAY_NUM_TO_DE).map(([num, de]) => [de, Number(num)])
);

function normalizeRegion(v?: string | null): string {
  return (v ?? "").trim();
}

function normalizeWeekdays(nums?: number[] | null): number[] {
  if (!nums) return [];
  // einzigartig + sortiert + gültig (1..7)
  const set = new Set(nums.map((n) => Number(n)).filter((n) => n >= 1 && n <= 7));
  return Array.from(set).sort((a, b) => a - b);
}

function toGermanWeekdays(nums: number[]): string[] {
  return nums.map((n) => WEEKDAY_NUM_TO_DE[n]).filter(Boolean);
}

function toWeekdayNumbers(deNames?: string[] | null): number[] {
  if (!deNames) return [];
  const nums = deNames
    .map((name) => (name ?? "").trim())
    .filter(Boolean)
    .map((name) => WEEKDAY_DE_TO_NUM[name])
    .filter((n) => typeof n === "number");
  return normalizeWeekdays(nums);
}

function isValidCutoffHHmm(s?: string): boolean {
  if (!s) return true; // optional
  // erlaubt "HH:mm" 00:00..23:59
  return /^[0-1]\d:[0-5]\d$|^2[0-3]:[0-5]\d$/.test(s);
}

function normalizeExceptionDates(dates?: string[] | null): string[] | undefined {
  if (!dates) return undefined;
  const cleaned = Array.from(
    new Set(
      dates
        .map((d) => (d ?? "").trim())
        .filter(Boolean)
        // einfache Val: YYYY-MM-DD
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    )
  ).sort();
  return cleaned.length ? cleaned : undefined;
}

function toResource(doc: any): RegionRuleResource {
  // Falls dein Model bereits numeric speichert, passe hier an.
  const allowedWeekdays = doc.allowedWeekdays
    ? normalizeWeekdays(doc.allowedWeekdays)
    : toWeekdayNumbers(doc.erlaubteTage);

  return {
    id: doc._id.toString(),
    region: doc.region,
    allowedWeekdays,
    orderCutoff: doc.orderCutoff ?? undefined, // z. B. "14:00"
    exceptionDates: doc.exceptionDates ?? undefined,
    isActive: !!doc.aktiv, // Kompatibilität zum bestehenden Feldnamen
  };
}

/* --------------------------------- CRUD -------------------------------- */

/**
 * Neue Region-Rule anlegen.
 * Speichert:
 *  - `erlaubteTage` als deutsche Namen (Kompatibilität zu validateRegionRuleOrThrow)
 *  - optional zusätzlich `allowedWeekdays` als Zahlen (falls du das Feld im Schema hast)
 */
export async function createRegionRule(data: {
  region: string;
  allowedWeekdays: number[];
  orderCutoff?: string;
  exceptionDates?: string[];
  isActive?: boolean;
}): Promise<RegionRuleResource> {
  const region = normalizeRegion(data.region);
  const allowedWeekdays = normalizeWeekdays(data.allowedWeekdays);
  if (!allowedWeekdays.length) {
    throw new Error("allowedWeekdays darf nicht leer sein (1=Mo ... 7=So).");
  }
  if (!isValidCutoffHHmm(data.orderCutoff)) {
    throw new Error('orderCutoff muss im Format "HH:mm" sein (z. B. "14:00").');
  }

  const doc = await new RegionRuleModel({
    region,
    aktiv: data.isActive ?? true,
    // Kompatibel zu deiner bestehenden Validierung:
    erlaubteTage: toGermanWeekdays(allowedWeekdays),
    // Optional: parallel numeric speichern, falls im Schema vorhanden:
    allowedWeekdays: allowedWeekdays,
    orderCutoff: data.orderCutoff ?? null,
    exceptionDates: normalizeExceptionDates(data.exceptionDates) ?? [],
  }).save();

  return toResource(doc);
}

/**
 * Einzelne Regel laden.
 */
export async function getRegionRuleById(id: string): Promise<RegionRuleResource | null> {
  const doc = await RegionRuleModel.findById(id);
  return doc ? toResource(doc) : null;
}

/**
 * Regeln auflisten (Filter + Pagination).
 */
export async function listRegionRules(params?: {
  active?: boolean;
  region?: string;
  q?: string;     // Freitext auf region
  page?: number;
  limit?: number;
}): Promise<{ items: RegionRuleResource[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  const skip = (page - 1) * limit;

  const filter: FilterQuery<any> = {};
  if (typeof params?.active === "boolean") filter.aktiv = params.active;
  if (params?.region) filter.region = params.region.trim();

  if (params?.q) {
    const q = params.q.trim();
    filter.$or = [{ region: { $regex: q, $options: "i" } }];
  }

  const [docs, total] = await Promise.all([
    RegionRuleModel.find(filter).sort({ region: 1 }).skip(skip).limit(limit),
    RegionRuleModel.countDocuments(filter),
  ]);

  return {
    items: docs.map(toResource),
    total,
    page,
    limit,
  };
}

/**
 * Regel aktualisieren (teilweise).
 * Achtung: hält `erlaubteTage` (de-Namen) und `allowedWeekdays` (Zahlen) synchron,
 * damit deine bestehende Prüfung (per deutschen Namen) weiter funktioniert.
 */
export async function updateRegionRule(
  id: string,
  patch: Partial<Pick<RegionRuleResource, "region" | "allowedWeekdays" | "orderCutoff" | "exceptionDates" | "isActive">>
): Promise<RegionRuleResource> {
  const update: any = {};

  if (patch.region !== undefined) update.region = normalizeRegion(patch.region);

  if (patch.allowedWeekdays !== undefined) {
    const allowedWeekdays = normalizeWeekdays(patch.allowedWeekdays);
    if (!allowedWeekdays.length) {
      throw new Error("allowedWeekdays darf nicht leer sein (1=Mo ... 7=So).");
    }
    update.allowedWeekdays = allowedWeekdays;              // optionales numeric Feld
    update.erlaubteTage = toGermanWeekdays(allowedWeekdays); // für bestehende Validierung
  }

  if (patch.orderCutoff !== undefined) {
    if (!isValidCutoffHHmm(patch.orderCutoff)) {
      throw new Error('orderCutoff muss im Format "HH:mm" sein (z. B. "14:00").');
    }
    update.orderCutoff = patch.orderCutoff ?? null;
  }

  if (patch.exceptionDates !== undefined) {
    update.exceptionDates = normalizeExceptionDates(patch.exceptionDates) ?? [];
  }

  if (patch.isActive !== undefined) {
    update.aktiv = !!patch.isActive;
  }

  const doc = await RegionRuleModel.findByIdAndUpdate(id, update, { new: true });
  if (!doc) throw new Error("RegionRule nicht gefunden");

  return toResource(doc);
}

/**
 * Regel löschen.
 */
export async function deleteRegionRule(id: string): Promise<void> {
  const deleted = await RegionRuleModel.findByIdAndDelete(id);
  if (!deleted) throw new Error("RegionRule nicht gefunden");
}

/**
 * Alle Regeln löschen.
 */
export async function deleteAllRegionRules(): Promise<void> {
  await RegionRuleModel.deleteMany({});
}
