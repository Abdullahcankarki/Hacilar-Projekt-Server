import { ZerlegeAuftragModel } from "../model/ZerlegeAuftragModel";
import { Auftrag, IAuftrag } from "../model/AuftragModel"; // Pfad ggf. anpassen
import {
  ArtikelPosition,
  IArtikelPosition,
} from "../model/ArtikelPositionModel"; // Pfad ggf. anpassen
import { ArtikelPositionResource, AuftragResource } from "../Resources"; // Pfad ggf. anpassen
import { getArtikelById } from "../services/ArtikelService";
import { Mitarbeiter } from "../model/MitarbeiterModel";
import { Counter } from "../model/CounterModel";
import { onAuftragLieferdatumSet, onAuftragDatumOderRegionGeaendert, removeAllStopsForAuftrag, onAuftragGewichtGeaendert } from "./tour-hooksService";
import mongoose from "mongoose";

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
    ? (auftrag.artikelPosition as unknown[]).filter(Boolean).map((x: any) => x.toString())
    : [];
  if (!ids.length) return { totalWeight: 0, totalPrice: 0 };

  const agg = await ArtikelPosition.aggregate([
    { $match: { _id: { $in: ids.map((s) => new mongoose.Types.ObjectId(s)) } } },
    {
      $group: {
        _id: null,
        totalWeight: {
          $sum: {
            $ifNull: [
              // bevorzugt bruttogewicht, fallback gesamtgewicht
              "$bruttogewicht",
              { $ifNull: ["$gesamtgewicht", 0] }
            ],
          },
        },
        totalPrice: { $sum: { $ifNull: ["$gesamtpreis", 0] } },
      },
    },
  ]);

  if (!agg.length) return { totalWeight: 0, totalPrice: 0 };
  const { totalWeight, totalPrice } = agg[0] as { totalWeight: number; totalPrice: number };
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
    kundeName: (typeof (auftrag as any).kunde === "object" && (auftrag as any).kunde?.name) ? (auftrag as any).kunde.name : "",
    artikelPosition: Array.isArray(auftrag.artikelPosition)
      ? auftrag.artikelPosition.map((id) => id?.toString()).filter(Boolean)
      : [],
    status: auftrag.status,
    lieferdatum: auftrag.lieferdatum
      ? auftrag.lieferdatum.toISOString()
      : undefined,
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
  const newAuftrag = new Auftrag({
    auftragsnummer: neueNummer,
    kunde: data.kunde,
    artikelPosition: data.artikelPosition,
    status: data.status ?? "offen",
    lieferdatum: data.lieferdatum ? new Date(data.lieferdatum) : undefined,
    bemerkungen: data.bemerkungen,
  });

  const savedAuftrag = await newAuftrag.save();
  const totals = await computeTotals(savedAuftrag);
  // Persistiere die berechneten Totale auch im Auftrag-Dokument (falls Felder im Schema vorhanden sind)
  try {
    await Auftrag.updateOne(
      { _id: savedAuftrag._id },
      { $set: { gewicht: totals.totalWeight, preis: totals.totalPrice } }
    );
  } catch (e) {
    console.warn('[createAuftrag] Konnte gewicht/preis nicht persistieren (Schema ohne Felder?)', (e as Error)?.message);
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
    | "createdAtDesc" | "createdAtAsc"
    | "updatedAtDesc" | "updatedAtAsc"
    | "lieferdatumAsc" | "lieferdatumDesc"
    | "auftragsnummerAsc" | "auftragsnummerDesc";
}): Promise<AuftragResource[]> {
  // If no `limit` is provided, return all matching records (no pagination). When provided, cap to 200 and paginate.
  const page = Math.max(1, params?.page ?? 1);
  const hasLimit = typeof params?.limit === 'number' && !Number.isNaN(params?.limit as number);
  const limit = hasLimit ? Math.min(200, Math.max(1, params!.limit as number)) : undefined;

  const q: any = {};
  // Simple equals / $in filters
  if (params?.status) q.status = params.status;
  if (params?.statusIn?.length) q.status = { $in: params.statusIn };
  if (params?.kunde) q.kunde = params.kunde;
  if (params?.kommissioniertStatus) q.kommissioniertStatus = params.kommissioniertStatus;
  if (params?.kontrolliertStatus) q.kontrolliertStatus = params.kontrolliertStatus;
  if (params?.bearbeiter) q.bearbeiter = params.bearbeiter;
  if (params?.kommissioniertVon) q.kommissioniertVon = params.kommissioniertVon;
  if (params?.kontrolliertVon) q.kontrolliertVon = params.kontrolliertVon;
  if (typeof params?.hasTour === 'boolean') q.tourId = params.hasTour ? { $exists: true, $ne: null } : { $in: [null], $exists: false };

  // Date ranges
  const addDateRange = (field: string, from?: string, to?: string) => {
    if (!from && !to) return;
    q[field] = {};
    if (from) q[field].$gte = new Date(from);
    if (to) q[field].$lte = new Date(to);
  };
  addDateRange('lieferdatum', params?.lieferdatumVon, params?.lieferdatumBis);
  addDateRange('createdAt', params?.createdVon, params?.createdBis);
  addDateRange('updatedAt', params?.updatedVon, params?.updatedBis);

  // auftragsnummer exact/regex
  if (params?.auftragsnummer) {
    // If it contains regex meta, treat as regex; else use case-insensitive substring
    const v = params.auftragsnummer;
    const isRegex = /[.*+?^${}()|\[\]\\]/.test(v);
    q.auftragsnummer = isRegex ? { $regex: v } : { $regex: v, $options: 'i' };
  }

  // Text search over auftragsnummer + (optional) populated kundeName via $expr (fallback, since kundeName isn't stored)
  // We keep it simple: when q is provided, apply it to auftragsnummer only on the DB side;
  // Frontend can additionally filter by kundeName after mapping if needed.
  if (params?.q) {
    q.auftragsnummer = { $regex: params.q, $options: 'i' };
  }

  // Sorting (only DB fields)
  let sort: any = { createdAt: -1 };
  switch (params?.sort) {
    case 'createdAtAsc': sort = { createdAt: 1 }; break;
    case 'updatedAtDesc': sort = { updatedAt: -1 }; break;
    case 'updatedAtAsc': sort = { updatedAt: 1 }; break;
    case 'lieferdatumAsc': sort = { lieferdatum: 1 }; break;
    case 'lieferdatumDesc': sort = { lieferdatum: -1 }; break;
    case 'auftragsnummerAsc': sort = { auftragsnummer: 1 }; break;
    case 'auftragsnummerDesc': sort = { auftragsnummer: -1 }; break;
    default: sort = { createdAt: -1 }; // createdAtDesc
  }

  let query = Auftrag.find(q)
    .populate('kunde', 'name')
    .sort(sort);

  if (hasLimit && typeof limit === 'number') {
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

  const prevLieferdatum: Date | null = prev.lieferdatum ? new Date(prev.lieferdatum) : null;
  const prevHasTour = !!prev.tourId;

  // 2) Update-Daten bauen
  const updateData: any = {};
  if (data.kunde) updateData.kunde = data.kunde;
  if (data.artikelPosition) updateData.artikelPosition = data.artikelPosition;
  if (data.status) updateData.status = data.status;

  if (data.lieferdatum !== undefined) {
    const parsed = toDateOrNull(data.lieferdatum);
    if (!parsed) throw new Error("Ungültiges Lieferdatum");
    updateData.lieferdatum = parsed;
  }

  if (data.bemerkungen !== undefined) updateData.bemerkungen = data.bemerkungen;
  if (data.bearbeiter !== undefined) updateData.bearbeiter = data.bearbeiter;
  if (data.gesamtPaletten !== undefined) updateData.gesamtPaletten = data.gesamtPaletten;
  if (data.gesamtBoxen !== undefined) updateData.gesamtBoxen = data.gesamtBoxen;
  if (data.kommissioniertVon !== undefined) updateData.kommissioniertVon = data.kommissioniertVon;
  if (data.kontrolliertVon !== undefined) updateData.kontrolliertVon = data.kontrolliertVon;
  if (data.kommissioniertStatus !== undefined) updateData.kommissioniertStatus = data.kommissioniertStatus;
  if (data.kontrolliertStatus !== undefined) updateData.kontrolliertStatus = data.kontrolliertStatus;

  if (data.kommissioniertStartzeit)
    updateData.kommissioniertStartzeit = toDateOrNull(data.kommissioniertStartzeit);
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
  const newLieferdatum: Date | null = updatedAuftrag.lieferdatum ? new Date(updatedAuftrag.lieferdatum) : null;
  const lieferdatumWurdeGeaendert =
    data.lieferdatum !== undefined && !datesEqual(prevLieferdatum, newLieferdatum);

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
    console.warn('[updateAuftrag] Persist/Synchronize gewicht/preis fehlgeschlagen:', (e as Error)?.message);
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
  const uniqueArtikelIds = Array.from(new Set(positionen.map((p) => p.artikel?.toString()).filter(Boolean) as string[]));
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
        await ArtikelPosition.deleteMany({ _id: { $in: artikelPositionen } }).session(session);
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
      const auftraege = await Auftrag.find().select("_id artikelPosition").session(session);
      if (!auftraege.length) {
        await Auftrag.deleteMany({}).session(session);
        return;
      }

      // 1) TourStops/ Touren je Auftrag entfernen/pflegen
      for (const a of auftraege) {
        await removeAllStopsForAuftrag(a._id, session);
      }

      // 2) Alle ArtikelPositionen und Zerlegeaufträge löschen (batch)
      const alleArtikelPositionen = auftraege.flatMap((a) => a.artikelPosition ?? []);
      if (alleArtikelPositionen.length > 0) {
        const CHUNK = 10000;
        for (let i = 0; i < alleArtikelPositionen.length; i += CHUNK) {
          const slice = alleArtikelPositionen.slice(i, i + CHUNK);
          await ArtikelPosition.deleteMany({ _id: { $in: slice } }).session(session);
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

    const list = eigenerGestarteterAuftrag
      ? [eigenerGestarteterAuftrag]
      : await Auftrag.find({ status: "in Bearbeitung", kommissioniertStatus: "offen" })
          .populate("kunde", "name")
          .lean();

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
