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