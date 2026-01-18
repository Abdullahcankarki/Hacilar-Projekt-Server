import { ArtikelPosition } from "../model/ArtikelPositionModel";
import { Mitarbeiter } from "../model/MitarbeiterModel";
import { ArtikelModel } from "../model/ArtikelModel"; // ✅ Hinzugefügt
import { ArtikelPositionResource } from "../Resources";
import { KundenPreisModel } from "../model/KundenPreisModel";
import { Auftrag } from "../model/AuftragModel";
import { getKundenPreis } from "./KundenPreisService"; // Pfad ggf. anpassen
import { ZerlegeAuftragModel } from "../model/ZerlegeAuftragModel";
import mongoose from "mongoose";

import { BewegungModel } from "../model/BewegungsModel";
import { BestandAggModel } from "../model/BestandsAggModel";
import { ChargeModel } from "../model/ChargeModel";
import type { Lagerbereich } from "../Resources";

// ... Importe bleiben gleich

const EMPTY_ARTIKEL = {
  name: "Unbekannter Artikel",
  preis: 1,
  gewichtProStueck: 1,
  gewichtProKiste: 1,
  gewichtProKarton: 1,
};

// ---------- Bestands-Sync (Kommissionierung) Helpers ----------
function toISODate(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  const dt = typeof d === "string" ? new Date(d) : d;
  return isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

async function getArtikelGewichte(artikelId: string) {
  const a = await ArtikelModel.findById(artikelId).lean();
  return {
    gewichtProStueck: Number(a?.gewichtProStueck ?? 0) || 0,
    gewichtProKiste: Number(a?.gewichtProKiste ?? 0) || 0,
    gewichtProKarton: Number(a?.gewichtProKarton ?? 0) || 0,
    name: a?.name,
    artikelNummer: (a as any)?.artikelNummer,
  };
}

async function sumBereitsGebuchtKg(
  auftragId: string,
  artikelId: string,
  positionId: string
): Promise<number> {
  const docs = await BewegungModel.aggregate([
    {
      $match: {
        typ: "KOMMISSIONIERUNG",
        auftragId: new mongoose.Types.ObjectId(auftragId),
        artikelId: new mongoose.Types.ObjectId(artikelId),
        notiz: { $regex: `\\[POS:${positionId}\\]` },
      },
    },
    { $group: { _id: null, sum: { $sum: "$menge" } } },
  ]);
  // menge ist negativ bei KOMMISSIONIERUNG → wir nehmen den Absolutwert
  const sum = docs[0]?.sum ?? 0;
  return Math.abs(Number(sum) || 0);
}

async function upsertBestandAgg(
  p: {
    artikelId: string;
    chargeId: string;
    lagerbereich: Lagerbereich;
    deltaVerfuegbar: number;
  },
  session: mongoose.ClientSession
) {
  await BestandAggModel.updateOne(
    {
      artikelId: new mongoose.Types.ObjectId(p.artikelId),
      chargeId: new mongoose.Types.ObjectId(p.chargeId),
      lagerbereich: p.lagerbereich,
    },
    {
      $setOnInsert: {
        artikelId: new mongoose.Types.ObjectId(p.artikelId),
        chargeId: new mongoose.Types.ObjectId(p.chargeId),
        lagerbereich: p.lagerbereich,
      },
      $inc: { verfuegbar: p.deltaVerfuegbar },
      $set: { updatedAt: new Date() },
    },
    { upsert: true, session }
  );
}

// ---------- Leergut→Artikel-Mapping ----------

const LEERGUT_OPTION_TO_ARTIKELNAME: Record<string, string> = {
  e2: "E2 Kiste",
  e1: "E1 Kiste",
  h1: "H1 Palette",
  karton: "Karton",
  // "e6": "E6 Kiste", // nur aktivieren, wenn Artikel existiert
  "big box": "Big Box",
  korb: "Korb",
  "euro palette": "Euro Palette",
  einwegpalette: "Einwegplatte", // dein Artikel heißt so
  haken: "Euro Haken",
  // "tüten": "Tüte", // nur wenn du einen Artikel dafür hast
};

// Helper to reorder artikelPositionen in Auftrag after Leergut changes
async function reorderArtikelPositionen(auftragId: string) {
  const auftrag = await Auftrag.findById(auftragId);
  if (!auftrag) return;


  const allePositionen = await ArtikelPosition.find({ auftragId }).lean();
  const leergut = allePositionen.filter(p => p.leergutVonPositionId);

  // Ensure the Auftrag list never contains Leergut IDs
  auftrag.artikelPosition = auftrag.artikelPosition.filter(id =>
    allePositionen.some(p => p._id.toString() === id.toString() && !p.leergutVonPositionId)
  );

  const newOrder: any[] = [];

  // WICHTIG: Reihenfolge der Hauptpositionen kommt vom Auftrag selbst
  for (const id of auftrag.artikelPosition) {
    const haupt = allePositionen.find(
      p => p._id.toString() === id.toString() && !p.leergutVonPositionId
    );
    if (!haupt) continue;

    // passende Leergutpositionen voranstellen
    const zugehoerig = leergut.filter(
      l => l.leergutVonPositionId?.toString() === haupt._id.toString()
    );

    zugehoerig.sort((a, b) => a.artikelName.localeCompare(b.artikelName));

    for (const lg of zugehoerig) newOrder.push(lg._id);

    newOrder.push(haupt._id);
  }

  // Remove duplicate IDs
  const unique = Array.from(new Set(newOrder.map(id => id.toString())))
    .map(id => new mongoose.Types.ObjectId(id));
  auftrag.artikelPosition = unique;
  await Auftrag.findByIdAndUpdate(
    auftragId,
    { artikelPosition: unique },
    { new: true }
  );
}

/**
 * Erzeugt zu einem Leergut-Eintrag eine Leergut-Artikelposition
 * auf dem angegebenen Auftrag (falls Mapping + Artikel gefunden).
 */
async function createLeergutArtikelPositionFromSelection(
  auftragId: string | undefined,
  positionId: any,
  leergutArtRaw: string,
  anzahl: number
): Promise<void> {

  if (!auftragId) return;
  if (!anzahl || anzahl <= 0) return;

  // Normalize auftragId as ObjectId once
  const auftragObjectId = new mongoose.Types.ObjectId(auftragId);
  // Normalize positionId as ObjectId once
  const posId = new mongoose.Types.ObjectId(positionId.toString());

  const key = leergutArtRaw.trim().toLowerCase();
  const artikelName = LEERGUT_OPTION_TO_ARTIKELNAME[key];
  if (!artikelName) {
    return;
  }

  const artikel = await ArtikelModel.findOne({
    name: artikelName,
    kategorie: "Leergut",
  });

  if (!artikel) {
    return;
  }


  // ❗ Anti-Duplicate Guard: if Leergut already exists with same values, exit early
  const existingStrict = await ArtikelPosition.findOne({
    auftragId: auftragObjectId,
    artikel: artikel?._id,
    leergutVonPositionId: posId
  }).lean();


  if (existingStrict && existingStrict.menge === anzahl) {
    // Already correct → do not recreate or update
    return;
  }


  // Upsert statt immer neu erstellen
  const existing = await ArtikelPosition.findOne({
    auftragId: auftragObjectId,
    artikel: artikel._id,
    leergutVonPositionId: posId,
  });


  if (existing) {
    if (existing.menge === anzahl) {
        // No changes → avoid re-triggering reorder or duplicate work
        await reorderArtikelPositionen(auftragId);
        return;
    }
    existing.menge = anzahl;
    existing.gesamtgewicht = anzahl; // stück → gewicht = menge
    existing.gesamtpreis = existing.einzelpreis * existing.gesamtgewicht;
    existing.leergutVonPositionId = posId;
    await existing.save();
    await reorderArtikelPositionen(auftragId);
  } else {
    await createArtikelPosition({
      artikel: artikel._id.toString(),
      menge: anzahl,
      einheit: "stück",
      auftragId: auftragId,
      zerlegung: false,
      vakuum: false,
      leergutVonPositionId: posId,
    });
    await reorderArtikelPositionen(auftragId);
  }
}

/**
 * Ermittelt die zu buchende Zielmenge in **kg** aus den Kommissionierungsfeldern einer Position.
 * Priorität: Nettogewicht > kommissioniertMenge*Einheitsgewicht.
 */
async function computeZielMengeKg(position: any): Promise<number> {
  const artikelId = position.artikel?.toString();
  const einheit = position.kommissioniertEinheit || position.einheit;
  const kgFromNetto =
    typeof position.nettogewicht === "number" && isFinite(position.nettogewicht)
      ? position.nettogewicht
      : undefined;
  if (kgFromNetto !== undefined) return round3(Math.max(0, kgFromNetto));

  const menge =
    typeof position.kommissioniertMenge === "number"
      ? position.kommissioniertMenge
      : position.menge;
  if (!artikelId || !isFinite(menge) || menge <= 0) return 0;
  if (einheit === "kg") return round3(menge);

  const g = await getArtikelGewichte(artikelId);
  const factor =
    einheit === "stück"
      ? g.gewichtProStueck
      : einheit === "kiste"
      ? g.gewichtProKiste
      : g.gewichtProKarton;
  return round3(Math.max(0, menge * (factor || 0)));
}

/**
 * Bucht Delta für diese Position gegen die angegebenen Chargen.
 * - Delta > 0  → KOMMISSIONIERUNG (negativ)
 * - Delta < 0  → INVENTUR_KORREKTUR (positiv, Rückbuchung)
//  */
// async function syncKommissionierungMitBestand(
//   positionId: string,
//   userId: string | undefined
// ) {
//   const position = await ArtikelPosition.findById(positionId);
//   if (!position) return;
//   const auftrag = await Auftrag.findOne({ artikelPosition: position._id });
//   if (!auftrag) return;

//   const zielKg = await computeZielMengeKg(position as any);
//   const bereits = await sumBereitsGebuchtKg(
//     auftrag._id.toString(),
//     position.artikel.toString(),
//     position._id.toString()
//   );
//   let delta = round3(zielKg - bereits);
//   if (Math.abs(delta) < 0.001) return; // nichts zu tun

//   const charges: string[] = Array.isArray((position as any).chargennummern)
//     ? (position as any).chargennummern
//     : [];
//   if (!charges.length) {
//     console.warn(
//       `[BestandSync] Position ${position._id} hat keine Charge ausgewählt – Buchung übersprungen.`
//     );
//     return;
//   }

//   // Lade Charge-Details, um Lagerbereich (TK/NON_TK) zu bestimmen
//   const chargeDocs = await ChargeModel.find({ _id: { $in: charges } }).lean();
//   if (!chargeDocs.length) return;

//   // Stückeln: gleichmäßig über alle angegebenen Chargen verteilen
//   const perCharge = round3(Math.abs(delta) / chargeDocs.length);

//   const session = await mongoose.startSession();
//   try {
//     await session.withTransaction(async () => {
//       for (const ch of chargeDocs) {
//         const lagerbereich: Lagerbereich = ch.isTK ? "TK" : "NON_TK";
//         const mengeSigniert = delta > 0 ? -perCharge : perCharge; // Abgang = negativ; Rückbuchung = positiv
//         const bewegung = await new BewegungModel({
//           timestamp: new Date(),
//           userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
//           typ: delta > 0 ? "KOMMISSIONIERUNG" : "INVENTUR_KORREKTUR",
//           artikelId: position.artikel,
//           artikelName: position.artikelName,
//           chargeId: ch._id,
//           menge: mengeSigniert,
//           lagerbereich,
//           auftragId: auftrag._id,
//           notiz: `[POS:${position._id.toString()}] Auto-Sync aus ArtikelPositionService`,
//           mhd: ch.mhd,
//           schlachtDatum: ch.schlachtDatum,
//           isTK: !!ch.isTK,
//         }).save({ session });

//         await upsertBestandAgg(
//           {
//             artikelId: position.artikel.toString(),
//             chargeId: ch._id.toString(),
//             lagerbereich,
//             deltaVerfuegbar: mengeSigniert,
//           },
//           session
//         );
//       }
//     });
//   } finally {
//     await session.endSession();
//   }
// }

/**
 * Erstellt eine neue Artikelposition.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type Einheit = "kg" | "stück" | "kiste" | "karton";

function isEinheit(e: any): e is Einheit {
  return ["kg", "stück", "kiste", "karton"].includes(e);
}

function computeGesamtgewicht(
  artikel: any,
  menge: number,
  einheit: Einheit
): number {
  switch (einheit) {
    case "kg":
      return round3(menge);
    case "stück":
      return round3((artikel.gewichtProStueck || 0) * menge);
    case "kiste":
      return round3((artikel.gewichtProKiste || 0) * menge);
    case "karton":
      return round3((artikel.gewichtProKarton || 0) * menge);
    default:
      return 0;
  }
}

export async function createArtikelPosition(data: {
  artikel: string;
  menge: number;
  einheit: Einheit;
  auftragId?: string;
  zerlegung?: boolean;
  vakuum?: boolean;
  bemerkung?: string;
  zerlegeBemerkung?: string;
  leergutVonPositionId?: mongoose.Types.ObjectId;
}): Promise<ArtikelPositionResource> {
  // --- Validierung ---
  if (!data.artikel) {
    throw new Error("Artikel ist erforderlich.");
  }
  if (data.menge === undefined || data.menge === null || data.menge <= 0) {
    throw new Error("Menge muss größer als 0 sein.");
  }
  if (!isEinheit(data.einheit)) {
    throw new Error("Ungültige Einheit.");
  }

  // --- Grunddaten laden ---
  const [artikel, auftrag] = await Promise.all([
    ArtikelModel.findById(data.artikel),
    data.auftragId ? Auftrag.findById(data.auftragId) : Promise.resolve(null),
  ]);

  if (!artikel) {
    throw new Error("Artikel nicht gefunden.");
  }
  if (data.auftragId && !auftrag) {
    throw new Error("Auftrag nicht gefunden.");
  }

  // --- Aufpreis / Kundenpreis ---
  let aufpreis = 0;
  if (auftrag?.kunde) {
    const kundenPreis = await getKundenPreis(
      auftrag.kunde.toString(),
      data.artikel
    );
    aufpreis = kundenPreis.aufpreis || 0;
  }

  const basispreis = artikel.preis || 0;
  const einzelpreis = round2(basispreis + aufpreis);

  // --- Gewicht & Gesamtpreis ---
  const gesamtgewicht = computeGesamtgewicht(artikel, data.menge, data.einheit);
  const gesamtpreis = round2(einzelpreis * gesamtgewicht);

  // --- Artikelposition erzeugen ---
  const newPosition = new ArtikelPosition({
    artikel: artikel._id,
    artikelName: artikel.name,
    menge: data.menge,
    einheit: data.einheit,
    zerlegung: data.zerlegung ?? false,
    vakuum: data.vakuum ?? false,
    bemerkung: (data.bemerkung || "").trim(),
    zerlegeBemerkung: data.zerlegeBemerkung,
    einzelpreis,
    gesamtgewicht,
    gesamtpreis,
    auftragId: data.auftragId,
    leergutVonPositionId: data.leergutVonPositionId,
    erfassungsModus: artikel.erfassungsModus ?? "GEWICHT",
  });

  const savedPosition = await newPosition.save();

  // --- Auftrag verknüpfen + ggf. Zerlegeauftrag anlegen ---
  if (auftrag) {
    // Auftrag immer verknüpfen (auch Leergut), Reihenfolge wird später durch reorder geregelt
    await Auftrag.findByIdAndUpdate(
      auftrag._id,
      {
        $addToSet: { artikelPosition: savedPosition._id }
      }
    );

    if (data.zerlegung) {
      let zerlegeauftrag = await ZerlegeAuftragModel.findOne({
        auftragId: auftrag._id,
        archiviert: false,
      });

      const kundenName = (auftrag as any).kunde?.name || "Unbekannt";

      if (zerlegeauftrag) {
        zerlegeauftrag.artikelPositionen.push({
          artikelPositionId: savedPosition._id.toString(),
          artikelName: savedPosition.artikelName,
          menge: savedPosition.gesamtgewicht,
          status: "offen",
          bemerkung: savedPosition.zerlegeBemerkung,
        });
        await zerlegeauftrag.save();
      } else {
        await ZerlegeAuftragModel.create({
          auftragId: auftrag._id.toString(),
          kundenName,
          artikelPositionen: [
            {
              artikelPositionId: savedPosition._id.toString(),
              artikelName: savedPosition.artikelName,
              menge: savedPosition.gesamtgewicht,
              status: "offen",
              bemerkung: savedPosition.zerlegeBemerkung,
            },
          ],
          erstelltAm: new Date(),
          archiviert: false,
        });
      }
    }
  }

  // --- Resource zurückgeben ---
  return {
    id: savedPosition._id.toString(),
    artikel: savedPosition.artikel.toString(),
    artikelName: savedPosition.artikelName,
    auftragId: savedPosition.auftragId?.toString(),
    leergutVonPositionId: savedPosition.leergutVonPositionId?.toString(),
    menge: savedPosition.menge,
    einheit: savedPosition.einheit,
    einzelpreis: savedPosition.einzelpreis,
    zerlegung: savedPosition.zerlegung,
    zerlegeBemerkung: savedPosition.zerlegeBemerkung,
    vakuum: savedPosition.vakuum,
    bemerkung: savedPosition.bemerkung,
    gesamtgewicht: savedPosition.gesamtgewicht,
    gesamtpreis: savedPosition.gesamtpreis,
    kommissioniertMenge: savedPosition.kommissioniertMenge,
    kommissioniertEinheit: savedPosition.kommissioniertEinheit,
    kommissioniertBemerkung: savedPosition.kommissioniertBemerkung,
    kommissioniertVon: savedPosition.kommissioniertVon?.toString(),
    kommissioniertVonName: savedPosition.kommissioniertVonName,
    kommissioniertAm: savedPosition.kommissioniertAm,
    bruttogewicht: savedPosition.bruttogewicht,
    leergut: savedPosition.leergut || [],
    nettogewicht: savedPosition.nettogewicht,
    chargennummern: savedPosition.chargennummern || [],
    erfassungsModus: savedPosition.erfassungsModus ?? "GEWICHT",
  };
}

/**
 * Ruft eine Artikelposition anhand der ID ab.
 */
export async function getArtikelPositionById(
  id: string
): Promise<ArtikelPositionResource> {
  const position = await ArtikelPosition.findById(id);
  if (!position) {
    throw new Error("Artikelposition nicht gefunden");
  }
  const artikel = await ArtikelModel.findById(position.artikel);

  return {
    id: position._id.toString(),
    artikel: position.artikel.toString(),
    artikelName: position.artikelName,
    auftragId: position.auftragId?.toString(),
    leergutVonPositionId: position.leergutVonPositionId?.toString(),
    artikelNummer: artikel?.artikelNummer,
    menge: position.menge,
    einheit: position.einheit,
    einzelpreis: position.einzelpreis,
    zerlegung: position.zerlegung,
    zerlegeBemerkung: position.zerlegeBemerkung,
    vakuum: position.vakuum,
    bemerkung: position.bemerkung,
    gesamtgewicht: position.gesamtgewicht,
    gesamtpreis: position.gesamtpreis,
    kommissioniertMenge: position.kommissioniertMenge,
    kommissioniertEinheit: position.kommissioniertEinheit,
    kommissioniertBemerkung: position.kommissioniertBemerkung,
    kommissioniertVon: position.kommissioniertVon?.toString(),
    kommissioniertVonName: position.kommissioniertVonName,
    kommissioniertAm: position.kommissioniertAm,
    bruttogewicht: position.bruttogewicht,
    leergut: position.leergut || [],
    nettogewicht: position.nettogewicht,
    chargennummern: position.chargennummern || [],
    erfassungsModus: position.erfassungsModus ?? "GEWICHT",
  };
}

/**
 * Ruft alle Artikelpositionen ab.
 */
export async function getAllArtikelPositionen(): Promise<
  ArtikelPositionResource[]
> {
  const positions = await ArtikelPosition.find();

  const result: ArtikelPositionResource[] = [];

  for (const pos of positions) {
    result.push({
      id: pos._id.toString(),
      artikel: pos.artikel.toString(),
      artikelName: pos.artikelName,
      auftragId: pos.auftragId?.toString(),
      leergutVonPositionId: pos.leergutVonPositionId?.toString(),
      menge: pos.menge,
      einheit: pos.einheit,
      einzelpreis: pos.einzelpreis,
      zerlegung: pos.zerlegung,
      vakuum: pos.vakuum,
      bemerkung: pos.bemerkung,
      zerlegeBemerkung: pos.zerlegeBemerkung,
      gesamtgewicht: pos.gesamtgewicht,
      gesamtpreis: pos.gesamtpreis,
      kommissioniertMenge: pos.kommissioniertMenge,
      kommissioniertEinheit: pos.kommissioniertEinheit,
      kommissioniertBemerkung: pos.kommissioniertBemerkung,
      kommissioniertVon: pos.kommissioniertVon?.toString(),
      kommissioniertVonName: pos.kommissioniertVonName,
      kommissioniertAm: pos.kommissioniertAm,
      bruttogewicht: pos.bruttogewicht,
      leergut: pos.leergut || [],
      nettogewicht: pos.nettogewicht,
      chargennummern: pos.chargennummern || [],
      erfassungsModus: pos.erfassungsModus ?? "GEWICHT",
    });
  }

  return result;
}

/**
 * Aktualisiert eine Artikelposition (nur Kommissionierungsfelder).
 * Für Kommissionierer, Kontrollierer, Admin.
 */
export async function updateArtikelPositionKommissionierung(
  id: string,
  data: Partial<{
    kommissioniertMenge?: number;
    kommissioniertEinheit?: string;
    kommissioniertBemerkung?: string;
    kommissioniertAm?: Date;
    bruttogewicht?: number;
    leergut?: {
      leergutArt: string;
      leergutAnzahl: number;
      leergutGewicht: number;
    }[];
    chargennummern?: string[];
  }>,
  userId: string,
  isAdmin: boolean
): Promise<ArtikelPositionResource> {
  // --- Helpers: robust number parsing ---
  const toNumberOrUndefined = (v: any): number | undefined => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed === "") return undefined;
      const normalized = trimmed.replace(",", ".");
      const n = Number(normalized);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };

  const isFiniteNumber = (n: any): n is number =>
    typeof n === "number" && Number.isFinite(n);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Ungültige Artikelpositions-ID");
  }
  const position = await ArtikelPosition.findById(id);
  if (!position) {
    throw new Error("Artikelposition nicht gefunden");
  }
  const auftrag = position.auftragId
    ? await Auftrag.findById(position.auftragId)
    : null;
  const kommissioniertStatus = auftrag?.kommissioniertStatus;
  const kontrolliertStatus = auftrag?.kontrolliertStatus;
  // Wer ist Kommissionierer?
  const isKommissionierer =
    auftrag?.kommissioniertVon?.toString() === userId || isAdmin;
  // Wer ist Kontrollierer?
  const isKontrollierer =
    auftrag?.kontrolliertVon?.toString() === userId || isAdmin;

  // Kommissionierung "gestartet"
  if (kommissioniertStatus === "gestartet") {
    // Falls kommissioniertVon noch nicht gesetzt, setze es
    if (!position.kommissioniertVon) {
      position.kommissioniertVon = new mongoose.Types.ObjectId(userId);
      const mitarbeiter = await Mitarbeiter.findById(userId);
      position.kommissioniertVonName = mitarbeiter?.name || "Unbekannt";
    }
    // Nur Kommissionierer/Admin darf die Felder ändern
    if (isKommissionierer) {
      if (data.kommissioniertMenge !== undefined) {
        const n = toNumberOrUndefined(data.kommissioniertMenge as any);
        if (isFiniteNumber(n)) position.kommissioniertMenge = n;
        else position.kommissioniertMenge = undefined as any;
      }

      if (
        data.kommissioniertEinheit !== undefined &&
        ["kg", "stück", "kiste", "karton"].includes(data.kommissioniertEinheit)
      ) {
        position.kommissioniertEinheit = data.kommissioniertEinheit as
          | "kg"
          | "stück"
          | "kiste"
          | "karton";
      }

      if (data.kommissioniertBemerkung !== undefined)
        position.kommissioniertBemerkung = data.kommissioniertBemerkung;

      if (data.kommissioniertAm !== undefined)
        position.kommissioniertAm = data.kommissioniertAm;

      // Bruttogewicht: nur setzen, wenn eine gültige Zahl übergeben wurde; leere Strings/null löschen den Wert
      if (Object.prototype.hasOwnProperty.call(data, "bruttogewicht")) {
        const n = toNumberOrUndefined((data as any).bruttogewicht);
        if (isFiniteNumber(n)) position.bruttogewicht = n;
        else position.bruttogewicht = undefined as any;
      }

      // Leergut: tolerant parsen; Einträge mit fehlenden Zahlen werden übersprungen
      if (data.leergut !== undefined && Array.isArray(data.leergut)) {
        const parsed = data.leergut
          .map((l) => {
            const anz = toNumberOrUndefined(l.leergutAnzahl as any);
            const gew = toNumberOrUndefined(l.leergutGewicht as any);
            if (!isFiniteNumber(anz) || !isFiniteNumber(gew)) return null;
            return {
              leergutArt: String(l.leergutArt || ""),
              leergutAnzahl: anz,
              leergutGewicht: gew,
            };
          })
          .filter(
            (
              x
            ): x is {
              leergutArt: string;
              leergutAnzahl: number;
              leergutGewicht: number;
            } => x !== null
          );


        position.leergut = parsed;

        // 🔁 Entferne alte Leergut-Artikelpositionen, deren Art nicht mehr vorhanden ist
        if (auftrag) {
          const erlaubteArtikelIds: string[] = [];

          for (const l of parsed) {
            const key = String(l.leergutArt || "").trim().toLowerCase();
            const artikelName = LEERGUT_OPTION_TO_ARTIKELNAME[key];
            if (!artikelName) continue;

            const artikel = await ArtikelModel.findOne({
              name: artikelName,
              kategorie: "Leergut",
            }).lean();

            if (artikel?._id) {
              erlaubteArtikelIds.push(artikel._id.toString());
            }
          }


          await ArtikelPosition.deleteMany({
            auftragId: auftrag._id,
            leergutVonPositionId: position._id,
            artikel: { $nin: erlaubteArtikelIds.map(id => new mongoose.Types.ObjectId(id)) },
          });
        }

        // ⚠️ Leergut-Artikelpositionen zum Auftrag hinzufügen
        if (auftrag && parsed.length > 0) {
          for (const l of parsed) {
            await createLeergutArtikelPositionFromSelection(
              auftrag.id.toString(),
              position._id.toString(),
              l.leergutArt,
              l.leergutAnzahl
            );
          }
        }
      }

      if (data.chargennummern !== undefined)
        position.chargennummern = data.chargennummern;
    }
    // Nettogewicht automatisch berechnen
    {
      const brutto = position.bruttogewicht;
      const hatLeergut =
        Array.isArray(position.leergut ?? []) &&
        (position.leergut ?? []).length > 0;
      if (isFiniteNumber(brutto) && hatLeergut) {
        const leerSumme = (position.leergut ?? []).reduce((sum, l) => {
          const anz = toNumberOrUndefined((l as any).leergutAnzahl);
          const gew = toNumberOrUndefined((l as any).leergutGewicht);
          if (!isFiniteNumber(anz) || !isFiniteNumber(gew)) return sum;
          return sum + anz * gew;
        }, 0);
        position.nettogewicht = brutto - leerSumme;
      } else if (isFiniteNumber(brutto)) {
        // Kein Leergut angegeben → Nettogewicht = Brutto
        position.nettogewicht = brutto;
      } else {
        // Kein/ungültiges Bruttogewicht → Nettogewicht entfernen
        (position as any).nettogewicht = undefined;
      }
    }
  }
  // Kommissionierung fertig, Kontrolle offen
  else if (
    kommissioniertStatus === "fertig" &&
    kontrolliertStatus === "in Kontrolle"
  ) {
    // Nur Kontrollierer/Admin darf diese Felder ändern
    if (isKontrollierer) {
      if (data.kommissioniertMenge !== undefined) {
        const n = toNumberOrUndefined(data.kommissioniertMenge as any);
        if (isFiniteNumber(n)) position.kommissioniertMenge = n;
        else position.kommissioniertMenge = undefined as any;
      }

      if (
        data.kommissioniertEinheit !== undefined &&
        ["kg", "stück", "kiste", "karton"].includes(data.kommissioniertEinheit)
      ) {
        position.kommissioniertEinheit = data.kommissioniertEinheit as
          | "kg"
          | "stück"
          | "kiste"
          | "karton";
      }

      if (data.kommissioniertBemerkung !== undefined)
        position.kommissioniertBemerkung = data.kommissioniertBemerkung;

      if (data.kommissioniertAm !== undefined)
        position.kommissioniertAm = data.kommissioniertAm;

      // Bruttogewicht: nur setzen, wenn eine gültige Zahl übergeben wurde; leere Strings/null löschen den Wert
      if (Object.prototype.hasOwnProperty.call(data, "bruttogewicht")) {
        const n = toNumberOrUndefined((data as any).bruttogewicht);
        if (isFiniteNumber(n)) position.bruttogewicht = n;
        else position.bruttogewicht = undefined as any;
      }

      // Leergut: tolerant parsen; Einträge mit fehlenden Zahlen werden übersprungen
      // Leergut: tolerant parsen; Einträge mit fehlenden Zahlen werden übersprungen
      if (data.leergut !== undefined && Array.isArray(data.leergut)) {
        const parsed = data.leergut
          .map((l) => {
            const anz = toNumberOrUndefined(l.leergutAnzahl as any);
            const gew = toNumberOrUndefined(l.leergutGewicht as any);
            if (!isFiniteNumber(anz) || !isFiniteNumber(gew)) return null;
            return {
              leergutArt: String(l.leergutArt || ""),
              leergutAnzahl: anz,
              leergutGewicht: gew,
            };
          })
          .filter(
            (
              x
            ): x is {
              leergutArt: string;
              leergutAnzahl: number;
              leergutGewicht: number;
            } => x !== null
          );

        position.leergut = parsed;

        // ⚠️ Leergut-Artikelpositionen zum Auftrag hinzufügen
        if (auftrag && parsed.length > 0) {
          // Kontrollierer erzeugt kein Leergut mehr
        }
      }

      if (data.chargennummern !== undefined)
        position.chargennummern = data.chargennummern;
    }
    // Nettogewicht automatisch berechnen
    {
      const brutto = position.bruttogewicht;
      const hatLeergut =
        Array.isArray(position.leergut ?? []) &&
        (position.leergut ?? []).length > 0;
      if (isFiniteNumber(brutto) && hatLeergut) {
        const leerSumme = (position.leergut ?? []).reduce((sum, l) => {
          const anz = toNumberOrUndefined((l as any).leergutAnzahl);
          const gew = toNumberOrUndefined((l as any).leergutGewicht);
          if (!isFiniteNumber(anz) || !isFiniteNumber(gew)) return sum;
          return sum + anz * gew;
        }, 0);
        position.nettogewicht = brutto - leerSumme;
      } else if (isFiniteNumber(brutto)) {
        // Kein Leergut angegeben → Nettogewicht = Brutto
        position.nettogewicht = brutto;
      } else {
        // Kein/ungültiges Bruttogewicht → Nettogewicht entfernen
        (position as any).nettogewicht = undefined;
      }
    }
  }
  // In allen anderen Fällen: diese Felder NICHT ändern (ignorieren)

  const updated = await position.save();

  return {
    id: updated._id.toString(),
    artikel: updated.artikel.toString(),
    artikelName: updated.artikelName,
    auftragId: updated.auftragId?.toString(),
    leergutVonPositionId: updated.leergutVonPositionId?.toString(),
    menge: updated.menge,
    einheit: updated.einheit,
    einzelpreis: updated.einzelpreis,
    zerlegung: updated.zerlegung,
    vakuum: updated.vakuum,
    bemerkung: updated.bemerkung,
    zerlegeBemerkung: updated.zerlegeBemerkung,
    gesamtgewicht: updated.gesamtgewicht,
    gesamtpreis: updated.gesamtpreis,
    kommissioniertMenge: updated.kommissioniertMenge,
    kommissioniertEinheit: updated.kommissioniertEinheit,
    kommissioniertBemerkung: updated.kommissioniertBemerkung,
    kommissioniertVon: updated.kommissioniertVon?.toString(),
    kommissioniertVonName: updated.kommissioniertVonName,
    kommissioniertAm: updated.kommissioniertAm,
    bruttogewicht: updated.bruttogewicht,
    leergut: updated.leergut || [],
    nettogewicht: updated.nettogewicht,
    chargennummern: updated.chargennummern || [],
  };
}

