import { Kunde } from '../model/KundeModel';
import { KundenPreisModel } from '../model/KundenPreisModel'; // Pfad ggf. anpassen
import { KundenPreisResource } from '../Resources';        // Pfad ggf. anpassen

/**
 * Erstellt einen neuen kundenspezifischen Preis.
 */
export async function createKundenPreis(data: {
  artikel: string;
  customer: string;
  aufpreis: number;
}): Promise<KundenPreisResource> {
  const newEntry = new KundenPreisModel({
    artikel: data.artikel,
    customer: data.customer,
    aufpreis: data.aufpreis,
  });
  const saved = await newEntry.save();
  return {
    id: saved._id.toString(),
    artikel: saved.artikel.toString(),
    customer: saved.customer.toString(),
    aufpreis: saved.aufpreis,
  };
}

/**
 * Ruft einen kundenspezifischen Preis anhand der ID ab.
 */
export async function getKundenPreisById(id: string): Promise<KundenPreisResource> {
  const entry = await KundenPreisModel.findById(id);
  if (!entry) {
    throw new Error('KundenPreis nicht gefunden');
  }
  return {
    id: entry._id.toString(),
    artikel: entry.artikel.toString(),
    customer: entry.customer.toString(),
    aufpreis: entry.aufpreis,
  };
}

/**
 * Ruft alle kundenspezifischen Preise für eine bestimmte Artikel-ID ab.
 */
export async function getKundenPreisByArtikelId(artikelId: string): Promise<KundenPreisResource[]> {
  const entries = await KundenPreisModel.find({ artikel: artikelId });
  return entries.map(entry => ({
    id: entry._id.toString(),
    artikel: entry.artikel.toString(),
    customer: entry.customer.toString(),
    aufpreis: entry.aufpreis,
  }));
}


export async function getKundenPreis(
  kundenId: string,
  artikelId: string
): Promise<KundenPreisResource> {
  const entry = await KundenPreisModel.findOne({
    customer: kundenId,
    artikel: artikelId,
  }).exec();

  return {
    id: entry?._id?.toString() ?? 'default',
    artikel: artikelId,
    customer: kundenId,
    aufpreis: entry?.aufpreis ?? 0,
  };
}

/**
 * Ruft alle kundenspezifischen Preise ab.
 */
export async function getAllKundenPreise(): Promise<KundenPreisResource[]> {
  const entries = await KundenPreisModel.find();
  return entries.map(entry => ({
    id: entry._id.toString(),
    artikel: entry.artikel.toString(),
    customer: entry.customer.toString(),
    aufpreis: entry.aufpreis,
  }));
}

/**
 * Aktualisiert einen kundenspezifischen Preis.
 */
export async function updateKundenPreis(
  id: string,
  data: Partial<{ artikel: string; customer: string; aufpreis: number; }>
): Promise<KundenPreisResource> {
  const updated = await KundenPreisModel.findByIdAndUpdate(id, data, { new: true });
  if (!updated) {
    throw new Error('KundenPreis nicht gefunden');
  }
  return {
    id: updated._id.toString(),
    artikel: updated.artikel.toString(),
    customer: updated.customer.toString(),
    aufpreis: updated.aufpreis,
  };
}

/**
 * Löscht einen kundenspezifischen Preis.
 */
export async function deleteKundenPreis(id: string): Promise<void> {
  const deleted = await KundenPreisModel.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('KundenPreis nicht gefunden');
  }
}

/**
 * Setzt einen Aufpreis für einen Artikel bei allen Kunden mit bestimmter Kategorie und/oder Region.
 * Wenn Kategorie oder Region nicht angegeben sind, wird entsprechend breiter gefiltert.
 */
export async function setAufpreisForArtikelByFilter(
  artikel: string,
  aufpreis: number,
  filter: { kategorie?: string; region?: string }
): Promise<KundenPreisResource[]> {
  const query: any = {};
  if (filter.kategorie) query.kategorie = filter.kategorie;
  if (filter.region) query.region = filter.region;

  const kunden = await Kunde.find(query).select('_id');
  const result: KundenPreisResource[] = [];

  for (const kunde of kunden) {
    const existing = await KundenPreisModel.findOne({
      customer: kunde._id,
      artikel: artikel,
    });

    if (existing) {
      existing.aufpreis = Number(existing.aufpreis) + Number(aufpreis);
      await existing.save();
      result.push({
        id: existing._id.toString(),
        artikel: artikel,
        customer: kunde._id.toString(),
        aufpreis: existing.aufpreis,
      });
    } else {
      const neu = new KundenPreisModel({
        artikel: artikel,
        customer: kunde._id,
        aufpreis,
      });
      const saved = await neu.save();
      result.push({
        id: saved._id.toString(),
        artikel: artikel,
        customer: kunde._id.toString(),
        aufpreis: saved.aufpreis,
      });
    }
  }

  return result;
}