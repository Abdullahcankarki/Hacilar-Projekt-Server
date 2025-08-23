import { KundenPreisModel } from '../model/KundenPreisModel';
import { ArtikelModel } from '../model/ArtikelModel'; // Pfad ggf. anpassen
import { ArtikelResource } from '../Resources';    // Pfad ggf. anpassen
import { getKundenPreis } from './KundenPreisService';
import { Types } from 'mongoose';

// Helper: Robust mapping from a Mongo/Mongoose document (lean or hydrated) to ArtikelResource
function mapToArtikelResource(
  artikel: any,
  aufpreis: number = 0
): ArtikelResource {
  // Support both hydrated documents and lean objects
  const id = artikel._id?.toString ? artikel._id.toString() : String(artikel._id);
  return {
    id,
    preis: (artikel.preis ?? 0) + aufpreis,
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
  return mapToArtikelResource(saved);
}

/**
 * Ruft einen Artikel anhand der ID ab.
 */
export async function getArtikelById(
  id: string,
  customerId?: string
): Promise<ArtikelResource> {
  const artikel = await ArtikelModel.findById(id).lean();
  if (!artikel) {
    throw new Error('Artikel nicht gefunden');
  }

  let kundenPreis: { aufpreis: number } | null = null;
  if (customerId) {
    kundenPreis = await getKundenPreis(customerId, id);
  }
  return mapToArtikelResource(artikel, kundenPreis?.aufpreis ?? 0);
}

/**
 * Ruft alle Artikel ab.
 */
export async function getAllArtikel(
  customerId?: string,
  options?: {
    page?: number;
    limit?: number;
    kategorie?: string | string[];
    ausverkauft?: boolean;
    name?: string; // substring filter (case-insensitive)
    erfassungsModus?: string | string[];
  }
): Promise<{ items: ArtikelResource[]; page: number; limit: number; total: number; pages: number; }> {
  const page = Math.max(1, options?.page ?? 1);

  // Build filter
  const query: any = {};
  if (options?.kategorie) {
    query.kategorie = Array.isArray(options.kategorie)
      ? { $in: options.kategorie }
      : options.kategorie;
  }
  if (typeof options?.ausverkauft === 'boolean') {
    query.ausverkauft = options.ausverkauft;
  }
  if (options?.erfassungsModus) {
    query.erfassungsModus = Array.isArray(options.erfassungsModus)
      ? { $in: options.erfassungsModus }
      : options.erfassungsModus;
  }
  if (options?.name && options.name.trim().length > 0) {
    query.name = { $regex: options.name.trim(), $options: 'i' };
  }

  const totalDocsAll = await ArtikelModel.estimatedDocumentCount();
  const limit = options?.limit !== undefined
    ? Math.max(1, Math.min(200, options.limit))
    : totalDocsAll;
  const total = await ArtikelModel.countDocuments(query);
  const pages = Math.max(1, Math.ceil(total / limit));
  const skip = (page - 1) * limit;

  const artikelList = await ArtikelModel.find(query)
    .collation({ locale: 'de', strength: 2 })
    .skip(skip)
    .limit(limit)
    .lean();

  let items: ArtikelResource[];

  if (!customerId) {
    items = artikelList.map(a => mapToArtikelResource(a));
  } else {
    const kundenPreise = await KundenPreisModel.find({
      customer: new Types.ObjectId(customerId),
      artikel: { $in: artikelList.map(a => a._id) },
    }).lean();

    const preisMap = new Map<string, number>(
      kundenPreise.map(p => [p.artikel.toHexString(), p.aufpreis])
    );

    items = artikelList.map(a => {
      const aufpreis = preisMap.get(a._id.toString()) || 0;
      return mapToArtikelResource(a, aufpreis);
    });
  }

  return { items, page, limit, total, pages };
}

/**
 * Ruft einen Artikel ohne Aufpreis berechnung anhand der ID ab.
 */

export async function getArtikelByIdClean(
  id: string,
  _customerId?: string
): Promise<ArtikelResource> {
  const artikel = await ArtikelModel.findById(id).lean();
  if (!artikel) {
    throw new Error('Artikel nicht gefunden');
  }

  return mapToArtikelResource(artikel);
}

/**
 * Ruft alle Artikel ab.
 */
export async function getAllArtikelClean(
  options?: {
    page?: number;
    limit?: number;
    kategorie?: string | string[];
    ausverkauft?: boolean;
    name?: string; // substring filter (case-insensitive)
    erfassungsModus?: string | string[];
  }
): Promise<{ items: ArtikelResource[]; page: number; limit: number; total: number; pages: number; }> {
  const page = Math.max(1, options?.page ?? 1);
  
  const totalDocsAll = await ArtikelModel.estimatedDocumentCount();
  const limit = options?.limit !== undefined
    ? Math.max(1, Math.min(200, options.limit))
    : totalDocsAll;

  const query: any = {};
  if (options?.kategorie) {
    query.kategorie = Array.isArray(options.kategorie)
      ? { $in: options.kategorie }
      : options.kategorie;
  }
  if (typeof options?.ausverkauft === 'boolean') {
    query.ausverkauft = options.ausverkauft;
  }
  if (options?.erfassungsModus) {
    query.erfassungsModus = Array.isArray(options.erfassungsModus)
      ? { $in: options.erfassungsModus }
      : options.erfassungsModus;
  }
  if (options?.name && options.name.trim().length > 0) {
    query.name = { $regex: options.name.trim(), $options: 'i' };
  }

  const total = await ArtikelModel.countDocuments(query);
  const pages = Math.max(1, Math.ceil(total / limit));
  const skip = (page - 1) * limit;

  const artikelList = await ArtikelModel.find(query)
    .collation({ locale: 'de', strength: 2 })
    .skip(skip)
    .limit(limit)
    .lean();

  const items = artikelList.map(a => mapToArtikelResource(a));
  return { items, page, limit, total, pages };
}

/**
 * Ruft Artikel anhand einer Liste von Namen ab.
 */
export async function getArtikelByNames(
  names: string[],
  customerId?: string
): Promise<ArtikelResource[]> {
  // 1. Artikel anhand der Namen finden
  const artikelList = await ArtikelModel.find({ name: { $in: names } })
    .collation({ locale: 'de', strength: 2 })
    .lean();

  // 2. Wenn kein Kunde angegeben ist, einfach Artikel ohne Aufpreis zurückgeben
  if (!customerId) {
    return artikelList.map(a => mapToArtikelResource(a));
  }

  // 3. Alle Kundenpreise für diese Artikel laden
  const kundenPreise = await KundenPreisModel.find({
    customer: new Types.ObjectId(customerId),
    artikel: { $in: artikelList.map(a => a._id) },
  }).lean();

  // 4. Map zur schnellen Zuordnung
  const preisMap = new Map<string, number>(
    kundenPreise.map(p => [p.artikel.toHexString(), p.aufpreis])
  );

  // 5. Ergebnis zusammenbauen
  return artikelList.map(a => {
    const aufpreis = preisMap.get(a._id.toString()) || 0;
    return mapToArtikelResource(a, aufpreis);
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
  const updated = await ArtikelModel.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!updated) {
    throw new Error('Artikel nicht gefunden');
  }
  return mapToArtikelResource(updated);
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