/**
 * Aktualisiert eine Artikelposition (nur normale Felder, Admin-only).
 */
export async function updateArtikelPositionNormale(
  id: string,
  data: Partial<{
    artikel: string;
    menge: number;
    einheit: "kg" | "stück" | "kiste" | "karton";
    einzelpreis: number;
    zerlegung: boolean;
    vakuum: boolean;
    bemerkung: string;
    zerlegeBemerkung: string;
  }>
): Promise<ArtikelPositionResource> {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Ungültige Artikelpositions-ID");
  }
  const position = await ArtikelPosition.findById(id);
  if (!position) {
    throw new Error("Artikelposition nicht gefunden");
  }
  // Stelle sicher, dass artikelName gesetzt ist
  if (!position.artikelName) {
    const curArtikelDoc = await ArtikelModel.findById(position.artikel);
    if (curArtikelDoc) {
      position.artikelName = curArtikelDoc.name;
    }
  }
  // Falls Artikel geändert wird, neuen Artikel laden
  if (data.artikel && data.artikel !== position.artikel.toString()) {
    const neuerArtikel = await ArtikelModel.findById(data.artikel);
    if (!neuerArtikel) {
      throw new Error("Neuer Artikel nicht gefunden");
    }
    position.artikel = neuerArtikel._id;
    position.artikelName = neuerArtikel.name;
  }
  // Andere Felder aktualisieren
  if (data.menge !== undefined) position.menge = data.menge;
  const erlaubteEinheiten = ["kg", "stück", "kiste", "karton"] as const;
  type Einheit = (typeof erlaubteEinheiten)[number];
  function isEinheit(value: any): value is Einheit {
    return erlaubteEinheiten.includes(value);
  }
  if (data.einheit && isEinheit(data.einheit)) {
    position.einheit = data.einheit;
  } else if (data.einheit) {
    throw new Error("Ungültige Einheit");
  }
  if (data.zerlegung !== undefined) {
    // Falls vorher nicht Zerlegung und jetzt aktiviert → Zerlegeauftrag anlegen
    const vorherZerlegung = position.zerlegung;
    position.zerlegung = data.zerlegung;
    if (!vorherZerlegung && data.zerlegung) {
      const auftrag = await Auftrag.findOne({
        artikelPosition: position._id,
      }).populate<{ kunde: { name: string } }>("kunde");
      if (auftrag) {
        const kundenName = auftrag.kunde?.name || "Unbekannt";
        const artikelDocForZ = await ArtikelModel.findById(position.artikel);
        const artikelNameResolved =
          position.artikelName || artikelDocForZ?.name || "Unbekannt";
        let zerlegeauftrag = await ZerlegeAuftragModel.findOne({
          auftragId: auftrag._id,
          archiviert: false,
        });
        if (zerlegeauftrag) {
          zerlegeauftrag.artikelPositionen.push({
            artikelPositionId: position._id.toString(),
            artikelName: artikelNameResolved,
            menge: position.gesamtgewicht,
            bemerkung: position.zerlegeBemerkung,
            status: "offen",
          });
          await zerlegeauftrag.save();
        } else {
          await ZerlegeAuftragModel.create({
            auftragId: auftrag._id.toString(),
            auftragsnummer: auftrag.auftragsnummer,
            kundenName,
            artikelPositionen: [
              {
                artikelPositionId: position._id.toString(),
                artikelName: artikelNameResolved,
                menge: position.gesamtgewicht,
                bemerkung: position.zerlegeBemerkung,
                status: "offen",
              },
            ],
            erstelltAm: new Date(),
            archiviert: false,
          });
        }
      }
    }
    if (vorherZerlegung && data.zerlegung) {
      const artikelDocForZ = await ArtikelModel.findById(position.artikel);
      const artikelNameResolved =
        position.artikelName || artikelDocForZ?.name || "Unbekannt";
      const zerlegeauftrag = await ZerlegeAuftragModel.findOne({
        "artikelPositionen.artikelPositionId": position._id,
      });
      if (zerlegeauftrag) {
        // Duplikate verhindern
        zerlegeauftrag.artikelPositionen =
          zerlegeauftrag.artikelPositionen.filter(
            (p) => p.artikelPositionId !== position._id.toString()
          );
        zerlegeauftrag.artikelPositionen.push({
          artikelPositionId: position._id.toString(),
          artikelName: artikelNameResolved,
          menge: position.gesamtgewicht,
          bemerkung: position.zerlegeBemerkung,
          status: "offen",
        });
        await zerlegeauftrag.save();
      }
    }
    if (vorherZerlegung && !data.zerlegung) {
      const zerlegeauftrag = await ZerlegeAuftragModel.findOne({
        "artikelPositionen.artikelPositionId": position._id,
      });
      if (zerlegeauftrag) {
        const neuePositionen = zerlegeauftrag.artikelPositionen.filter(
          (p) => p.artikelPositionId.toString() !== position._id.toString()
        );
        if (neuePositionen.length === 0) {
          // Letzte Position wurde entfernt → gesamten Auftrag löschen
          await ZerlegeAuftragModel.findByIdAndDelete(zerlegeauftrag._id);
        } else {
          // Nur diese Position entfernen
          zerlegeauftrag.artikelPositionen = neuePositionen;
          await zerlegeauftrag.save();
        }
      }
    }
  }
  if (data.vakuum !== undefined) position.vakuum = data.vakuum;
  if (data.bemerkung !== undefined) position.bemerkung = data.bemerkung.trim();
  if (data.zerlegeBemerkung !== undefined)
    position.zerlegeBemerkung = data.zerlegeBemerkung.trim();
  // Optional: Gewicht neu berechnen, wenn menge oder einheit geändert wurden
  if (data.menge !== undefined || data.einheit) {
    const artikel = await ArtikelModel.findById(position.artikel);
    if (artikel) {
      let gesamtgewicht = 0;
      switch (position.einheit) {
        case "kg":
          gesamtgewicht = position.menge;
          break;
        case "stück":
          gesamtgewicht = (artikel.gewichtProStueck || 0) * position.menge;
          break;
        case "kiste":
          gesamtgewicht = (artikel.gewichtProKiste || 0) * position.menge;
          break;
        case "karton":
          gesamtgewicht = (artikel.gewichtProKarton || 0) * position.menge;
          break;
      }
      position.gesamtgewicht = gesamtgewicht;
    }
  }
  // Einzelpreis: entweder manuell übergeben oder automatisch berechnen
  if (data.einzelpreis !== undefined) {
    // Manuell gesetzter Einzelpreis
    position.einzelpreis = round2(data.einzelpreis);
  } else {
    // Einzelpreis mit getKundenPreis basierend auf Auftrag ermitteln
    const auftrag = position.auftragId
      ? await Auftrag.findById(position.auftragId)
      : null;
    let aufpreis = 0;
    if (auftrag && auftrag.kunde) {
      const kundenPreis = await getKundenPreis(
        auftrag.kunde.toString(),
        position.artikel.toString()
      );
      aufpreis = kundenPreis.aufpreis;
    }
    const artikel = await ArtikelModel.findById(position.artikel);
    const basispreis = artikel?.preis ?? 0;
    position.einzelpreis = round2(basispreis + aufpreis);
  }
  // Gesamtpreis neu berechnen
  position.gesamtpreis = round2(position.einzelpreis * (position.gesamtgewicht ?? 0));
  const updated = await position.save();
  if (updated.zerlegung === true) {
    const zerlegeauftrag = await ZerlegeAuftragModel.findOne({
      "artikelPositionen.artikelPositionId": updated._id,
    });
    if (zerlegeauftrag) {
      const artikelDocForZ2 = await ArtikelModel.findById(updated.artikel);
      const artikelNameResolved2 =
        updated.artikelName || artikelDocForZ2?.name || "Unbekannt";
      // Duplikate verhindern
      zerlegeauftrag.artikelPositionen =
        zerlegeauftrag.artikelPositionen.filter(
          (p) => p.artikelPositionId !== updated._id.toString()
        );
      zerlegeauftrag.artikelPositionen.push({
        artikelPositionId: updated._id.toString(),
        artikelName: artikelNameResolved2,
        menge: updated.gesamtgewicht,
        bemerkung: updated.zerlegeBemerkung,
        status: "offen",
      });
      await zerlegeauftrag.save();
    }
  }
  return {
    id: updated._id.toString(),
    artikel: updated.artikel.toString(),
    artikelName: updated.artikelName,
    auftragId: updated.auftragId?.toString(),
    leergutVonPositionId: updated.leergutVonPositionId?.toString(),
    menge: updated.menge,
    einheit: updated.einheit,
    einzelpreis: updated.einzelpreis,
    zerlegung: updated.zerlegung,
    vakuum: updated.vakuum,
    bemerkung: updated.bemerkung,
    zerlegeBemerkung: updated.zerlegeBemerkung,
    gesamtgewicht: updated.gesamtgewicht,
    gesamtpreis: updated.gesamtpreis,
    kommissioniertMenge: updated.kommissioniertMenge,
    kommissioniertEinheit: updated.kommissioniertEinheit,
    kommissioniertBemerkung: updated.kommissioniertBemerkung,
    kommissioniertVon: updated.kommissioniertVon?.toString(),
    kommissioniertVonName: updated.kommissioniertVonName,
    kommissioniertAm: updated.kommissioniertAm,
    bruttogewicht: updated.bruttogewicht,
    leergut: updated.leergut || [],
    nettogewicht: updated.nettogewicht,
    chargennummern: updated.chargennummern || [],
  };
}

