import { ZerlegeAuftragModel } from "../model/ZerlegeAuftragModel";
import { DateTime } from "luxon";
import { Auftrag, IAuftrag } from "../model/AuftragModel"; // Pfad ggf. anpassen
import {
  ArtikelPosition,
  IArtikelPosition,
} from "../model/ArtikelPositionModel"; // Pfad ggf. anpassen
import { Kunde } from "../model/KundeModel";
import { ArtikelModel } from "../model/ArtikelModel";
import { ArtikelPositionResource, AuftragResource } from "../Resources"; // Pfad ggf. anpassen
import { getArtikelById } from "../services/ArtikelService";
import { Mitarbeiter } from "../model/MitarbeiterModel";
import { Counter } from "../model/CounterModel";
import {
  onAuftragLieferdatumSet,
  onAuftragDatumOderRegionGeaendert,
  removeAllStopsForAuftrag,
  onAuftragGewichtGeaendert,
} from "./tour-hooksService";
import mongoose from "mongoose";

import { TourStop } from "../model/TourStopModel";
import { Tour } from "../model/TourModel";
import { Fahrzeug } from "../model/FahrzeugModel";

const ZONE = "Europe/Berlin" as const;

export function parseBerlinYmdToUtcDate(
  input?: string | Date
): Date | undefined {
  if (!input) return undefined;

  // Bereits ein Date-Objekt?
  if (input instanceof Date) {
    // Annahme: bereits ein absoluter Zeitpunkt; in JS-Date ist intern UTC.
    return input;
  }

  const raw = String(input).trim();

  // Wenn ein Zeitanteil (T hh:mm) oder eine Zone (Z / ±hh:mm) vorhanden ist,
  // dann NICHT kürzen, sondern 1:1 respektieren.
  const hasTime = /T\d{2}:\d{2}/.test(raw);
  const hasZone = /Z|[+-]\d{2}:\d{2}$/.test(raw);

  if (hasTime || hasZone) {
    const dt = DateTime.fromISO(raw);
    if (!dt.isValid) return undefined;
    return new Date(dt.toUTC().toISO()!);
  }

  // Nur Datum (YYYY-MM-DD): als Berlin-Kalendertag interpretieren (00:00 in Berlin)
  const dt = DateTime.fromISO(raw, { zone: ZONE });
  if (!dt.isValid) return undefined;
  const berlin15 = dt.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
  return new Date(berlin15.toUTC().toISO()!);
}

function berlinIsoFromDate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const js = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(js.valueOf())) return undefined;
  const dt = DateTime.fromJSDate(js, { zone: ZONE });
  return dt.isValid ? dt.toISODate() ?? undefined : undefined;
}

async function generiereAuftragsnummer(): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { name: "auftrag" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return String(counter.seq).padStart(6, "0"); // z.B. 000001, 000002
}

/**
 * Berechnet für einen Auftrag das Gesamtgewicht und den Gesamtpreis,
 * indem alle zugehörigen ArtikelPositionen geladen und summiert werden.
 */
async function computeTotals(
  auftrag: IAuftrag
): Promise<{ totalWeight: number; totalPrice: number }> {
  const ids = Array.isArray(auftrag.artikelPosition)
    ? (auftrag.artikelPosition as unknown[])
        .filter(Boolean)
        .map((x: any) => x.toString())
    : [];
  if (!ids.length) return { totalWeight: 0, totalPrice: 0 };

  const agg = await ArtikelPosition.aggregate([
    {
      $match: { _id: { $in: ids.map((s) => new mongoose.Types.ObjectId(s)) } },
    },
    {
      $group: {
        _id: null,
        totalWeight: {
          $sum: {
            $ifNull: [
              // bevorzugt bruttogewicht, fallback gesamtgewicht
              "$bruttogewicht",
              { $ifNull: ["$gesamtgewicht", 0] },
            ],
          },
        },
        totalPrice: { $sum: { $ifNull: ["$gesamtpreis", 0] } },
      },
    },
  ]);

  if (!agg.length) return { totalWeight: 0, totalPrice: 0 };
  const { totalWeight, totalPrice } = agg[0] as {
    totalWeight: number;
    totalPrice: number;
  };
  return { totalWeight, totalPrice };
}

/**
 * Wandelt ein IAuftrag-Dokument in einen AuftragResource um und fügt
 * die berechneten Gesamtwerte hinzu.
 */
