import { Auftrag, IAuftrag } from '../model/AuftragModel'; // Pfad ggf. anpassen
import { ArtikelPosition, IArtikelPosition } from '../model/ArtikelPositionModel'; // Pfad ggf. anpassen
import { ArtikelPositionResource, AuftragResource } from '../Resources'; // Pfad ggf. anpassen

/**
 * Berechnet für einen Auftrag das Gesamtgewicht und den Gesamtpreis,
 * indem alle zugehörigen ArtikelPositionen geladen und summiert werden.
 */
async function computeTotals(auftrag: IAuftrag): Promise<{ totalWeight: number; totalPrice: number }> {
  // Lade alle ArtikelPositionen, die in diesem Auftrag referenziert werden
  const positions: IArtikelPosition[] = await ArtikelPosition.find({
    _id: { $in: auftrag.artikelPosition },
  });

  const totalWeight = positions.reduce((sum, pos) => sum + pos.gesamtgewicht, 0);
  const totalPrice = positions.reduce((sum, pos) => sum + pos.gesamtpreis, 0);

  return { totalWeight, totalPrice };
}

/**
 * Wandelt ein IAuftrag-Dokument in einen AuftragResource um und fügt
 * die berechneten Gesamtwerte hinzu.
 */
function convertAuftragToResource(
  auftrag: IAuftrag,
  totals: { totalWeight: number; totalPrice: number }
): AuftragResource {
  return {
    id: auftrag._id.toString(),
    kunde: auftrag.kunde.toString(),
    kundeName: (auftrag as any).kunde?.name || '',  // Hier wird der Name des Kunden aus populate('kunde', 'name') genommen
    artikelPosition: auftrag.artikelPosition.map(id => id.toString()),
    status: auftrag.status,
    lieferdatum: auftrag.lieferdatum ? auftrag.lieferdatum.toISOString() : undefined,
    bemerkungen: auftrag.bemerkungen,
    createdAt: auftrag.createdAt ? auftrag.createdAt.toISOString() : undefined,
    updatedAt: auftrag.updatedAt ? auftrag.updatedAt.toISOString() : undefined,
    gewicht: totals.totalWeight,
    preis: totals.totalPrice,
  };
}

/**
 * Erstellt einen neuen Auftrag.
 * Dabei werden die im Input gelieferten Werte übernommen.
 * Anschließend werden die Gesamtwerte berechnet und in der Resource zurückgegeben.
 */
export async function createAuftrag(data: {
  kunde: string;
  artikelPosition: string[];
  status?: 'offen' | 'in Bearbeitung' | 'abgeschlossen' | 'storniert';
  lieferdatum?: string;
  bemerkungen?: string;
}): Promise<AuftragResource> {
  const newAuftrag = new Auftrag({
    kunde: data.kunde,
    artikelPosition: data.artikelPosition,
    status: data.status ?? 'offen',
    lieferdatum: data.lieferdatum ? new Date(data.lieferdatum) : undefined,
    bemerkungen: data.bemerkungen,
  });

  const savedAuftrag = await newAuftrag.save();
  const totals = await computeTotals(savedAuftrag);
  return convertAuftragToResource(savedAuftrag, totals);
}

/**
 * Ruft einen einzelnen Auftrag anhand der ID ab.
 * Dabei werden die Gesamtwerte berechnet und als Teil der Resource zurückgegeben.
 */
export async function getAuftragById(id: string): Promise<AuftragResource> {
  const auftrag = await Auftrag.findById(id).populate('kunde', 'name');
  if (!auftrag) {
    throw new Error('Auftrag nicht gefunden');
  }
  const totals = await computeTotals(auftrag);
  return convertAuftragToResource(auftrag, totals);
}

/**
 * Ruft alle Aufträge eines bestimmten Kunden anhand der Kunden-ID ab.
 * Für jeden Auftrag werden Gesamtgewicht und Gesamtpreis berechnet.
 */
