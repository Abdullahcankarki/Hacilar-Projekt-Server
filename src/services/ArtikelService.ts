import { ArtikelModel } from '../model/ArtikelModel'; // Pfad ggf. anpassen
import { ArtikelResource } from '../Resources';    // Pfad ggf. anpassen

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
}): Promise<ArtikelResource> {
  const newArtikel = new ArtikelModel({
    preis: data.preis,
    artikelNummer: data.artikelNummer,
    name: data.name,
    kategorie: data.kategorie,
    gewichtProStueck: data.gewichtProStueck,
    gewichtProKarton: data.gewichtProKarton,
    gewichtProKiste: data.gewichtProKiste,
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
  };
}

/**
 * Ruft einen Artikel anhand der ID ab.
 */
export async function getArtikelById(id: string): Promise<ArtikelResource> {
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
  };
}

/**
 * Ruft alle Artikel ab.
 */
export async function getAllArtikel(): Promise<ArtikelResource[]> {
  const artikelList = await ArtikelModel.find();
  return artikelList.map(artikel => ({
    id: artikel._id.toString(),
    preis: artikel.preis,
    artikelNummer: artikel.artikelNummer,
    name: artikel.name,
    kategorie: artikel.kategorie,
    gewichtProStueck: artikel.gewichtProStueck,
    gewichtProKarton: artikel.gewichtProKarton,
    gewichtProKiste: artikel.gewichtProKiste,
  }));
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