/**
 * Aktualisiert Leergut einer Artikelposition.
 * - Hinzufügen neuer Leergutarten
 * - Aktualisieren von Anzahl/Gewicht
 * - Entfernen von Leergut (Anzahl <= 0 oder nicht mehr übergeben)
 * Synchronisiert automatisch die zugehörigen Leergut‑Artikelpositionen im Auftrag.
 */
export async function updateLeergut(
  positionId: string,
  leergutInput: {
    leergutArt: string;
    leergutAnzahl: number;
    leergutGewicht: number;
  }[]
): Promise<ArtikelPositionResource> {
  if (!mongoose.Types.ObjectId.isValid(positionId)) {
    throw new Error("Ungültige Artikelpositions-ID");
  }

  const position = await ArtikelPosition.findById(positionId);
  if (!position) {
    throw new Error("Artikelposition nicht gefunden");
  }

  const auftrag = position.auftragId
    ? await Auftrag.findById(position.auftragId)
    : null;

  if (!auftrag) {
    throw new Error("Kein Auftrag zur Artikelposition gefunden");
  }

  // --- Leergut normalisieren & validieren ---
  const normalized = leergutInput
    .map((l) => ({
      leergutArt: String(l.leergutArt || "").trim(),
      leergutAnzahl: Number(l.leergutAnzahl),
      leergutGewicht: Number(l.leergutGewicht),
    }))
    .filter(
      (l) =>
        l.leergutArt &&
        Number.isFinite(l.leergutAnzahl) &&
        Number.isFinite(l.leergutGewicht)
    );

  // --- Leergut an Position setzen ---
  position.leergut = normalized;
  await position.save();

  // --- erlaubte Leergut‑Artikel ermitteln ---
  const erlaubteArtikelIds: string[] = [];

  for (const l of normalized) {
    const key = l.leergutArt.toLowerCase();
    const artikelName = LEERGUT_OPTION_TO_ARTIKELNAME[key];
    if (!artikelName) continue;

    const artikel = await ArtikelModel.findOne({
      name: artikelName,
      kategorie: "Leergut",
    }).lean();

    if (artikel?._id) {
      erlaubteArtikelIds.push(artikel._id.toString());
    }
  }

  // --- nicht mehr vorhandenes Leergut entfernen ---
  await ArtikelPosition.deleteMany({
    auftragId: auftrag._id,
    leergutVonPositionId: position._id,
    artikel: {
      $nin: erlaubteArtikelIds.map((id) => new mongoose.Types.ObjectId(id)),
    },
  });

  // --- Leergut‑Artikelpositionen upserten ---
  for (const l of normalized) {
    if (l.leergutAnzahl <= 0) continue;

    await createLeergutArtikelPositionFromSelection(
      auftrag._id.toString(),
      position._id.toString(),
      l.leergutArt,
      l.leergutAnzahl
    );
  }

  // --- Nettogewicht neu berechnen ---
  if (typeof position.bruttogewicht === "number") {
    const leerSumme = normalized.reduce(
      (sum, l) => sum + l.leergutAnzahl * l.leergutGewicht,
      0
    );
    position.nettogewicht = position.bruttogewicht - leerSumme;
    await position.save();
  }

  return {
    id: position._id.toString(),
    artikel: position.artikel.toString(),
    artikelName: position.artikelName,
    auftragId: position.auftragId?.toString(),
    leergutVonPositionId: position.leergutVonPositionId?.toString(),
    menge: position.menge,
    einheit: position.einheit,
    einzelpreis: position.einzelpreis,
    gesamtgewicht: position.gesamtgewicht,
    gesamtpreis: position.gesamtpreis,
    bruttogewicht: position.bruttogewicht,
    nettogewicht: position.nettogewicht,
    leergut: position.leergut || [],
    chargennummern: position.chargennummern || [],
  };
}
//delete
export async function deleteArtikelPosition(id: string): Promise<void> {
  const deleted = await ArtikelPosition.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error("Artikelposition nicht gefunden");
  }

  // Entferne diese Position auch aus dem Zerlegeauftrag, falls vorhanden
  const zerlegeauftrag = await ZerlegeAuftragModel.findOne({
    "artikelPositionen.artikelPositionId": deleted._id,
  });
  if (zerlegeauftrag) {
    const neuePositionen = zerlegeauftrag.artikelPositionen.filter(
      (p) => p.artikelPositionId.toString() !== deleted._id.toString()
    );

    if (neuePositionen.length === 0) {
      // Letzte Position wurde entfernt → gesamten Auftrag löschen
      await ZerlegeAuftragModel.findByIdAndDelete(zerlegeauftrag._id);
    } else {
      // Nur diese Position entfernen
      zerlegeauftrag.artikelPositionen = neuePositionen;
      await zerlegeauftrag.save();
    }
  }
}

export async function deleteAllArtikelPosition(): Promise<void> {
  const deleted = await ArtikelPosition.deleteMany({});
  if (!deleted) {
    throw new Error("Artikelposition nicht gefunden");
  }
}