function convertAuftragToResource(
  auftrag: IAuftrag,
  totals: { totalWeight: number; totalPrice: number }
): AuftragResource {
  return {
    id: auftrag._id?.toString() || "",
    auftragsnummer: auftrag.auftragsnummer || " ",
    kunde:
      typeof auftrag.kunde === "string"
        ? auftrag.kunde
        : auftrag.kunde?._id?.toString() || "",
    kundeName:
      typeof (auftrag as any).kunde === "object" && (auftrag as any).kunde?.name
        ? (auftrag as any).kunde.name
        : "",
    artikelPosition: Array.isArray(auftrag.artikelPosition)
      ? auftrag.artikelPosition.map((id) => id?.toString()).filter(Boolean)
      : [],
    status: auftrag.status,
    lieferdatum: berlinIsoFromDate(auftrag.lieferdatum),
    bemerkungen: auftrag.bemerkungen,
    createdAt: auftrag.createdAt ? auftrag.createdAt.toISOString() : undefined,
    updatedAt: auftrag.updatedAt ? auftrag.updatedAt.toISOString() : undefined,
    gewicht: totals.totalWeight,
    preis: totals.totalPrice,
    bearbeiter: auftrag.bearbeiter,
    gesamtPaletten: auftrag.gesamtPaletten,
    gesamtBoxen: auftrag.gesamtBoxen,
    kommissioniertVon: auftrag.kommissioniertVon?.toString(),
    kommissioniertVonName: auftrag.kommissioniertVonName,
    kontrolliertVon: auftrag.kontrolliertVon?.toString(),
    kontrolliertVonName: auftrag.kontrolliertVonName,
    kommissioniertStatus: auftrag.kommissioniertStatus,
    kontrolliertStatus: auftrag.kontrolliertStatus,
    kommissioniertStartzeit: auftrag.kommissioniertStartzeit
      ? auftrag.kommissioniertStartzeit.toISOString()
      : undefined,
    kommissioniertEndzeit: auftrag.kommissioniertEndzeit
      ? auftrag.kommissioniertEndzeit.toISOString()
      : undefined,
    kontrolliertZeit: auftrag.kontrolliertZeit
      ? auftrag.kontrolliertZeit.toISOString()
      : undefined,
  };
}

/**
 * Erstellt einen neuen Auftrag.
 * Dabei werden die im Input gelieferten Werte übernommen.
 * Anschließend werden die Gesamtwerte berechnet und in der Resource zurückgegeben.
 */
export async function createAuftrag(data: {
  kunde: string;
  artikelPosition: string[];
  status?: "offen" | "in Bearbeitung" | "abgeschlossen" | "storniert";
  lieferdatum?: string;
  bemerkungen?: string;
}): Promise<AuftragResource> {
  const neueNummer = await generiereAuftragsnummer();
  const parsedLieferdatumCreate = parseBerlinYmdToUtcDate(data.lieferdatum);
  const newAuftrag = new Auftrag({
    auftragsnummer: neueNummer,
    kunde: data.kunde,
    artikelPosition: data.artikelPosition,
    status: data.status ?? "offen",
    lieferdatum: parsedLieferdatumCreate,
    bemerkungen: data.bemerkungen,
  });

  const savedAuftrag = await newAuftrag.save();
  // Standard-Tour nur erzeugen, wenn bereits ein Lieferdatum gesetzt ist (Frontend setzt es i.d.R. beim Update)
  if (savedAuftrag.lieferdatum) {
    try {
      await onAuftragLieferdatumSet(savedAuftrag._id.toString());
    } catch (err) {
      console.error(
        "[createAuftrag] onAuftragLieferdatumSet fehlgeschlagen:",
        (err as Error)?.message
      );
    }
  }
  const totals = await computeTotals(savedAuftrag);
  // Persistiere die berechneten Totale auch im Auftrag-Dokument (falls Felder im Schema vorhanden sind)
  try {
    await Auftrag.updateOne(
      { _id: savedAuftrag._id },
      { $set: { gewicht: totals.totalWeight, preis: totals.totalPrice } }
    );
  } catch (e) {
    console.warn(
      "[createAuftrag] Konnte gewicht/preis nicht persistieren (Schema ohne Felder?)",
      (e as Error)?.message
    );
  }
  return convertAuftragToResource(savedAuftrag, totals);
}

/**
 * Ruft einen einzelnen Auftrag anhand der ID ab.
 * Dabei werden die Gesamtwerte berechnet und als Teil der Resource zurückgegeben.
 */
export async function getAuftragById(id: string): Promise<AuftragResource> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Ungültige ID");
  }
  const auftrag = await Auftrag.findById(id).populate("kunde", "name").lean();
  if (!auftrag) {
    throw new Error("Auftrag nicht gefunden");
  }
  const totals = await computeTotals(auftrag as unknown as IAuftrag);
  return convertAuftragToResource(auftrag as unknown as IAuftrag, totals);
}

/**
 * Ruft alle Aufträge eines bestimmten Kunden anhand der Kunden-ID ab.
 * Für jeden Auftrag werden Gesamtgewicht und Gesamtpreis berechnet.
 */
export async function getAuftraegeByCustomerId(
  kundenId: string
): Promise<AuftragResource[]> {
  const auftraege = await Auftrag.find({ kunde: kundenId })
    .populate("kunde", "name")
    .lean();

  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag as unknown as IAuftrag);
      return convertAuftragToResource(auftrag as unknown as IAuftrag, totals);
    })
  );
}
/**
 * Ruft alle Aufträge ab.
 * Für jeden Auftrag werden Gesamtgewicht und Gesamtpreis berechnet.
 */
