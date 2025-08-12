import { KundenPreisModel } from '../model/KundenPreisModel';
import { ArtikelModel } from '../model/ArtikelModel'; // Pfad ggf. anpassen
import { ArtikelResource } from '../Resources';    // Pfad ggf. anpassen
import { getKundenPreis } from './KundenPreisService';
import { Types } from 'mongoose';

/**
 * Erstellt einen neuen Artikel.
 */
export async function createArtikel(data: {
  preis: number;
  artikelNummer: string;
  name: string;
  kategorie: string;
  gewichtProStueck?: number;
  gewichtProKarton?: number;
  gewichtProKiste?: number;
  bildUrl?: string;
  ausverkauft?: boolean;
  erfassungsModus?: string;
}): Promise<ArtikelResource> {
  const newArtikel = new ArtikelModel({
    preis: data.preis,
    artikelNummer: data.artikelNummer,
    name: data.name,
    kategorie: data.kategorie,
    gewichtProStueck: data.gewichtProStueck,
    gewichtProKarton: data.gewichtProKarton,
    gewichtProKiste: data.gewichtProKiste,
    bildUrl: data.bildUrl,
    ausverkauft: data.ausverkauft,
    erfassungsModus: data.erfassungsModus ?? 'GEWICHT'
  });
  const saved = await newArtikel.save();
  return {
    id: saved._id.toString(),
    preis: saved.preis,
    artikelNummer: saved.artikelNummer,
    name: saved.name,
    kategorie: saved.kategorie,
    gewichtProStueck: saved.gewichtProStueck,
    gewichtProKarton: saved.gewichtProKarton,
    gewichtProKiste: saved.gewichtProKiste,
    bildUrl: saved.bildUrl,
    ausverkauft: saved.ausverkauft,
    erfassungsModus: saved.erfassungsModus ?? 'GEWICHT',
  };
}

/**
 * Ruft einen Artikel anhand der ID ab.
 */
export async function getArtikelById(
  id: string,
  customerId?: string
): Promise<ArtikelResource> {
  const artikel = await ArtikelModel.findById(id);
  if (!artikel) {
    throw new Error('Artikel nicht gefunden');
  }

  // Basispreis
  let preis = artikel.preis;

  // Kundenaufschlag abrufen, falls customerId vorhanden
  if (customerId) {
    const kundenPreis = await getKundenPreis(customerId, id);
    if (kundenPreis) {
      preis += kundenPreis.aufpreis;
    }
  }

  return {
    id: artikel._id.toString(),
    preis,
    artikelNummer: artikel.artikelNummer,
    name: artikel.name,
    kategorie: artikel.kategorie,
    gewichtProStueck: artikel.gewichtProStueck,
    gewichtProKarton: artikel.gewichtProKarton,
    gewichtProKiste: artikel.gewichtProKiste,
    bildUrl: artikel.bildUrl,
    ausverkauft: artikel.ausverkauft,
    erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT',
  };
}

/**
 * Ruft alle Artikel ab.
 */
export async function getAllArtikel(customerId?: string): Promise<ArtikelResource[]> {
  // 1. Alle Artikel laden
  const artikelList = await ArtikelModel.find();

  // 2. Wenn kein Kunde angegeben ist, einfach Artikel ohne Aufpreis zurückgeben
  if (!customerId) {
    return artikelList.map(artikel => ({
      id: artikel._id.toString(),
      preis: artikel.preis,
      artikelNummer: artikel.artikelNummer,
      name: artikel.name,
      kategorie: artikel.kategorie,
      gewichtProStueck: artikel.gewichtProStueck,
      gewichtProKarton: artikel.gewichtProKarton,
      gewichtProKiste: artikel.gewichtProKiste,
      bildUrl: artikel.bildUrl,
      ausverkauft: artikel.ausverkauft,
      erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT'
    }));
  }

  // 3. Alle Kundenpreise für den Kunden in einem Schritt laden
  const kundenPreise = await KundenPreisModel.find({ customer: new Types.ObjectId(customerId) });

  // 4. Map zur schnellen Zuordnung: artikelId (als String) => aufpreis
  const preisMap = new Map<string, number>(
    kundenPreise.map(p => [p.artikel.toHexString(), p.aufpreis])
  );

  // 5. Artikel + Aufpreis kombinieren
  return artikelList.map(artikel => {
    const aufpreis = preisMap.get(artikel._id.toHexString()) || 0;
    return {
      id: artikel._id.toString(),
      preis: artikel.preis + aufpreis,
      artikelNummer: artikel.artikelNummer,
      name: artikel.name,
      kategorie: artikel.kategorie,
      gewichtProStueck: artikel.gewichtProStueck,
      gewichtProKarton: artikel.gewichtProKarton,
      gewichtProKiste: artikel.gewichtProKiste,
      bildUrl: artikel.bildUrl,
      ausverkauft: artikel.ausverkauft,
      erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT'
    };
  });
}

/**
 * Ruft einen Artikel ohne Aufpreis berechnung anhand der ID ab.
 */

