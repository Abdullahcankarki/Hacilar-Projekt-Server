import { FilterQuery, Types } from "mongoose";
import { ReservierungModel } from "../../model/ReservierungModel";
import { ArtikelModel } from "../../model/ArtikelModel";
import { Auftrag } from "../../model/AuftragModel";
import { Kunde as KundeModel } from "../../model/KundeModel";
import { ReservierungResource } from "src/Resources";

/* --------------------------------- Helpers -------------------------------- */

function toISODate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

function parseISODateRequired(s: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error("Ungültiges Datum: " + s);
  // normalize to start of day for safer Vergleiche (optional)
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeNumber(n: number): number {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) throw new Error("Menge muss > 0 sein");
  return v;
}

async function denormArtikel(artikelId: string): Promise<{
  artikelName?: string;
  artikelNummer?: string;
}> {
  const a = await ArtikelModel.findById(artikelId).select({
    name: 1,
    artikelNummer: 1,
  });
  return a
    ? { artikelName: a.name ?? undefined, artikelNummer: a.artikelNummer ?? undefined }
    : {};
}

async function denormAuftragKunde(auftragId: string): Promise<{
  kundeName?: string;
  lieferDatumFromAuftrag?: string;
}> {
  const auftrag = await Auftrag.findById(auftragId).select({
    kunde: 1,
    kundeName: 1,
    lieferdatum: 1,
  });

  if (!auftrag) return {};

  // kundeName: bevorzugt aus Auftrag (denormalisiert), sonst Kundenstammdaten
  let kundeName = auftrag.kundeName as string | undefined;

  if (!kundeName && auftrag.kunde) {
    const kd = await KundeModel.findById(auftrag.kunde).select({ name: 1 });
    kundeName = kd?.name ?? undefined;
  }

  // lieferdatum im Auftrag ist evtl. ISO String
  const lieferDatumFromAuftrag = auftrag.lieferdatum
    ? new Date(auftrag.lieferdatum).toISOString().slice(0, 10)
    : undefined;

  return { kundeName, lieferDatumFromAuftrag };
}

function toResource(doc: any): ReservierungResource {
  return {
    id: doc._id.toString(),
    artikelId: doc.artikelId?.toString(),
    artikelName: doc.artikelName ?? undefined,
    artikelNummer: doc.artikelNummer ?? undefined,
    auftragId: doc.auftragId?.toString(),
    kundeName: doc.kundeName ?? undefined,
    lieferDatumText: doc.lieferDatumText ?? undefined,
    chargeId: doc.chargeId ? doc.chargeId.toString() : undefined,
    lieferDatum: toISODate(doc.lieferDatum)?.slice(0, 10)!, // YYYY-MM-DD
    menge: Number(doc.menge),
    status: doc.status,
    createdAt: toISODate(doc.createdAt),
    createdBy: doc.createdBy ? doc.createdBy.toString() : undefined,
  };
}

/* ---------------------------------- DTOs ---------------------------------- */

export type CreateReservierungDTO = {
  artikelId: string;
  auftragId: string;
  lieferDatum: string; // ISO YYYY-MM-DD
  menge: number;
  chargeId?: string;   // optional, falls du doch vorbindest
};

export type UpdateReservierungDTO = Partial<{
  artikelId: string;
  auftragId: string;
  lieferDatum: string; // ISO YYYY-MM-DD
  menge: number;
  chargeId: string | null;
  status: "AKTIV" | "ERFUELLT" | "AUFGELOEST";
}>;

export type CancelReservierungDTO = { grund?: string };

/**
 * Teil-Erfüllung: reduziert Menge oder setzt bei exakt erfüllter Menge den Status auf ERFUELLT.
 * Alternativ kannst du Teil-Erfüllungen auch ausschließlich über die Kommissionierung abbilden.
 */
export type PartialFulfillDTO = {
  reservierungId: string;
  mengeErfuellt: number; // >0
};

/* ---------------------------------- CRUD ---------------------------------- */

/**
 * Reservierung anlegen.
 * - Denormalisiert artikelName/Nummer & kundeName & lieferDatumText.
 * - Hinweis: Keine Bestandsveränderung hier. Aggregation der Reservierungen erfolgt später über Queries.
 */
export async function createReservierung(
  data: CreateReservierungDTO,
  userId?: string
): Promise<ReservierungResource> {
  const menge = normalizeNumber(data.menge);
  const lieferDatumDate = parseISODateRequired(data.lieferDatum);

  const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);
  const { kundeName, lieferDatumFromAuftrag } = await denormAuftragKunde(data.auftragId);

  const doc = await new ReservierungModel({
    artikelId: new Types.ObjectId(data.artikelId),
    artikelName,
    artikelNummer,
    auftragId: new Types.ObjectId(data.auftragId),
    kundeName,
    lieferDatumText: lieferDatumFromAuftrag ?? data.lieferDatum, // „schön lesbar“
    lieferDatum: lieferDatumDate,
    chargeId: data.chargeId ? new Types.ObjectId(data.chargeId) : undefined,
    menge,
    status: "AKTIV",
    createdBy: userId ? new Types.ObjectId(userId) : undefined,
  }).save();

  return toResource(doc);
}