export async function getAllAuftraege(params?: {
  page?: number;
  limit?: number;
  // Filters
  status?: "offen" | "in Bearbeitung" | "abgeschlossen" | "storniert";
  statusIn?: Array<"offen" | "in Bearbeitung" | "abgeschlossen" | "storniert">;
  kunde?: string;
  auftragsnummer?: string; // exact or regex (prefix/substring)
  q?: string; // free text search over auftragsnummer and kundeName (if populated)
  lieferdatumVon?: string;
  lieferdatumBis?: string;
  createdVon?: string;
  createdBis?: string;
  updatedVon?: string;
  updatedBis?: string;
  kommissioniertStatus?: "offen" | "gestartet" | "fertig";
  kontrolliertStatus?: "offen" | "geprüft";
  bearbeiter?: string; // user id or name stored in field
  kommissioniertVon?: string; // user id
  kontrolliertVon?: string; // user id
  hasTour?: boolean; // filter by existence of tourId
  // Sorting (DB-sortable only)
  sort?:
    | "createdAtDesc"
    | "createdAtAsc"
    | "updatedAtDesc"
    | "updatedAtAsc"
    | "lieferdatumAsc"
    | "lieferdatumDesc"
    | "auftragsnummerAsc"
    | "auftragsnummerDesc";
}): Promise<AuftragResource[]> {
  // If no `limit` is provided, return all matching records (no pagination). When provided, cap to 200 and paginate.
  const page = Math.max(1, params?.page ?? 1);
  const hasLimit =
    typeof params?.limit === "number" && !Number.isNaN(params?.limit as number);
  const limit = hasLimit
    ? Math.min(200, Math.max(1, params!.limit as number))
    : undefined;

  const q: any = {};
  // Simple equals / $in filters
  if (params?.status) q.status = params.status;
  if (params?.statusIn?.length) q.status = { $in: params.statusIn };
  if (params?.kunde) q.kunde = params.kunde;
  if (params?.kommissioniertStatus)
    q.kommissioniertStatus = params.kommissioniertStatus;
  if (params?.kontrolliertStatus)
    q.kontrolliertStatus = params.kontrolliertStatus;
  if (params?.bearbeiter) q.bearbeiter = params.bearbeiter;
  if (params?.kommissioniertVon) q.kommissioniertVon = params.kommissioniertVon;
  if (params?.kontrolliertVon) q.kontrolliertVon = params.kontrolliertVon;
  if (typeof params?.hasTour === "boolean")
    q.tourId = params.hasTour
      ? { $exists: true, $ne: null }
      : { $in: [null], $exists: false };

  // Date ranges
  const addDateRange = (field: string, from?: string, to?: string) => {
    if (!from && !to) return;
    const range: any = {};
    if (from) {
      const f = DateTime.fromISO(String(from), { zone: ZONE })
        .startOf("day")
        .toUTC();
      if (f.isValid) range.$gte = new Date(f.toISO()!);
    }
    if (to) {
      const t = DateTime.fromISO(String(to), { zone: ZONE })
        .endOf("day")
        .toUTC();
      if (t.isValid) range.$lte = new Date(t.toISO()!);
    }
    if (Object.keys(range).length) q[field] = range;
  };
  addDateRange("lieferdatum", params?.lieferdatumVon, params?.lieferdatumBis);
  addDateRange("createdAt", params?.createdVon, params?.createdBis);
  addDateRange("updatedAt", params?.updatedVon, params?.updatedBis);

  // auftragsnummer exact/regex
  if (params?.auftragsnummer) {
    // If it contains regex meta, treat as regex; else use case-insensitive substring
    const v = params.auftragsnummer;
    const isRegex = /[.*+?^${}()|\[\]\\]/.test(v);
    q.auftragsnummer = isRegex ? { $regex: v } : { $regex: v, $options: "i" };
  }

  // Text search over auftragsnummer + (optional) populated kundeName via $expr (fallback, since kundeName isn't stored)
  // We keep it simple: when q is provided, apply it to auftragsnummer only on the DB side;
  // Frontend can additionally filter by kundeName after mapping if needed.
  if (params?.q) {
    q.auftragsnummer = { $regex: params.q, $options: "i" };
  }

  // Sorting (only DB fields)
  let sort: any = { createdAt: -1 };
  switch (params?.sort) {
    case "createdAtAsc":
      sort = { createdAt: 1 };
      break;
    case "updatedAtDesc":
      sort = { updatedAt: -1 };
      break;
    case "updatedAtAsc":
      sort = { updatedAt: 1 };
      break;
    case "lieferdatumAsc":
      sort = { lieferdatum: 1 };
      break;
    case "lieferdatumDesc":
      sort = { lieferdatum: -1 };
      break;
    case "auftragsnummerAsc":
      sort = { auftragsnummer: 1 };
      break;
    case "auftragsnummerDesc":
      sort = { auftragsnummer: -1 };
      break;
    default:
      sort = { createdAt: -1 }; // createdAtDesc
  }

  let query = Auftrag.find(q).populate("kunde", "name").sort(sort);

  if (hasLimit && typeof limit === "number") {
    query = query.skip((page - 1) * limit).limit(limit);
  }

  const auftraege = await query.lean();

  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag as unknown as IAuftrag);
      return convertAuftragToResource(auftrag as unknown as IAuftrag, totals);
    })
  );
}

