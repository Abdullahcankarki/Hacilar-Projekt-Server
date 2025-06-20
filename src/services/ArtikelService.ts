import { ArtikelModel } from '../model/ArtikelModel'; // Pfad ggf. anpassen
import { ArtikelResource } from '../Resources';    // Pfad ggf. anpassen
import { getKundenPreis } from './KundenPreisService';

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
  ausverkauft?: boolean
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
  };
}

/**
 * Ruft alle Artikel ab.
 */
export async function getAllArtikel(customerId?: string): Promise<ArtikelResource[]> {
  const artikelList = await ArtikelModel.find();

  const result: ArtikelResource[] = [];

  for (const artikel of artikelList) {
    let preis = artikel.preis;

    if (customerId) {
      const kundenPreis = await getKundenPreis(customerId, artikel._id.toString());
      preis += kundenPreis.aufpreis; // aufpreis ist garantiert immer eine Zahl
    }

    result.push({
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
    });
  }

  return result;
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
    });
  }

  return result;
}

/**
 * Ruft Artikel anhand einer Liste von Namen ab.
 */
export async function getArtikelByNames(names: string[], customerId?: string): Promise<ArtikelResource[]> {
  const artikelList = await ArtikelModel.find({ name: { $in: names } });

  const result: ArtikelResource[] = [];

  for (const artikel of artikelList) {
    let preis = artikel.preis;

    if (customerId) {
      const kundenPreis = await getKundenPreis(customerId, artikel._id.toString());
      preis += kundenPreis.aufpreis;
    }

    result.push({
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
    });
  }

  return result;
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
    ausverkauft: updated.ausverkauft
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