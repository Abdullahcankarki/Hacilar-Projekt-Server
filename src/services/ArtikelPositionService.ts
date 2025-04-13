import { ArtikelPosition } from '../model/ArtikelPositionModel';
import { ArtikelModel } from '../model/ArtikelModel'; // ✅ Hinzugefügt
import { ArtikelPositionResource } from '../Resources';
import { KundenPreisModel } from '../model/KundenPreisModel';
import { Auftrag } from '../model/AuftragModel';

// ... Importe bleiben gleich

const EMPTY_ARTIKEL = {
  name: 'Unbekannter Artikel',
  preis: 1,
  gewichtProStueck: 1,
  gewichtProKiste: 1,
  gewichtProKarton: 1,
};

/**
 * Erstellt eine neue Artikelposition.
 */

export async function createArtikelPosition(data: {
  artikel?: string;
  menge: number;
  einheit: 'kg' | 'stück' | 'kiste' | 'karton';
  einzelpreis?: number;
  zerlegung?: boolean;
  vakuum?: boolean;
  bemerkung?: string;
}): Promise<ArtikelPositionResource> {
  // Validierung Menge & Einheit
  if (!data.einheit || !['kg', 'stück', 'kiste', 'karton'].includes(data.einheit)) {
    throw new Error('Einheit ist ungültig');
  }
  let menge = 0;
  if (typeof data.menge === 'number' && !isNaN(data.menge) && data.menge > 0) {
    menge = data.menge;
  } else {
    console.warn('Ungültige oder fehlende Menge, setze auf 0');
  }

  // Artikel laden (optional)
  const artikelFromDb = data.artikel
    ? await ArtikelModel.findById(data.artikel).catch((err) => {
        console.error('Fehler beim Laden des Artikels:', err);
        return null;
      })
    : null;

  const artikel = artikelFromDb || EMPTY_ARTIKEL;

  // Gewicht berechnen
  let gesamtgewicht = 0;
  switch (data.einheit) {
    case 'kg':
      gesamtgewicht = data.menge;
      break;
    case 'stück':
      gesamtgewicht = (artikel.gewichtProStueck || 0) * data.menge;
      break;
    case 'kiste':
      gesamtgewicht = (artikel.gewichtProKiste || 0) * data.menge;
      break;
    case 'karton':
      gesamtgewicht = (artikel.gewichtProKarton || 0) * data.menge;
      break;
  }

  const newPosition = new ArtikelPosition({
    artikel: data.artikel || undefined,
    artikelName: artikel.name ?? 'Unbekannt',
    menge: data.menge,
    einheit: data.einheit,
    zerlegung: data.zerlegung ?? false,
    vakuum: data.vakuum ?? false,
    bemerkung: data.bemerkung?.trim() || '',
    einzelpreis: 0, // wird überschrieben
    gesamtgewicht,
    gesamtpreis: 0, // wird gleich gesetzt
  });

  const saved = await newPosition.save();

  // Kunden-ID über Auftrag finden
  const auftrag = await Auftrag.findOne({ artikelPosition: saved._id });
  if (!auftrag) {
    console.warn('Kein Auftrag gefunden, der diese Artikelposition enthält.');
  }

  const kundeId = auftrag?.kunde?.toString();
  let einzelpreis = 0;

  if (data.artikel && kundeId) {
    const kundenPreis = await KundenPreisModel.findOne({
      artikel: data.artikel,
      customer: kundeId,
    }).catch((err) => {
      console.warn('Kundenpreis konnte nicht geladen werden:', err);
      return null;
    });

    const artikelBasisPreis = typeof artikel.preis === 'number' ? artikel.preis : 0;
    const aufpreis = kundenPreis?.aufpreis ?? 0;
    einzelpreis = artikelBasisPreis + aufpreis;
  }

  const gesamtpreis = einzelpreis * data.menge;

  // Artikelposition aktualisieren mit Preisen
  saved.einzelpreis = einzelpreis;
  saved.gesamtpreis = gesamtpreis;
  await saved.save();

  return {
    id: saved._id.toString(),
    artikel: saved.artikel?.toString() || '',
    artikelName: saved.artikelName,
    menge: saved.menge,
    einheit: saved.einheit,
    einzelpreis: saved.einzelpreis,
    zerlegung: saved.zerlegung,
    vakuum: saved.vakuum,
    bemerkung: saved.bemerkung,
    gesamtgewicht: saved.gesamtgewicht,
    gesamtpreis: saved.gesamtpreis,
  };
}

/**
 * Ruft eine Artikelposition anhand der ID ab.
 */
export async function getArtikelPositionById(id: string): Promise<ArtikelPositionResource> {
  const position = await ArtikelPosition.findById(id);
  if (!position) {
    throw new Error('Artikelposition nicht gefunden');
  }
  return {
    id: position._id.toString(),
    artikel: position.artikel.toString(),
    artikelName: position.artikelName, // ✅ NEU
    menge: position.menge,
    einheit: position.einheit,
    einzelpreis: position.einzelpreis,
    zerlegung: position.zerlegung,
    vakuum: position.vakuum,
    bemerkung: position.bemerkung,
    gesamtgewicht: position.gesamtgewicht,
    gesamtpreis: position.gesamtpreis,
  };
}

/**
 * Ruft alle Artikelpositionen ab.
 */
export async function getAllArtikelPositionen(): Promise<ArtikelPositionResource[]> {
  const positions = await ArtikelPosition.find();
  return positions.map(pos => ({
    id: pos._id.toString(),
    artikel: pos.artikel.toString(),
    artikelName: pos.artikelName, // ✅ NEU
    menge: pos.menge,
    einheit: pos.einheit,
    einzelpreis: pos.einzelpreis,
    zerlegung: pos.zerlegung,
    vakuum: pos.vakuum,
    bemerkung: pos.bemerkung,
    gesamtgewicht: pos.gesamtgewicht,
    gesamtpreis: pos.gesamtpreis,
  }));
}

/**
 * Aktualisiert eine Artikelposition.
 */
export async function updateArtikelPosition(
  id: string,
  data: Partial<{
    artikel: string;
    menge: number;
    einheit: 'kg' | 'stück' | 'kiste' | 'karton';
    zerlegung: boolean;
    vakuum: boolean;
    bemerkung: string;
  }>
): Promise<ArtikelPositionResource> {
  const updated = await ArtikelPosition.findByIdAndUpdate(id, data, { new: true });
  if (!updated) {
    throw new Error('Artikelposition nicht gefunden');
  }
  return {
    id: updated._id.toString(),
    artikel: updated.artikel.toString(),
    artikelName: updated.artikelName, // ✅ NEU
    menge: updated.menge,
    einheit: updated.einheit,
    einzelpreis: updated.einzelpreis,
    zerlegung: updated.zerlegung,
    vakuum: updated.vakuum,
    bemerkung: updated.bemerkung,
    gesamtgewicht: updated.gesamtgewicht,
    gesamtpreis: updated.gesamtpreis,
  };
}
//delete 
export async function deleteArtikelPosition(id: string): Promise<void> {
  const deleted = await ArtikelPosition.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('Artikelposition nicht gefunden');
  }
}