/**
 * Aktualisiert einen Auftrag.
 * Mögliche Felder zum Updaten sind: kunde, artikelPosition, status, lieferdatum und bemerkungen.
 * Nach dem Update werden die Gesamtwerte neu berechnet.
 */
export async function updateAuftrag(
  id: string,
  data: Partial<{
    kunde: string;
    artikelPosition: string[];
    status: "offen" | "in Bearbeitung" | "abgeschlossen" | "storniert";
    lieferdatum: string;
    bemerkungen: string;
    bearbeiter: string;
    gesamtPaletten: number;
    gesamtBoxen: number;
    kommissioniertVon: string;
    kommissioniertVonName: string;
    kontrolliertVon: string;
    kontrolliertVonName: string;
    kommissioniertStatus: "offen" | "gestartet" | "fertig";
    kontrolliertStatus: "offen" | "geprüft";
    kommissioniertStartzeit: string;
    kommissioniertEndzeit: string;
    kontrolliertZeit: string;
  }>
): Promise<AuftragResource> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Ungültige ID");
  }
  // Hilfsfunktion für robusten Date-Vergleich (null-safe)
  const toDateOrNull = (v: unknown): Date | null => {
    if (!v) return null;
    const d = new Date(v as string | number | Date);
    return isNaN(d.getTime()) ? null : d;
  };
  const datesEqual = (a?: Date | null, b?: Date | null) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.getTime() === b.getTime();
  };

  // 1) Altes Dokument holen (für Vergleich von lieferdatum + tourId)
  const prev = await Auftrag.findById(id).select("lieferdatum tourId");
  if (!prev) throw new Error("Auftrag nicht gefunden");

  const prevLieferdatum: Date | null = prev.lieferdatum
    ? new Date(prev.lieferdatum)
    : null;
  const prevHasTour = !!prev.tourId;

  // 2) Update-Daten bauen
  const updateData: any = {};
  if (data.kunde) updateData.kunde = data.kunde;
  if (data.artikelPosition) updateData.artikelPosition = data.artikelPosition;
  if (data.status) updateData.status = data.status;

  if (data.lieferdatum !== undefined) {
    const parsed = parseBerlinYmdToUtcDate(data.lieferdatum);
    if (!parsed) throw new Error("Ungültiges Lieferdatum");
    updateData.lieferdatum = parsed;
  }

  if (data.bemerkungen !== undefined) updateData.bemerkungen = data.bemerkungen;
  if (data.bearbeiter !== undefined) updateData.bearbeiter = data.bearbeiter;
  if (data.gesamtPaletten !== undefined)
    updateData.gesamtPaletten = data.gesamtPaletten;
  if (data.gesamtBoxen !== undefined) updateData.gesamtBoxen = data.gesamtBoxen;
  if (data.kommissioniertVon !== undefined)
    updateData.kommissioniertVon = data.kommissioniertVon;
  if (data.kontrolliertVon !== undefined)
    updateData.kontrolliertVon = data.kontrolliertVon;
  if (data.kommissioniertStatus !== undefined)
    updateData.kommissioniertStatus = data.kommissioniertStatus;
  if (data.kontrolliertStatus !== undefined)
    updateData.kontrolliertStatus = data.kontrolliertStatus;

  if (data.kommissioniertStartzeit)
    updateData.kommissioniertStartzeit = toDateOrNull(
      data.kommissioniertStartzeit
    );
  if (data.kommissioniertEndzeit)
    updateData.kommissioniertEndzeit = toDateOrNull(data.kommissioniertEndzeit);
  if (data.kontrolliertZeit)
    updateData.kontrolliertZeit = toDateOrNull(data.kontrolliertZeit);

  // 3) kommissioniert/kontrolliert Namen auflösen
  if (data.kommissioniertVon) {
    const mitarbeiter = await Mitarbeiter.findById(data.kommissioniertVon);
    if (mitarbeiter) updateData.kommissioniertVonName = mitarbeiter.name;
  }
  if (data.kontrolliertVon) {
    const mitarbeiter = await Mitarbeiter.findById(data.kontrolliertVon);
    if (mitarbeiter) updateData.kontrolliertVonName = mitarbeiter.name;
  }

  // 4) Update ausführen
  const updatedAuftrag = await Auftrag.findByIdAndUpdate(id, updateData, {
    new: true,
  }).populate("kunde", "name");
  if (!updatedAuftrag) throw new Error("Auftrag nicht gefunden (nach Update)");

  // 5) Hooks abhängig von Lieferdatums-Änderung & tourId-Zustand
  const newLieferdatum: Date | null = updatedAuftrag.lieferdatum
    ? new Date(updatedAuftrag.lieferdatum)
    : null;
  const lieferdatumWurdeGeaendert =
    data.lieferdatum !== undefined &&
    !datesEqual(prevLieferdatum, newLieferdatum);

  if (lieferdatumWurdeGeaendert) {
    try {
      if (!prevHasTour) {
        // Falls es vorher KEINE Tour gab → Standard-Erstzuordnung
        await onAuftragLieferdatumSet(updatedAuftrag._id.toString());
      } else {
        // Wenn schon eine Tour vorhanden war → Datum/Region-Änderungslogik
        // (Signatur ggf. anpassen, falls deine Funktion mehr Parameter erwartet)
        await onAuftragDatumOderRegionGeaendert(updatedAuftrag._id.toString());
      }
    } catch (err) {
      // Update soll nicht an Hook-Fehler scheitern
      console.error(
        "[updateAuftrag] Tour-Hook fehlgeschlagen:",
        (err as Error)?.message
      );
    }
  }

  // 6) Totals & Rückgabe
  const totals = await computeTotals(updatedAuftrag);
  // Persistiere neue Totale im Auftrag-Dokument und synchronisiere TourStops
  try {
    await Auftrag.updateOne(
      { _id: updatedAuftrag._id },
      { $set: { gewicht: totals.totalWeight, preis: totals.totalPrice } }
    );
    await onAuftragGewichtGeaendert(updatedAuftrag._id.toString());
  } catch (e) {
    console.warn(
      "[updateAuftrag] Persist/Synchronize gewicht/preis fehlgeschlagen:",
      (e as Error)?.message
    );
  }
  return convertAuftragToResource(updatedAuftrag, totals);
}

