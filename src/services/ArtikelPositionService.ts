import { ArtikelPosition } from '../model/ArtikelPositionModel';
import { ArtikelModel } from '../model/ArtikelModel'; // ✅ Hinzugefügt
import { ArtikelPositionResource } from '../Resources';
import { KundenPreisModel } from '../model/KundenPreisModel';
import { Auftrag } from '../model/AuftragModel';
import { getKundenPreis } from './KundenPreisService'; // Pfad ggf. anpassen

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
  artikel: string;
  menge: number;
  einheit: 'kg' | 'stück' | 'kiste' | 'karton';
  auftragId?: string; // Optional
  zerlegung?: boolean;
  vakuum?: boolean;
  bemerkung?: string;
}): Promise<ArtikelPositionResource> {
  if (!data.artikel || !data.menge || !data.einheit) {
    throw new Error('Fehlende Felder bei der Artikelposition.');
  }

  // Artikel laden
  const artikel = await ArtikelModel.findById(data.artikel);
  if (!artikel) {
    throw new Error('Artikel nicht gefunden.');
  }

  let aufpreis = 0;

  // Nur wenn Auftrag-ID existiert:
  if (data.auftragId) {
    const auftrag = await Auftrag.findById(data.auftragId);
    if (!auftrag) {
      throw new Error('Auftrag nicht gefunden.');
    }

    if (auftrag.kunde) {
      const kundenPreis = await getKundenPreis(auftrag.kunde.toString(), data.artikel);
      aufpreis = kundenPreis.aufpreis;
    }
  }

  const basispreis = artikel.preis || 0;
  const einzelpreis = basispreis + aufpreis;

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

  const gesamtpreis = einzelpreis * gesamtgewicht;

  // Artikelposition erstellen
  const newPosition = new ArtikelPosition({
    artikel: artikel._id,
    artikelName: artikel.name,
    menge: data.menge,
    einheit: data.einheit,
    zerlegung: data.zerlegung ?? false,
    vakuum: data.vakuum ?? false,
    bemerkung: data.bemerkung?.trim() || '',
    einzelpreis,
    gesamtgewicht,
    gesamtpreis,
  });

  const savedPosition = await newPosition.save();

  // Artikelposition-ID zum Auftrag hinzufügen, wenn Auftrag angegeben wurde
  if (data.auftragId) {
    const auftrag = await Auftrag.findById(data.auftragId);
    if (auftrag) {
      if (!auftrag.artikelPosition) {
        auftrag.artikelPosition = [];
      }
      auftrag.artikelPosition.push(savedPosition._id);
      await auftrag.save();
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
    vakuum: savedPosition.vakuum,
    bemerkung: savedPosition.bemerkung,
    gesamtgewicht: savedPosition.gesamtgewicht,
    gesamtpreis: savedPosition.gesamtpreis,
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
    artikelName: position.artikelName,
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
      gesamtgewicht: pos.gesamtgewicht,
      gesamtpreis: pos.gesamtpreis,
    });
  }

  return result;
}

/**
 * Aktualisiert eine Artikelposition.
 */
import mongoose from 'mongoose';

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
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Ungültige Artikelpositions-ID');
  }

  const position = await ArtikelPosition.findById(id);
  if (!position) {
    throw new Error('Artikelposition nicht gefunden');
  }

  // Falls Artikel geändert wird, neuen Artikel laden
  if (data.artikel && data.artikel !== position.artikel.toString()) {
    const neuerArtikel = await ArtikelModel.findById(data.artikel);
    if (!neuerArtikel) {
      throw new Error('Neuer Artikel nicht gefunden');
    }
    position.artikel = neuerArtikel._id;
    position.artikelName = neuerArtikel.name;
  }

  // Andere Felder aktualisieren
  if (data.menge !== undefined) position.menge = data.menge;
  if (data.einheit) position.einheit = data.einheit;
  if (data.zerlegung !== undefined) position.zerlegung = data.zerlegung;
  if (data.vakuum !== undefined) position.vakuum = data.vakuum;
  if (data.bemerkung !== undefined) position.bemerkung = data.bemerkung.trim();

  // Optional: Gewicht neu berechnen, wenn menge oder einheit geändert wurden
  if (data.menge !== undefined || data.einheit) {
    const artikel = await ArtikelModel.findById(position.artikel);
    if (artikel) {
      let gesamtgewicht = 0;
      switch (position.einheit) {
        case 'kg':
          gesamtgewicht = position.menge;
          break;
        case 'stück':
          gesamtgewicht = (artikel.gewichtProStueck || 0) * position.menge;
          break;
        case 'kiste':
          gesamtgewicht = (artikel.gewichtProKiste || 0) * position.menge;
          break;
        case 'karton':
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
    const kundenPreis = await getKundenPreis(auftrag.kunde.toString(), position.artikel.toString());
    aufpreis = kundenPreis.aufpreis;
  }
  const artikel = await ArtikelModel.findById(position.artikel);
  const basispreis = artikel?.preis ?? 0;
  position.einzelpreis = basispreis + aufpreis;

  // Gesamtpreis neu berechnen
  position.gesamtpreis = position.einzelpreis * (position.gesamtgewicht ?? 0);

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