export async function getArtikelByIdClean(
  id: string,
  customerId?: string
): Promise<ArtikelResource> {
  const artikel = await ArtikelModel.findById(id);
  if (!artikel) {
    throw new Error('Artikel nicht gefunden');
  }

  return {
    id: artikel._id.toString(),
    preis: artikel.preis,
    artikelNummer: artikel.artikelNummer,
    name: artikel.name,
    kategorie: artikel.kategorie,
    gewichtProStueck: artikel.gewichtProStueck,
    gewichtProKarton: artikel.gewichtProKarton,
    gewichtProKiste: artikel.gewichtProKiste,
    bildUrl: artikel.bildUrl,
    ausverkauft: artikel.ausverkauft,
    erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT'
  };
}

/**
 * Ruft alle Artikel ab.
 */
export async function getAllArtikelClean(): Promise<ArtikelResource[]> {
  const artikelList = await ArtikelModel.find();

  const result: ArtikelResource[] = [];

  for (const artikel of artikelList) {

    result.push({
      id: artikel._id.toString(),
      preis: artikel.preis,
      artikelNummer: artikel.artikelNummer,
      name: artikel.name,
      kategorie: artikel.kategorie,
      gewichtProStueck: artikel.gewichtProStueck,
      gewichtProKarton: artikel.gewichtProKarton,
      gewichtProKiste: artikel.gewichtProKiste,
      bildUrl: artikel.bildUrl,
      ausverkauft: artikel.ausverkauft,
      erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT'
    });
  }

  return result;
}

/**
 * Ruft Artikel anhand einer Liste von Namen ab.
 */
export async function getArtikelByNames(
  names: string[],
  customerId?: string
): Promise<ArtikelResource[]> {
  // 1. Artikel anhand der Namen finden
  const artikelList = await ArtikelModel.find({ name: { $in: names } });

  // 2. Wenn kein Kunde angegeben ist, einfach Artikel ohne Aufpreis zurückgeben
  if (!customerId) {
    return artikelList.map(artikel => ({
      id: artikel._id.toString(),
      preis: artikel.preis,
      artikelNummer: artikel.artikelNummer,
      name: artikel.name,
      kategorie: artikel.kategorie,
      gewichtProStueck: artikel.gewichtProStueck,
      gewichtProKarton: artikel.gewichtProKarton,
      gewichtProKiste: artikel.gewichtProKiste,
      bildUrl: artikel.bildUrl,
      ausverkauft: artikel.ausverkauft,
      erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT'
    }));
  }

  // 3. Alle Kundenpreise für diese Artikel laden
  const kundenPreise = await KundenPreisModel.find({
    customer: new Types.ObjectId(customerId),
    artikel: { $in: artikelList.map(a => a._id) },
  });

  // 4. Map zur schnellen Zuordnung
  const preisMap = new Map<string, number>(
    kundenPreise.map(p => [p.artikel.toHexString(), p.aufpreis])
  );

  // 5. Ergebnis zusammenbauen
  return artikelList.map(artikel => {
    const aufpreis = preisMap.get(artikel._id.toHexString()) || 0;
    return {
      id: artikel._id.toString(),
      preis: artikel.preis + aufpreis,
      artikelNummer: artikel.artikelNummer,
      name: artikel.name,
      kategorie: artikel.kategorie,
      gewichtProStueck: artikel.gewichtProStueck,
      gewichtProKarton: artikel.gewichtProKarton,
      gewichtProKiste: artikel.gewichtProKiste,
      bildUrl: artikel.bildUrl,
      ausverkauft: artikel.ausverkauft,
      erfassungsModus: artikel.erfassungsModus ?? 'GEWICHT'
    };
  });
}

/**
 * Aktualisiert einen Artikel.
 */
export async function updateArtikel(
  id: string,
  data: Partial<{
    preis: number;
    artikelNummer: string;
    name: string;
    kategorie: string;
    gewichtProStueck: number;
    gewichtProKarton: number;
    gewichtProKiste: number;
    bildUrl?: string;
    ausverkauft?: boolean;
    erfassungsModus?: string;
  }>
): Promise<ArtikelResource> {
  const updated = await ArtikelModel.findByIdAndUpdate(id, data, { new: true });
  if (!updated) {
    throw new Error('Artikel nicht gefunden');
  }
  return {
    id: updated._id.toString(),
    preis: updated.preis,
    artikelNummer: updated.artikelNummer,
    name: updated.name,
    kategorie: updated.kategorie,
    gewichtProStueck: updated.gewichtProStueck,
    gewichtProKarton: updated.gewichtProKarton,
    gewichtProKiste: updated.gewichtProKiste,
    bildUrl: updated.bildUrl,
    ausverkauft: updated.ausverkauft,
    erfassungsModus: updated.erfassungsModus ?? 'GEWICHT'
  };
}

/**
 * Löscht einen Artikel anhand der ID.
 */
export async function deleteArtikel(id: string): Promise<void> {
  const deleted = await ArtikelModel.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('Artikel nicht gefunden');
  }
}