export async function getLetzterAuftragMitPositionenByKundenId(
  kundenId: string
): Promise<{
  auftrag: AuftragResource;
  artikelPositionen: ArtikelPositionResource[];
} | null> {
  const auftragDocs = await Auftrag.find({ kunde: kundenId })
    .populate("kunde", "name")
    .sort({ createdAt: -1 })
    .limit(1);

  if (!auftragDocs || auftragDocs.length === 0) return null;

  const auftrag = auftragDocs[0];
  const totals = await computeTotals(auftrag);
  const auftragResource = convertAuftragToResource(auftrag, totals);

  const positionen = await ArtikelPosition.find({
    _id: { $in: auftrag.artikelPosition },
  });

  // Deduplicate Artikel-IDs and fetch in parallel (still using getArtikelById to respect pricing rules)
  const uniqueArtikelIds = Array.from(
    new Set(
      positionen.map((p) => p.artikel?.toString()).filter(Boolean) as string[]
    )
  );
  const artikelMap = new Map<string, any>();
  await Promise.all(
    uniqueArtikelIds.map(async (aid) => {
      const a = await getArtikelById(aid, kundenId);
      artikelMap.set(aid, a);
    })
  );

  const positionResources: ArtikelPositionResource[] = positionen.map((pos) => {
    const aid = pos.artikel?.toString();
    const artikel = aid ? artikelMap.get(aid) : undefined;
    return {
      id: pos._id.toString(),
      artikel: aid || "",
      artikelName: pos.artikelName,
      menge: pos.menge,
      einheit: pos.einheit,
      einzelpreis: artikel?.preis,
      gesamtgewicht: pos.gesamtgewicht,
      gesamtpreis: pos.gesamtpreis,
    };
  });

  return {
    auftrag: auftragResource,
    artikelPositionen: positionResources,
  };
}

/**
 * Gibt den zuletzt erstellten Auftrag eines bestimmten Kunden zurück.
 */
export async function getLetzterArtikelFromAuftragByKundenId(
  kundenId: string
): Promise<string[]> {
  const auftrag = await Auftrag.find({ kunde: kundenId })
    .sort({ createdAt: -1 }) // neuester Auftrag zuerst
    .limit(1);

  if (!auftrag || auftrag.length === 0) {
    return [];
  }

  // ArtikelPositionen laden
  const artikelPositionen = await ArtikelPosition.find({
    _id: { $in: auftrag[0].artikelPosition },
  });

  // Nur Artikel-IDs extrahieren (distinct)
  const artikelIds = artikelPositionen
    .map((pos) => pos.artikel?.toString())
    .filter((id): id is string => !!id); // entfernt undefined/null

  return artikelIds;
}