/**
 * Eine Reservierung laden.
 */
export async function getReservierungById(id: string): Promise<ReservierungResource | null> {
  const doc = await ReservierungModel.findById(id);
  return doc ? toResource(doc) : null;
}

/**
 * Reservierungen auflisten.
 */
export async function listReservierungen(params?: {
  artikelId?: string;
  auftragId?: string;
  status?: "AKTIV" | "ERFUELLT" | "AUFGELOEST";
  lieferDatumFrom?: string;
  lieferDatumTo?: string;
  q?: string;     // sucht in artikelName/Nummer/kundeName
  page?: number;
  limit?: number;
}): Promise<{ items: ReservierungResource[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params?.page ?? 1);
  const totalDocsAll = await ReservierungModel.estimatedDocumentCount();
  const limit =
    params?.limit !== undefined
      ? Math.min(200, Math.max(1, params?.limit ?? 50))
      : totalDocsAll;
  const skip = (page - 1) * limit;

  const filter: FilterQuery<any> = {};
  if (params?.artikelId) filter.artikelId = params.artikelId;
  if (params?.auftragId) filter.auftragId = params.auftragId;
  if (params?.status) filter.status = params.status;

  if (params?.lieferDatumFrom || params?.lieferDatumTo) {
    filter.lieferDatum = {};
    if (params.lieferDatumFrom)
      filter.lieferDatum.$gte = parseISODateRequired(params.lieferDatumFrom);
    if (params.lieferDatumTo) {
      const end = new Date(params.lieferDatumTo);
      end.setHours(23, 59, 59, 999);
      filter.lieferDatum.$lte = end;
    }
  }

  if (params?.q) {
    const q = params.q.trim();
    filter.$or = [
      { artikelName: { $regex: q, $options: "i" } },
      { artikelNummer: { $regex: q, $options: "i" } },
      { kundeName: { $regex: q, $options: "i" } },
    ];
  }

  const [docs, total] = await Promise.all([
    ReservierungModel.find(filter)
      .sort({ lieferDatum: 1, createdAt: 1 })
      .skip(skip)
      .limit(limit),
    ReservierungModel.countDocuments(filter),
  ]);

  return {
    items: docs.map(toResource),
    total,
    page,
    limit,
  };
}

/**
 * Reservierung aktualisieren (partielle Updates).
 * - Bei artikelId/auftragId Änderungen werden Denormalisierungen nachgezogen.
 */
export async function updateReservierung(
  id: string,
  patch: UpdateReservierungDTO
): Promise<ReservierungResource> {
  const update: any = {};

  if (patch.artikelId !== undefined) {
    update.artikelId = new Types.ObjectId(patch.artikelId);
    const { artikelName, artikelNummer } = await denormArtikel(patch.artikelId);
    update.artikelName = artikelName ?? null;
    update.artikelNummer = artikelNummer ?? null;
  }
  if (patch.auftragId !== undefined) {
    update.auftragId = new Types.ObjectId(patch.auftragId);
    const { kundeName, lieferDatumFromAuftrag } = await denormAuftragKunde(patch.auftragId);
    update.kundeName = kundeName ?? null;
    if (lieferDatumFromAuftrag) update.lieferDatumText = lieferDatumFromAuftrag;
  }
  if (patch.lieferDatum !== undefined) {
    update.lieferDatum = parseISODateRequired(patch.lieferDatum);
    update.lieferDatumText = patch.lieferDatum; // menschenlesbar
  }
  if (patch.menge !== undefined) update.menge = normalizeNumber(patch.menge);
  if (patch.chargeId !== undefined)
    update.chargeId = patch.chargeId ? new Types.ObjectId(patch.chargeId) : null;
  if (patch.status !== undefined) update.status = patch.status;

  const doc = await ReservierungModel.findByIdAndUpdate(id, update, { new: true });
  if (!doc) throw new Error("Reservierung nicht gefunden");

  return toResource(doc);
}

/**
 * Reservierung stornieren/auflösen.
 */
export async function cancelReservierung(id: string, _data?: CancelReservierungDTO, _userId?: string): Promise<void> {
  const doc = await ReservierungModel.findById(id);
  if (!doc) throw new Error("Reservierung nicht gefunden");
  if (doc.status !== "AKTIV") return; // idempotent
  doc.status = "AUFGELOEST";
  await doc.save();
}

/**
 * (Optional) Teil-Erfüllung: Menge reduzieren oder Status setzen.
 * Tipp: In vielen Systemen erledigt die Kommissionierung das implizit.
 */
export async function partialFulfillReservierung(data: PartialFulfillDTO): Promise<ReservierungResource> {
  const { reservierungId, mengeErfuellt } = data;
  const doc = await ReservierungModel.findById(reservierungId);
  if (!doc) throw new Error("Reservierung nicht gefunden");
  if (doc.status !== "AKTIV") return toResource(doc);

  const m = Number(mengeErfuellt);
  if (!isFinite(m) || m <= 0) throw new Error("mengeErfuellt muss > 0 sein");

  const rest = Number(doc.menge) - m;
  if (rest > 0) {
    doc.menge = rest;
    await doc.save();
  } else {
    doc.status = "ERFUELLT";
    await doc.save();
  }
  return toResource(doc);
}