export async function getAuftraegeByCustomerId(kundenId: string): Promise<AuftragResource[]> {
  const auftraege = await Auftrag.find({ kunde: kundenId }).populate('kunde', 'name');

  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag);
      return convertAuftragToResource(auftrag, totals);
    })
  );
}
/**
 * Ruft alle Aufträge ab.
 * Für jeden Auftrag werden Gesamtgewicht und Gesamtpreis berechnet.
 */
export async function getAllAuftraege(): Promise<AuftragResource[]> {
  const auftraege = await Auftrag.find().populate('kunde', 'name');
  return Promise.all(
    auftraege.map(async (auftrag) => {
      const totals = await computeTotals(auftrag);
      return convertAuftragToResource(auftrag, totals);
    })
  );
}

/**
 * Aktualisiert einen Auftrag.
 * Mögliche Felder zum Updaten sind: kunde, artikelPosition, status, lieferdatum und bemerkungen.
 * Nach dem Update werden die Gesamtwerte neu berechnet.
 */
export async function updateAuftrag(
  id: string,
  data: Partial<{
    kunde: string;
    artikelPosition: string[];
    status: 'offen' | 'in Bearbeitung' | 'abgeschlossen' | 'storniert';
    lieferdatum: string;
    bemerkungen: string;
  }>
): Promise<AuftragResource> {
  const updateData: any = {};
  if (data.kunde) updateData.kunde = data.kunde;
  if (data.artikelPosition) updateData.artikelPosition = data.artikelPosition;
  if (data.status) updateData.status = data.status;
  if (data.lieferdatum) updateData.lieferdatum = new Date(data.lieferdatum);
  if (data.bemerkungen !== undefined) updateData.bemerkungen = data.bemerkungen;

  const updatedAuftrag = await Auftrag.findByIdAndUpdate(id, updateData, { new: true }).populate('kunde', 'name');
  if (!updatedAuftrag) {
    throw new Error('Auftrag nicht gefunden');
  }
  const totals = await computeTotals(updatedAuftrag);
  return convertAuftragToResource(updatedAuftrag, totals);
}

export async function getLetzterAuftragMitPositionenByKundenId(kundenId: string): Promise<{
  auftrag: AuftragResource;
  artikelPositionen: ArtikelPositionResource[];
} | null> {
  const auftragDocs = await Auftrag.find({ kunde: kundenId })
    .populate('kunde', 'name')
    .sort({ createdAt: -1 })
    .limit(1);

  if (!auftragDocs || auftragDocs.length === 0) return null;

  const auftrag = auftragDocs[0];
  const totals = await computeTotals(auftrag);
  const auftragResource = convertAuftragToResource(auftrag, totals);

  const positionen = await ArtikelPosition.find({
    _id: { $in: auftrag.artikelPosition }
  });

  const positionResources: ArtikelPositionResource[] = positionen.map(pos => ({
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
  }));

  return {
    auftrag: auftragResource,
    artikelPositionen: positionResources,
  };
}

/**
 * Gibt den zuletzt erstellten Auftrag eines bestimmten Kunden zurück.
 */
export async function getLetzterArtikelFromAuftragByKundenId(kundenId: string): Promise<string[]> {
  const auftrag = await Auftrag.find({ kunde: kundenId })
    .sort({ createdAt: -1 }) // neuester Auftrag zuerst
    .limit(1);

  if (!auftrag || auftrag.length === 0) {
    return [];
  }

  // ArtikelPositionen laden
  const artikelPositionen = await ArtikelPosition.find({
    _id: { $in: auftrag[0].artikelPosition }
  });

  // Nur Artikel-IDs extrahieren (distinct)
  const artikelIds = artikelPositionen
    .map((pos) => pos.artikel?.toString())
    .filter((id): id is string => !!id); // entfernt undefined/null

  return artikelIds;
}

/**
 * Löscht einen Auftrag anhand der ID.
 */
export async function deleteAuftrag(id: string): Promise<void> {
  const deleted = await Auftrag.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('Auftrag nicht gefunden');
  }
}