export async function deleteAuftrag(id: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Ungültige ID");
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const auftrag = await Auftrag.findById(id).session(session);
      if (!auftrag) throw new Error("Auftrag nicht gefunden");

      // 1) TourStops entfernen & Touren pflegen
      await removeAllStopsForAuftrag(auftrag._id, session);

      // 2) ArtikelPositionen + Zerlegeaufträge löschen
      const artikelPositionen = auftrag.artikelPosition ?? [];
      if (artikelPositionen.length > 0) {
        await ArtikelPosition.deleteMany({
          _id: { $in: artikelPositionen },
        }).session(session);
        await ZerlegeAuftragModel.deleteMany({
          "artikelPositionen.artikelPositionId": { $in: artikelPositionen },
        }).session(session);
      }

      // 3) Auftrag löschen
      await Auftrag.deleteOne({ _id: auftrag._id }).session(session);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Löscht alle Aufträge samt abhängiger ArtikelPositionen, TourStops
 * und ggf. leer gewordener Touren.
 */
export async function deleteAllAuftraege(): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const auftraege = await Auftrag.find()
        .select("_id artikelPosition")
        .session(session);
      if (!auftraege.length) {
        await Auftrag.deleteMany({}).session(session);
        return;
      }

      // 1) TourStops/ Touren je Auftrag entfernen/pflegen
      for (const a of auftraege) {
        await removeAllStopsForAuftrag(a._id, session);
      }

      // 2) Alle ArtikelPositionen und Zerlegeaufträge löschen (batch)
      const alleArtikelPositionen = auftraege.flatMap(
        (a) => a.artikelPosition ?? []
      );
      if (alleArtikelPositionen.length > 0) {
        const CHUNK = 10000;
        for (let i = 0; i < alleArtikelPositionen.length; i += CHUNK) {
          const slice = alleArtikelPositionen.slice(i, i + CHUNK);
          await ArtikelPosition.deleteMany({ _id: { $in: slice } }).session(
            session
          );
          await ZerlegeAuftragModel.deleteMany({
            "artikelPositionen.artikelPositionId": { $in: slice },
          }).session(session);
        }
      }

      // 3) Alle Aufträge löschen
      await Auftrag.deleteMany({}).session(session);
    });
  } finally {
    await session.endSession();
  }
}
/**
 * Gibt alle Aufträge mit Status "in Bearbeitung" zurück.
 * Falls der aktuelle Nutzer bereits einen "gestarteten" Auftrag hat,
 * wird nur dieser Auftrag zurückgegeben.
 */
export async function getAlleAuftraegeInBearbeitung(
  currentUserId: string,
  isKommissionierer: boolean
): Promise<AuftragResource[]> {
  if (isKommissionierer) {
    const eigenerGestarteterAuftrag = await Auftrag.findOne({
      kommissioniertVon: currentUserId,
      kommissioniertStatus: "gestartet",
    })
      .populate("kunde", "name")
      .lean();

    // Alle offenen ODER alle fertigen ODER alle geprüften (Status-Einschränkung nur für "offen")
    const weitereAuftraege = await Auftrag.find({
      $or: [
        { status: "in Bearbeitung", kommissioniertStatus: "offen" },
        {
          status: "in Bearbeitung",
          kommissioniertStatus: "fertig",
          kontrolliertStatus: "geprüft",
        },
      ],
    })
      .populate("kunde", "name")
      .lean();

    // Wenn es einen eigenen gestarteten Auftrag gibt, füge ihn zusätzlich ein (ohne Duplikat)
    const list = eigenerGestarteterAuftrag
      ? [
          eigenerGestarteterAuftrag,
          ...weitereAuftraege.filter(
            (a) => a._id.toString() !== eigenerGestarteterAuftrag._id.toString()
          ),
        ]
      : weitereAuftraege;

    return Promise.all(
      list.map(async (auftrag) => {
        const totals = await computeTotals(auftrag as unknown as IAuftrag);
        return convertAuftragToResource(auftrag as unknown as IAuftrag, totals);
      })
    );
  }

  const auftraege = await Auftrag.find({ status: "in Bearbeitung" })
    .populate("kunde", "name")
    .lean();
  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag as unknown as IAuftrag);
      return convertAuftragToResource(auftrag as unknown as IAuftrag, totals);
    })
  );
}

/**
 * Setzt den Status eines Auftrags auf "in Bearbeitung" und kommissioniertStatus auf "offen".
 * Nur für Admins gedacht.
 */
export async function setAuftragInBearbeitung(
  id: string
): Promise<AuftragResource> {
  const updatedAuftrag = await Auftrag.findByIdAndUpdate(
    id,
    { status: "in Bearbeitung", kommissioniertStatus: "offen" },
    { new: true }
  ).populate("kunde", "name");

  if (!updatedAuftrag) {
    throw new Error("Auftrag nicht gefunden");
  }

  const totals = await computeTotals(updatedAuftrag);
  return convertAuftragToResource(updatedAuftrag, totals);
}

/**
 * Liefert Tour-Informationen für eine Liste von Aufträgen, ohne die AuftragResource zu erweitern.
 * Frontend kann diese Infos clientseitig per Mapping zum Auftrag anzeigen.
 */
export type TourInfoByAuftragId = Record<
  string,
  {
    tourStopId?: string;
    tourId?: string;
    reihenfolge?: number;
    kennzeichen?: string;
  }
