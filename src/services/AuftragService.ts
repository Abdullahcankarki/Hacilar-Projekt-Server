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
import { onAuftragLieferdatumSet, onAuftragDatumOderRegionGeaendert, removeAllStopsForAuftrag } from "./tour-hooksService";
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
  // Lade alle ArtikelPositionen, die in diesem Auftrag referenziert werden
  const positions: IArtikelPosition[] = await ArtikelPosition.find({
    _id: { $in: auftrag.artikelPosition },
  });

  const totalWeight = positions.reduce((sum, pos) => {
    const brutto = (pos as any).bruttogewicht;
    const gewicht =
      typeof brutto === "number" && !Number.isNaN(brutto)
        ? brutto
        : pos.gesamtgewicht || 0;
    return sum + gewicht;
  }, 0);
  const totalPrice = positions.reduce((sum, pos) => sum + pos.gesamtpreis, 0);

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
    kundeName: (auftrag as any).kunde?.name || "",
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
  return convertAuftragToResource(savedAuftrag, totals);
}

/**
 * Ruft einen einzelnen Auftrag anhand der ID ab.
 * Dabei werden die Gesamtwerte berechnet und als Teil der Resource zurückgegeben.
 */
export async function getAuftragById(id: string): Promise<AuftragResource> {
  const auftrag = await Auftrag.findById(id).populate("kunde", "name");
  if (!auftrag) {
    throw new Error("Auftrag nicht gefunden");
  }
  const totals = await computeTotals(auftrag);
  return convertAuftragToResource(auftrag, totals);
}

/**
 * Ruft alle Aufträge eines bestimmten Kunden anhand der Kunden-ID ab.
 * Für jeden Auftrag werden Gesamtgewicht und Gesamtpreis berechnet.
 */
export async function getAuftraegeByCustomerId(
  kundenId: string
): Promise<AuftragResource[]> {
  const auftraege = await Auftrag.find({ kunde: kundenId }).populate(
    "kunde",
    "name"
  );

  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag);
      return convertAuftragToResource(auftrag, totals);
    })
  );
}
/**
 * Ruft alle Aufträge ab.
 * Für jeden Auftrag werden Gesamtgewicht und Gesamtpreis berechnet.
 */
export async function getAllAuftraege(): Promise<AuftragResource[]> {
  const auftraege = await Auftrag.find().populate("kunde", "name");
  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag);
      return convertAuftragToResource(auftrag, totals);
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

  const positionResources: ArtikelPositionResource[] = await Promise.all(
    positionen.map(async (pos) => {
      const artikel = await getArtikelById(pos.artikel.toString(), kundenId);
      return {
        id: pos._id.toString(),
        artikel: pos.artikel.toString(),
        artikelName: pos.artikelName,
        menge: pos.menge,
        einheit: pos.einheit,
        einzelpreis: artikel.preis,
        gesamtgewicht: pos.gesamtgewicht,
        gesamtpreis: pos.gesamtpreis,
      };
    })
  );

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
        await ArtikelPosition.deleteMany({ _id: { $in: alleArtikelPositionen } }).session(session);
        await ZerlegeAuftragModel.deleteMany({
          "artikelPositionen.artikelPositionId": { $in: alleArtikelPositionen },
        }).session(session);
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
    // Falls der aktuelle Kommissionierer bereits einen "gestarteten" Auftrag hat, gib nur diesen zurück
    const eigenerGestarteterAuftrag = await Auftrag.findOne({
      kommissioniertVon: currentUserId,
      kommissioniertStatus: "gestartet",
    }).populate("kunde", "name");

    if (eigenerGestarteterAuftrag) {
      const totals = await computeTotals(eigenerGestarteterAuftrag);
      return [convertAuftragToResource(eigenerGestarteterAuftrag, totals)];
    } else {
      const auftraege = await Auftrag.find({
        status: "in Bearbeitung",
        kommissioniertStatus: "offen",
      }).populate("kunde", "name");
      return Promise.all(
        auftraege.map(async (auftrag) => {
          const totals = await computeTotals(auftrag);
          return convertAuftragToResource(auftrag, totals);
        })
      );
    }
  }

  // Andernfalls alle Aufträge mit Status "in Bearbeitung"
  const auftraege = await Auftrag.find({ status: "in Bearbeitung" }).populate(
    "kunde",
    "name"
  );
  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag);
      return convertAuftragToResource(auftrag, totals);
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
