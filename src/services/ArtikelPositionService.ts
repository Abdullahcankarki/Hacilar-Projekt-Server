import { ArtikelPosition } from "../model/ArtikelPositionModel";
import { Mitarbeiter } from "../model/MitarbeiterModel";
import { ArtikelModel } from "../model/ArtikelModel"; // ✅ Hinzugefügt
import { ArtikelPositionResource } from "../Resources";
import { KundenPreisModel } from "../model/KundenPreisModel";
import { Auftrag } from "../model/AuftragModel";
import { getKundenPreis } from "./KundenPreisService"; // Pfad ggf. anpassen
import { ZerlegeAuftragModel } from "../model/ZerlegeAuftragModel";
import mongoose from "mongoose";

// ... Importe bleiben gleich

const EMPTY_ARTIKEL = {
  name: "Unbekannter Artikel",
  preis: 1,
  gewichtProStueck: 1,
  gewichtProKiste: 1,
  gewichtProKarton: 1,
};

/**
 * Erstellt eine neue Artikelposition.
 */

export async function createArtikelPosition(data: {
  artikel: string;
  menge: number;
  einheit: "kg" | "stück" | "kiste" | "karton";
  auftragId?: string; // Optional
  zerlegung?: boolean;
  vakuum?: boolean;
  bemerkung?: string;
  zerlegeBemerkung?: string;
}): Promise<ArtikelPositionResource> {
  if (!data.artikel || !data.menge || !data.einheit) {
    throw new Error("Fehlende Felder bei der Artikelposition.");
  }

  // Artikel laden
  const artikel = await ArtikelModel.findById(data.artikel);
  if (!artikel) {
    throw new Error("Artikel nicht gefunden.");
  }

  let aufpreis = 0;

  // Nur wenn Auftrag-ID existiert:
  if (data.auftragId) {
    const auftrag = await Auftrag.findById(data.auftragId);
    if (!auftrag) {
      throw new Error("Auftrag nicht gefunden.");
    }

    if (auftrag.kunde) {
      const kundenPreis = await getKundenPreis(
        auftrag.kunde.toString(),
        data.artikel
      );
      aufpreis = kundenPreis.aufpreis;
    }
  }

  const basispreis = artikel.preis || 0;
  const einzelpreis = basispreis + aufpreis;

  // Gewicht berechnen
  let gesamtgewicht = 0;
  switch (data.einheit) {
    case "kg":
      gesamtgewicht = data.menge;
      break;
    case "stück":
      gesamtgewicht = (artikel.gewichtProStueck || 0) * data.menge;
      break;
    case "kiste":
      gesamtgewicht = (artikel.gewichtProKiste || 0) * data.menge;
      break;
    case "karton":
      gesamtgewicht = (artikel.gewichtProKarton || 0) * data.menge;
      break;
  }

  const gesamtpreis = einzelpreis * gesamtgewicht;

  // Artikelposition erstellen
  const newPosition = new ArtikelPosition({
    artikel: artikel._id,
    artikelName: artikel.name,
    menge: data.menge,
    einheit: data.einheit,
    zerlegung: data.zerlegung ?? false,
    vakuum: data.vakuum ?? false,
    bemerkung: data.bemerkung?.trim() || "",
    zerlegeBemerkung: data.zerlegeBemerkung,
    einzelpreis,
    gesamtgewicht,
    gesamtpreis,
    auftragId: data.auftragId, // ensure auftragId is saved in the position
    erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT'
  });

  const savedPosition = await newPosition.save();
// Test
  // Artikelposition-ID zum Auftrag hinzufügen, wenn Auftrag angegeben wurde
  if (data.auftragId) {
    const auftrag = await Auftrag.findById(data.auftragId);
    if (auftrag) {
      if (!auftrag.artikelPosition) {
        auftrag.artikelPosition = [];
      }
      auftrag.artikelPosition.push(savedPosition._id);
      await auftrag.save();

      if (data.zerlegung && data.auftragId) {
        let zerlegeauftrag = await ZerlegeAuftragModel.findOne({
          auftragId: data.auftragId,
          archiviert: false,
        });

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
          const auftragPopulated = await Auftrag.findById(
            data.auftragId
          ).populate<{ kunde: { name: string } }>("kunde");
          const kundenName = auftragPopulated?.kunde?.name || "Unbekannt";

          await ZerlegeAuftragModel.create({
            auftragId: data.auftragId,
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
  }

  return {
    id: savedPosition._id.toString(),
    artikel: savedPosition.artikel.toString(),
    artikelName: savedPosition.artikelName,
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
    erfassungsModus: savedPosition.erfassungsModus ?? 'GEWICHT'
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

  return {
    id: position._id.toString(),
    artikel: position.artikel.toString(),
    artikelName: position.artikelName,
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
    erfassungsModus: position.erfassungsModus ?? 'GEWICHT'
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
      erfassungsModus: pos.erfassungsModus ?? 'GEWICHT'
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
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed === '') return undefined;
      const normalized = trimmed.replace(',', '.');
      const n = Number(normalized);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };

  const isFiniteNumber = (n: any): n is number => typeof n === 'number' && Number.isFinite(n);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Ungültige Artikelpositions-ID");
  }
  const position = await ArtikelPosition.findById(id);
  if (!position) {
    throw new Error("Artikelposition nicht gefunden");
  }
  const auftrag = await Auftrag.findOne({ artikelPosition: id });
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
      if (Object.prototype.hasOwnProperty.call(data, 'bruttogewicht')) {
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
              leergutArt: String(l.leergutArt || ''),
              leergutAnzahl: anz,
              leergutGewicht: gew,
            };
          })
          .filter((x): x is { leergutArt: string; leergutAnzahl: number; leergutGewicht: number } => x !== null);

        position.leergut = parsed;
      }

      if (data.chargennummern !== undefined)
        position.chargennummern = data.chargennummern;
    }
    // Nettogewicht automatisch berechnen
    {
      const brutto = position.bruttogewicht;
      const hatLeergut = Array.isArray(position.leergut ?? []) && (position.leergut ?? []).length > 0;
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
      if (Object.prototype.hasOwnProperty.call(data, 'bruttogewicht')) {
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
              leergutArt: String(l.leergutArt || ''),
              leergutAnzahl: anz,
              leergutGewicht: gew,
            };
          })
          .filter((x): x is { leergutArt: string; leergutAnzahl: number; leergutGewicht: number } => x !== null);

        position.leergut = parsed;
      }

      if (data.chargennummern !== undefined)
        position.chargennummern = data.chargennummern;
    }
    // Nettogewicht automatisch berechnen
    {
      const brutto = position.bruttogewicht;
      const hatLeergut = Array.isArray(position.leergut ?? []) && (position.leergut ?? []).length > 0;
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
        let zerlegeauftrag = await ZerlegeAuftragModel.findOne({
          auftragId: auftrag._id,
          archiviert: false,
        });
        if (zerlegeauftrag) {
          zerlegeauftrag.artikelPositionen.push({
            artikelPositionId: position._id.toString(),
            artikelName: position.artikelName,
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
                artikelName: position.artikelName,
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
          artikelName: position.artikelName,
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
  // Einzelpreis mit getKundenPreis basierend auf Auftrag ermitteln
  const auftrag = await Auftrag.findOne({ artikelPosition: id });
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
  position.einzelpreis = basispreis + aufpreis;
  // Gesamtpreis neu berechnen
  position.gesamtpreis = position.einzelpreis * (position.gesamtgewicht ?? 0);
  const updated = await position.save();
  if (updated.zerlegung === true) {
    const zerlegeauftrag = await ZerlegeAuftragModel.findOne({
      "artikelPositionen.artikelPositionId": updated._id,
    });
    if (zerlegeauftrag) {
      // Duplikate verhindern
      zerlegeauftrag.artikelPositionen =
        zerlegeauftrag.artikelPositionen.filter(
          (p) => p.artikelPositionId !== updated._id.toString()
        );
      zerlegeauftrag.artikelPositionen.push({
        artikelPositionId: updated._id.toString(),
        artikelName: updated.artikelName,
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