>;

export async function getTourInfosForAuftraege(
  auftragIds: string[]
): Promise<TourInfoByAuftragId> {
  if (!Array.isArray(auftragIds) || auftragIds.length === 0) return {};

  const validIds = auftragIds
    .filter(Boolean)
    .map((id) => id.toString())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (validIds.length === 0) return {};

  // 1) Relevante TourStops zu den Aufträgen laden
  const stops = await TourStop.find(
    { auftragId: { $in: validIds } },
    { auftragId: 1, position: 1, tourId: 1 }
  ).lean();

  if (!stops || stops.length === 0) return {};

  // 2) Touren inkl. fahrzeugId laden
  const tourIds = Array.from(
    new Set(
      stops
        .map((s) => (s as any).tourId)
        .filter(Boolean)
        .map((id: any) => id.toString())
    )
  );

  // Anzahl Stops je Tour ermitteln (für inverse Reihenfolge: letzte = 1)
  const tourIdObjs = tourIds.map(
    (id: string) => new mongoose.Types.ObjectId(id)
  );
  const counts = tourIdObjs.length
    ? await TourStop.aggregate([
        { $match: { tourId: { $in: tourIdObjs } } },
        { $group: { _id: "$tourId", total: { $sum: 1 } } },
      ])
    : [];
  const totalByTourId = new Map<string, number>(
    counts.map((c: any) => [c._id.toString(), c.total])
  );

  // Tours inkl. fahrzeugId laden
  const tours = tourIds.length
    ? await Tour.find({ _id: { $in: tourIds } }, { fahrzeugId: 1 }).lean()
    : [];

  // Mapping: tourId -> fahrzeugId
  const fahrzeugIdByTourId = new Map<string, string | undefined>(
    tours.map((t) => [
      t._id.toString(),
      (t as any).fahrzeugId ? (t as any).fahrzeugId.toString() : undefined,
    ])
  );

  // Fahrzeuge nachladen, um Kennzeichen zu bekommen
  const fahrzeugIds = Array.from(
    new Set(Array.from(fahrzeugIdByTourId.values()).filter(Boolean) as string[])
  );

  const fahrzeuge = fahrzeugIds.length
    ? await Fahrzeug.find(
        { _id: { $in: fahrzeugIds } },
        { kennzeichen: 1 }
      ).lean()
    : [];

  const kennzeichenByFahrzeugId = new Map<string, string>(
    fahrzeuge.map((f) => [f._id.toString(), (f as any).kennzeichen])
  );

  // 3) Mapping aufbauen: auftragId -> Tour-Infos (mit invertierter reihenfolge)
  const result: TourInfoByAuftragId = {};
  for (const s of stops) {
    const aid = (s as any).auftragId?.toString();
    if (!aid) continue;
    const tid = (s as any).tourId ? (s as any).tourId.toString() : undefined;
    const fzgId = tid ? fahrzeugIdByTourId.get(tid) : undefined;
    const kz = fzgId ? kennzeichenByFahrzeugId.get(fzgId) : undefined;
    const total = tid ? totalByTourId.get(tid) : undefined;
    const pos = (s as any).position as number | undefined;
    const inv =
      typeof pos === "number" && typeof total === "number"
        ? total - pos + 1
        : pos;
    result[aid] = {
      tourStopId: (s as any)._id?.toString(),
      tourId: tid,
      reihenfolge: inv,
      kennzeichen: kz,
    };
  }

  return result;
}

/**
 * Quick-Order: Erstellt einen Auftrag aus einer vereinfachten Eingabe
 * - Kunde per ID oder Name
 * - Items: [{ name, menge, einheit }]
 * - Sucht Artikel per Name (case-insensitive, exact/startsWith)
 * - Erzeugt zugehörige ArtikelPosition-Dokumente
 * - Ruft anschließend createAuftrag() mit den Positionen auf
 */
export async function createAuftragQuick(data: {
  kundeId?: string;
  kundeName?: string;
  lieferdatum?: string; // YYYY-MM-DD (Berlin)
  bemerkungen?: string;
  items: { artikelNr?: string; name?: string; menge: number; einheit?: string }[];
  status?: "offen" | "in Bearbeitung" | "abgeschlossen" | "storniert";
}): Promise<AuftragResource> {
  // --- Validierung Grundstruktur ---
  if (!data?.items || !Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("❌ Keine Positionen übergeben. Bitte mindestens eine Artikelzeile angeben (z. B. 'Hä. Flügel Landgeflügel 200kg').");
  }

  // Erlaubte Einheiten (kannst du bei Bedarf erweitern)
  const ALLOWED_UNITS = new Set(["kg", "stk", "kiste", "karton"]);

  const errors: string[] = [];

  // --- Kunde ermitteln (ID bevorzugt, sonst by name) ---
  let kundeId: string | undefined = data.kundeId?.trim();
  if (!kundeId) {
    const rawName = (data.kundeName || "").trim();
    if (!rawName) {
      errors.push("❌ Kunde fehlt. Bitte Kundennamen oder kundeId mitgeben.");
    } else {
      const k = await Kunde.findOne({ name: new RegExp(`^${rawName}$`, "i") }, { _id: 1, name: 1 }).lean();
      if (!k) {
        errors.push(`❌ Kunde nicht gefunden: "${rawName}". Tipp: exakte Schreibweise verwenden oder kundeId schicken.`);
      } else {
        kundeId = k._id.toString();
      }
    }
  }

  // --- Items vorprüfen & Artikel auflösen (ohne zu speichern) ---
  type ResolvedItem = { artikelId: string; artikelName: string; menge: number; einheit: string };
  const resolved: ResolvedItem[] = [];

  for (let i = 0; i < data.items.length; i++) {
    const it = data.items[i] || ({} as any);
    const idx = i + 1;

    // Menge prüfen
    if (typeof it.menge !== "number" || !isFinite(it.menge) || it.menge <= 0) {
      errors.push(`❌ Position ${idx}: Menge muss eine Zahl > 0 sein.`);
    }

    // Einheit normalisieren
    let einheit = (it.einheit || "kg").toString().trim().toLowerCase();
    if (einheit && !ALLOWED_UNITS.has(einheit)) {
      // nicht bremsen – aber Hinweis geben
      errors.push(`ℹ️ Position ${idx}: Unbekannte Einheit "${einheit}" – es wird trotzdem gespeichert.`);
    }
    if (!einheit) einheit = "kg";

    // Artikel auflösen (artikelNr bevorzugt, sonst name)
    let artikelDoc: any = null;
    const nr = (it.artikelNr || "").toString().trim();
    const nm = (it.name || "").toString().trim();

    if (!nr && !nm) {
      errors.push(`❌ Position ${idx}: Es fehlt entweder artikelNr oder name.`);
      continue;
    }

    try {
      if (nr) {
        // Suche nach exakter Artikelnummer (case-insensitive)
        artikelDoc = await ArtikelModel.findOne({ artikelNummer: new RegExp(`^${nr}$`, "i") }).lean();
        if (!artikelDoc) {
          errors.push(`❌ Position ${idx}: Artikel mit Nummer "${nr}" nicht gefunden.`);
        }
      } else if (nm) {
        // Exakter Name, sonst startsWith
        artikelDoc = await ArtikelModel.findOne({ name: new RegExp(`^${nm}$`, "i") }).lean();
        if (!artikelDoc) {
          artikelDoc = await ArtikelModel.findOne({ name: new RegExp(`^${nm}`, "i") }).lean();
        }
        if (!artikelDoc) {
          errors.push(`❌ Position ${idx}: Artikel nicht gefunden: "${nm}". Tipp: exakten Namen verwenden oder artikelNr mitschicken.`);
        }
      }
    } catch (e: any) {
      errors.push(`❌ Position ${idx}: Artikelsuche fehlgeschlagen: ${e?.message || e}`);
    }

    if (artikelDoc && typeof it.menge === "number" && isFinite(it.menge) && it.menge > 0) {
      resolved.push({ artikelId: artikelDoc._id.toString(), artikelName: artikelDoc.name || nm || nr, menge: it.menge, einheit });
    }
  }

  // Wenn Fehler vorliegen, alles gesammelt melden
  if (errors.length) {
    // Telegram-freundlich mit Zeilenumbrüchen
    throw new Error(errors.join("\n"));
  }

  // --- ArtikelPositionen anlegen ---
  const artikelPositionIds: string[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    try {
      const ap = await new ArtikelPosition({
        artikel: r.artikelId,
        menge: r.menge,
        einheit: r.einheit,
      }).save();
      artikelPositionIds.push(ap._id.toString());
    } catch (e: any) {
      throw new Error(`❌ Konnte Position ${i + 1} (Artikel: ${r.artikelName}) nicht speichern: ${e?.message || e}`);
    }
  }

  // --- Auftrag zunächst ohne Lieferdatum erstellen ---
  if (!kundeId) {
    throw new Error("❌ Auftrag konnte nicht erstellt werden: Kunde unbekannt.");
  }

  const created = await createAuftrag({
    kunde: kundeId,
    artikelPosition: artikelPositionIds,
    status: data.status ?? "offen",
    lieferdatum: undefined,
    bemerkungen: data.bemerkungen,
  });

  // --- Lieferdatum optional via Update setzen (triggert Hooks) ---
  if (data.lieferdatum) {
    try {
      const updated = await updateAuftrag(created.id!, { lieferdatum: data.lieferdatum });
      return updated;
    } catch (e: any) {
      // Auftrag existiert bereits – aussagekräftig zurückmelden
      throw new Error(`✅ Auftrag ${created.auftragsnummer} angelegt, aber Lieferdatum konnte nicht gesetzt werden: ${e?.message || e}`);
    }
  }

  return created;
}
