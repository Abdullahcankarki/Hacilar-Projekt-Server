import { Kunde } from '../model/KundeModel';
import { KundenPreisModel } from '../model/KundenPreisModel'; // Pfad ggf. anpassen
import { KundenPreisResource } from '../Resources';        // Pfad ggf. anpassen
import { ArtikelModel } from '../model/ArtikelModel';
import mongoose from 'mongoose';

/**
 * Erstellt einen neuen kundenspezifischen Preis.
 */
export async function createKundenPreis(data: {
  artikel: string;
  customer: string;
  aufpreis: number;
}, currentUser: { role: string[] }): Promise<KundenPreisResource> {
  if (!currentUser.role?.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }
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
 * Setzt/erstellt den Aufpreis für einen Kunden+Artikel basierend auf einem gewünschten Gesamtpreis.
 * Berechnung: aufpreis = gesamtpreis - artikel.preis
 * Wenn noch kein Eintrag existiert, wird er erstellt; andernfalls aktualisiert.
 */
export async function setAufpreisByGesamtpreis(
  data: { artikel: string; customer: string; gesamtpreis: number },
  currentUser: { role: string[] }
): Promise<KundenPreisResource> {
  if (!currentUser.role?.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }

  // Basispreis des Artikels holen
  const artikelDoc = await ArtikelModel.findById(data.artikel).select('preis');
  if (!artikelDoc) {
    throw new Error('Artikel nicht gefunden');
  }

  const basispreis = Number((artikelDoc as any).preis ?? 0);
  const gesamtpreis = Number(data.gesamtpreis ?? 0);
  const aufpreis = gesamtpreis - basispreis;

  // Upsert des Kundenpreis-Eintrags
  const updated = await KundenPreisModel.findOneAndUpdate(
    { customer: data.customer, artikel: data.artikel },
    {
      $set: { aufpreis },
      $setOnInsert: { customer: data.customer, artikel: data.artikel },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).exec();

  return {
    id: updated!._id.toString(),
    artikel: updated!.artikel.toString(),
    customer: updated!.customer.toString(),
    aufpreis: updated!.aufpreis,
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
  return KundenPreisModel.find({ artikel: artikelId })
    .lean()
    .then(entries =>
      entries.map(entry => ({
        id: entry._id.toString(),
        artikel: entry.artikel.toString(),
        customer: entry.customer.toString(),
        aufpreis: entry.aufpreis,
      }))
    );
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
  data: Partial<{ artikel: string; customer: string; aufpreis: number; }>,
  currentUser: { role: string[] }
): Promise<KundenPreisResource> {
  if (!currentUser.role?.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }
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
export async function deleteKundenPreis(id: string, currentUser: { role: string[] }): Promise<void> {
  if (!currentUser.role?.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }
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
  filter: { kategorie?: string; region?: string },
  currentUser: { role: string[] }
): Promise<KundenPreisResource[]> {
  if (!currentUser.role?.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }
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

/**
 * Kunden-zentrierte Liste: gibt für einen Kunden eine übersichtliche Liste der Artikel
 * inkl. Basispreis (aus Artikel), Aufpreis (kundenspezifisch, default 0) und Effektivpreis zurück.
 *
 * Zwei Modi:
 *  - includeAllArticles = true  → zeigt **alle** Artikel; wenn kein Kundenpreis existiert, Aufpreis = 0.
 *  - includeAllArticles = false → zeigt **nur** Einträge, bei denen es einen Kundenpreis gibt.
 */
export async function listKundenpreiseForCustomer(options: {
  customerId: string;
  q?: string; // Volltextsuche über Artikelnummer/Artikelname
  sort?: 'artikelNummer' | 'artikelName' | 'basispreis' | 'aufpreis' | 'effektivpreis';
  order?: 'asc' | 'desc';
  page?: number; // 1-basiert
  limit?: number;
  includeAllArticles?: boolean; // siehe Beschreibung oben
}): Promise<Array<{
  id: string; // id des KundenPreis-Eintrags oder 'default' wenn keiner existiert
  artikel: string; // Artikel-ID
  artikelNummer?: string;
  artikelName?: string;
  einheit?: string;
  basispreis: number; // aus Artikel
  aufpreis: number; // kundenspezifisch oder 0
  effektivpreis: number; // basispreis + aufpreis
}>> {
  const {
    customerId,
    q,
    sort = 'artikelName',
    order = 'asc',
    page = 1,
    limit = 50,
    includeAllArticles = true,
  } = options;

  const sortDir = order === 'desc' ? -1 : 1;
  const skip = Math.max(0, (page - 1) * limit);

  // Textsuche über aliasierte Felder (wird NACH $addFields/$project verwendet)
  const artikelTextMatch: any = q
    ? {
        $or: [
          { artikelNummer: { $regex: q, $options: 'i' } },
          { artikelName: { $regex: q, $options: 'i' } },
        ],
      }
    : {};

  // Hilfsfunktionen
  const buildSortStage = () => {
    switch (sort) {
      case 'artikelNummer':
        return { artikelNummer: sortDir } as Record<string, 1 | -1>;
      case 'basispreis':
        return { basispreis: sortDir };
      case 'aufpreis':
        return { aufpreis: sortDir };
      case 'effektivpreis':
        return { effektivpreis: sortDir };
      case 'artikelName':
      default:
        return { artikelName: sortDir };
    }
  };

  if (includeAllArticles) {
    // Optimierte Pipeline: $match vor $project, Pagination VOR $lookup, Lookup NACH Pagination
    const pipeline: any[] = [
      // 1) Vorfilter auf Root-Feldern (nutzt Indexe auf name/nummer)
      ...(q
        ? [
            {
              $match: {
                $or: [
                  { nummer: { $regex: q, $options: 'i' } },
                  { name: { $regex: q, $options: 'i' } },
                ],
              },
            },
          ]
        : []),
      // 2) Normierung der Felder
      {
        $project: {
          _id: 1,
          artikelNummer: { $ifNull: ['$nummer', '$artikelNummer'] },
          artikelName: { $ifNull: ['$name', '$artikelName'] },
          einheit: 1,
          basispreis: { $ifNull: ['$preis', 0] },
        },
      },
      // 3) Sortierung + Pagination VOR Lookup
      { $sort: buildSortStage() },
      { $skip: skip },
      { $limit: limit },
      // 4) Lookup nur für die paginierten Zeilen
      {
        $lookup: {
          from: KundenPreisModel.collection.name,
          let: { aId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$artikel', '$$aId'] },
                    { $eq: ['$customer', new mongoose.Types.ObjectId(customerId)] },
                  ],
                },
              },
            },
          ],
          as: 'kp',
        },
      },
      { $unwind: { path: '$kp', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          aufpreis: { $ifNull: ['$kp.aufpreis', 0] },
          kundenPreisId: { $ifNull: [{ $toString: '$kp._id' }, 'default'] },
          effektivpreis: { $add: ['$basispreis', { $ifNull: ['$aufpreis', 0] }] },
        },
      },
      {
        $project: {
          _id: 0,
          id: '$kundenPreisId',
          artikel: { $toString: '$_id' },
          artikelNummer: 1,
          artikelName: 1,
          einheit: 1,
          basispreis: { $ifNull: ['$basispreis', 0] },
          aufpreis: { $ifNull: ['$aufpreis', 0] },
          effektivpreis: { $ifNull: ['$effektivpreis', 0] },
        },
      },
    ];

    const rows = await ArtikelModel.aggregate(pipeline).collation({ locale: 'de', strength: 2, numericOrdering: true }).exec();
    return rows as any;
  }

  // Startet bei KundenPreis → inner-join Artikel
  const pipeline: any[] = [
    { $match: { customer: new mongoose.Types.ObjectId(customerId) } },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: 'artikel',
        foreignField: '_id',
        as: 'artikelDoc',
      },
    },
    { $unwind: '$artikelDoc' },
    {
      $addFields: {
        artikelNummer: { $ifNull: ['$artikelDoc.nummer', '$artikelDoc.artikelNummer'] },
        artikelName: { $ifNull: ['$artikelDoc.name', '$artikelDoc.artikelName'] },
        einheit: '$artikelDoc.einheit',
        basispreis: { $ifNull: ['$artikelDoc.preis', 0] },
      },
    },
    { $match: artikelTextMatch },
    {
      $addFields: {
        effektivpreis: { $add: [{ $ifNull: ['$basispreis', 0] }, { $ifNull: ['$aufpreis', 0] }] },
      },
    },
    { $sort: buildSortStage() },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        artikel: { $toString: '$artikel' },
        artikelNummer: 1,
        artikelName: 1,
        einheit: 1,
        basispreis: { $ifNull: ['$basispreis', 0] },
        aufpreis: { $ifNull: ['$aufpreis', 0] },
        effektivpreis: { $ifNull: ['$effektivpreis', 0] },
      },
    },
  ];

  const rows = await KundenPreisModel.aggregate(pipeline).collation({ locale: 'de', strength: 2, numericOrdering: true }).exec();
  return rows as any;
}

/**
 * Artikel-zentrierte Liste: gibt für einen Artikel eine übersichtliche Liste der Kunden
 * inkl. Basispreis (aus Artikel), Aufpreis (kundenspezifisch, default 0) und Effektivpreis zurück.
 *
 * Zwei Modi:
 *  - includeAllCustomers = true  → zeigt **alle** Kunden; wenn kein Kundenpreis existiert, Aufpreis = 0.
 *  - includeAllCustomers = false → zeigt **nur** Einträge, bei denen es einen Kundenpreis gibt.
 */
export async function listKundenpreiseForArtikel(options: {
  artikelId: string;
  q?: string; // Volltextsuche über Kundenname/Kundennummer
  sort?: 'kundeName' | 'kundennummer' | 'kategorie' | 'region' | 'basispreis' | 'aufpreis' | 'effektivpreis';
  order?: 'asc' | 'desc';
  page?: number; // 1-basiert
  limit?: number;
  includeAllCustomers?: boolean; // siehe Beschreibung oben
}): Promise<Array<{
  id: string; // id des KundenPreis-Eintrags oder 'default' wenn keiner existiert
  customer: string; // Kunden-ID
  kundeName?: string;
  kundennummer?: string;
  kategorie?: string;
  region?: string;
  basispreis: number; // aus Artikel
  aufpreis: number; // kundenspezifisch oder 0
  effektivpreis: number; // basispreis + aufpreis
}>> {
  const {
    artikelId,
    q,
    sort = 'kundeName',
    order = 'asc',
    page = 1,
    limit = 50,
    includeAllCustomers = true,
  } = options;

  const sortDir = order === 'desc' ? -1 : 1;
  const skip = Math.max(0, (page - 1) * limit);

  // Textsuche über aliasierte Felder (nach $addFields)
  const kundenTextMatch: any = q
    ? {
        $or: [
          { kundeName: { $regex: q, $options: 'i' } },
          { kundennummer: { $regex: q, $options: 'i' } },
        ],
      }
    : {};

  // Basispreis des Artikels vorab holen (konstant für alle Zeilen)
  const artikelDoc = await ArtikelModel.findById(artikelId).select('preis');
  if (!artikelDoc) {
    throw new Error('Artikel nicht gefunden');
  }
  const basispreisKonstant = Number((artikelDoc as any).preis ?? 0);
  const artikelObjId = new mongoose.Types.ObjectId(artikelId);

  // Hilfsfunktion Sortierung
  const buildSortStage = () => {
    switch (sort) {
      case 'kundennummer':
        return { kundennummer: sortDir } as Record<string, 1 | -1>;
      case 'kategorie':
        return { kategorie: sortDir };
      case 'region':
        return { region: sortDir };
      case 'basispreis':
        return { basispreis: sortDir };
      case 'aufpreis':
        return { aufpreis: sortDir };
      case 'effektivpreis':
        return { effektivpreis: sortDir };
      case 'kundeName':
      default:
        return { kundeName: sortDir };
    }
  };

  if (includeAllCustomers) {
    // Optimierte Pipeline: $match vor $project, Pagination VOR $lookup, Lookup NACH Pagination
    const pipeline: any[] = [
      // 1) Vorfilter auf Root-Feldern (nutzt Indexe auf name/kundennummer)
      ...(q
        ? [
            {
              $match: {
                $or: [
                  { name: { $regex: q, $options: 'i' } },
                  { kundennummer: { $regex: q, $options: 'i' } },
                  { kundenNummer: { $regex: q, $options: 'i' } },
                ],
              },
            },
          ]
        : []),
      // 2) Normierung der Anzeigefelder
      {
        $project: {
          _id: 1,
          kundeName: { $ifNull: ['$name', '$kundeName'] },
          kundennummer: { $ifNull: ['$kundennummer', '$kundenNummer'] },
          kategorie: 1,
          region: 1,
        },
      },
      // 3) Sortierung + Pagination VOR Lookup
      { $sort: buildSortStage() },
      { $skip: skip },
      { $limit: limit },
      // 4) Lookup nur für die paginierten Zeilen
      {
        $lookup: {
          from: KundenPreisModel.collection.name,
          let: { cId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$customer', '$$cId'] },
                    { $eq: ['$artikel', artikelObjId] },
                  ],
                },
              },
            },
          ],
          as: 'kp',
        },
      },
      { $unwind: { path: '$kp', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          aufpreis: { $ifNull: ['$kp.aufpreis', 0] },
          kundenPreisId: { $ifNull: [{ $toString: '$kp._id' }, 'default'] },
          basispreis: basispreisKonstant,
          effektivpreis: { $add: [basispreisKonstant, { $ifNull: ['$kp.aufpreis', 0] }] },
        },
      },
      {
        $project: {
          _id: 0,
          id: '$kundenPreisId',
          customer: { $toString: '$_id' },
          kundeName: 1,
          kundennummer: 1,
          kategorie: 1,
          region: 1,
          basispreis: 1,
          aufpreis: 1,
          effektivpreis: 1,
        },
      },
    ];

    const rows = await Kunde.aggregate(pipeline).collation({ locale: 'de', strength: 2, numericOrdering: true }).exec();
    return rows as any;
  }

  // Startet bei KundenPreis → inner-join Kunde
  const pipeline: any[] = [
    { $match: { artikel: artikelObjId } },
    {
      $lookup: {
        from: Kunde.collection.name,
        localField: 'customer',
        foreignField: '_id',
        as: 'kundeDoc',
      },
    },
    { $unwind: '$kundeDoc' },
    {
      $addFields: {
        kundeName: { $ifNull: ['$kundeDoc.name', '$kundeDoc.kundeName'] },
        kundennummer: { $ifNull: ['$kundeDoc.kundennummer', '$kundeDoc.kundenNummer'] },
        kategorie: '$kundeDoc.kategorie',
        region: '$kundeDoc.region',
        basispreis: basispreisKonstant,
      },
    },
    { $match: kundenTextMatch },
    {
      $addFields: {
        effektivpreis: { $add: [{ $ifNull: ['$basispreis', 0] }, { $ifNull: ['$aufpreis', 0] }] },
      },
    },
    { $sort: buildSortStage() },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        customer: { $toString: '$customer' },
        kundeName: 1,
        kundennummer: 1,
        kategorie: 1,
        region: 1,
        basispreis: { $ifNull: ['$basispreis', 0] },
        aufpreis: { $ifNull: ['$aufpreis', 0] },
        effektivpreis: { $ifNull: ['$effektivpreis', 0] },
      },
    },
  ];

  const rows = await KundenPreisModel.aggregate(pipeline).collation({ locale: 'de', strength: 2, numericOrdering: true }).exec();
  return rows as any;
}

/**
 * Bulk-Bearbeitung für einen Kunden anhand von Artikel-Filtern.
 * Unterstützt drei Selektionsarten (kombinierbar):
 *  - artikelIds: explizite Auswahl
 *  - artikelNummerFrom/To: Spanne der Artikelnummer (inklusive, string-Range)
 *  - artikelKategorie: Kategorie-Match (falls das Feld am Artikel existiert)
 * Aktion:
 *  - mode 'set' → Aufpreis wird auf value gesetzt
 *  - mode 'add' → value wird zum bestehenden Aufpreis addiert (Upsert: 0 + value)
 *  - mode 'sub' → value wird vom bestehenden Aufpreis subtrahiert (Upsert: 0 - value)
 */
export async function bulkEditKundenpreiseForCustomerByArtikelFilter(
  options: {
    customerId: string;
    selection: {
      artikelIds?: string[];
      artikelNummerFrom?: string;
      artikelNummerTo?: string;
      artikelKategorie?: string;
    };
    action: { mode: 'set' | 'add' | 'sub'; value: number };
  },
  currentUser: { role: string[] }
): Promise<KundenPreisResource[]> {
  if (!currentUser.role?.includes('admin')) {
    throw new Error('Admin-Zugriff erforderlich');
  }

  const { customerId, selection, action } = options;

  // 1) Relevante Artikel finden
  const artikelQuery: any = {};

  if (selection.artikelIds && selection.artikelIds.length > 0) {
    artikelQuery._id = { $in: selection.artikelIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }

  if (selection.artikelNummerFrom || selection.artikelNummerTo) {
    artikelQuery.$and = artikelQuery.$and || [];
    const nummerCond: any = {};
    if (selection.artikelNummerFrom) nummerCond.$gte = selection.artikelNummerFrom;
    if (selection.artikelNummerTo) nummerCond.$lte = selection.artikelNummerTo;
    // Feldnamen-Toleranz: nummer | artikelNummer
    artikelQuery.$and.push({ $or: [ { nummer: nummerCond }, { artikelNummer: nummerCond } ] });
  }

  if (selection.artikelKategorie) {
    artikelQuery.$and = artikelQuery.$and || [];
    // Filter strikt auf Artikel.kategorie (Top-Level-Feld im Artikel)
    artikelQuery.$and.push({ kategorie: selection.artikelKategorie });
  }

  // Wenn keine Selektion angegeben → Schutz
  if (Object.keys(artikelQuery).length === 0) {
    throw new Error('Keine Auswahlkriterien angegeben');
  }

  const artikelDocs = await ArtikelModel.find(artikelQuery).select('_id preis');
  if (artikelDocs.length === 0) return [];

  // 2) Bulk-Operationen vorbereiten
  const customerObjId = new mongoose.Types.ObjectId(customerId);
  const ops: any[] = [];

  for (const a of artikelDocs) {
    const filter = { customer: customerObjId, artikel: a._id };
    if (action.mode === 'set') {
      ops.push({
        updateOne: {
          filter,
          update: {
            $set: { aufpreis: action.value },
            $setOnInsert: { customer: customerObjId, artikel: a._id },
          },
          upsert: true,
        },
      });
    } else if (action.mode === 'sub') {
      ops.push({
        updateOne: {
          filter,
          update: [
            {
              $set: {
                customer: customerObjId,
                artikel: a._id,
                aufpreis: { $add: [ { $ifNull: [ '$aufpreis', 0 ] }, -Math.abs(action.value) ] },
              },
            },
          ],
          upsert: true,
        },
      });
    } else {
      // add
      ops.push({
        updateOne: {
          filter,
          update: [
            {
              $set: {
                customer: customerObjId,
                artikel: a._id,
                aufpreis: { $add: [ { $ifNull: [ '$aufpreis', 0 ] }, action.value ] },
              },
            },
          ],
          upsert: true,
        },
      });
    }
  }

  if (ops.length === 0) return [];

  await KundenPreisModel.bulkWrite(ops, { ordered: false });

  // 3) Ergebnis abrufen (leichtgewichtig)
  const result = await KundenPreisModel.find({
    customer: customerObjId,
    artikel: { $in: artikelDocs.map((d) => d._id) },
  }).select('_id artikel customer aufpreis');

  return result.map((e) => ({
    id: e._id.toString(),
    artikel: e.artikel.toString(),
    customer: e.customer.toString(),
    aufpreis: e.aufpreis,
  }));
}

/**
 * Bulk-Bearbeitung für einen ARTIKEL anhand von KUNDEN-Filtern.
 * Unterstützt drei Selektionsarten (kombinierbar):
 *  - customerIds: explizite Auswahl der Kunden
 *  - kundennummerFrom/To: Spanne der Kundennummer (inklusive, string-Range)
 *  - kundenKategorie / region: Filter auf Kundendaten
 * Aktion:
 *  - mode 'set' → Aufpreis wird auf value gesetzt
 *  - mode 'add' → value wird zum bestehenden Aufpreis addiert (Upsert: 0 + value)
 *  - mode 'sub' → value wird vom bestehenden Aufpreis subtrahiert (Upsert: 0 - value)
 */
export async function bulkEditKundenpreiseForArtikelByKundenFilter(
  options: {
    artikelId: string;
    selection: {
      customerIds?: string[];
      kundennummerFrom?: string;
      kundennummerTo?: string;
      kundenKategorie?: string;
      region?: string;
    };
    action: { mode: 'set' | 'add' | 'sub'; value: number };
  },
  currentUser: { role: string[] }
): Promise<KundenPreisResource[]> {
  if (!currentUser.role?.includes('admin')) {
    throw new Error('Admin-Zugriff erforderlich');
  }

  const { artikelId, selection, action } = options;

  // 1) Relevante Kunden finden
  const kundenQuery: any = {};

  if (selection.customerIds && selection.customerIds.length > 0) {
    kundenQuery._id = { $in: selection.customerIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }

  if (selection.kundennummerFrom || selection.kundennummerTo) {
    kundenQuery.$and = kundenQuery.$and || [];
    const nrCond: any = {};
    if (selection.kundennummerFrom) nrCond.$gte = selection.kundennummerFrom;
    if (selection.kundennummerTo) nrCond.$lte = selection.kundennummerTo;
    // Feldnamen-Toleranz: kundennummer | kundenNummer
    kundenQuery.$and.push({ $or: [ { kundennummer: nrCond }, { kundenNummer: nrCond } ] });
  }

  if (selection.kundenKategorie) {
    kundenQuery.kategorie = selection.kundenKategorie;
  }

  if (selection.region) {
    kundenQuery.region = selection.region;
  }

  // Wenn keine Selektion angegeben → Schutz
  if (Object.keys(kundenQuery).length === 0) {
    throw new Error('Keine Auswahlkriterien angegeben');
  }

  const kundenDocs = await Kunde.find(kundenQuery).select('_id');
  if (kundenDocs.length === 0) return [];

  // 2) Bulk-Operationen vorbereiten
  const artikelObjId = new mongoose.Types.ObjectId(artikelId);
  const ops: any[] = [];

  for (const k of kundenDocs) {
    const filter = { customer: k._id, artikel: artikelObjId };
    if (action.mode === 'set') {
      ops.push({
        updateOne: {
          filter,
          update: {
            $set: { aufpreis: action.value },
            $setOnInsert: { customer: k._id, artikel: artikelObjId },
          },
          upsert: true,
        },
      });
    } else if (action.mode === 'sub') {
      ops.push({
        updateOne: {
          filter,
          update: [
            {
              $set: {
                customer: k._id,
                artikel: artikelObjId,
                aufpreis: { $add: [ { $ifNull: [ '$aufpreis', 0 ] }, -Math.abs(action.value) ] },
              },
            },
          ],
          upsert: true,
        },
      });
    } else {
      // add
      ops.push({
        updateOne: {
          filter,
          update: [
            {
              $set: {
                customer: k._id,
                artikel: artikelObjId,
                aufpreis: { $add: [ { $ifNull: [ '$aufpreis', 0 ] }, action.value ] },
              },
            },
          ],
          upsert: true,
        },
      });
    }
  }

  if (ops.length === 0) return [];

  await KundenPreisModel.bulkWrite(ops, { ordered: false });

  // 3) Ergebnis abrufen (leichtgewichtig)
  const result = await KundenPreisModel.find({
    artikel: artikelObjId,
    customer: { $in: kundenDocs.map((d) => d._id) },
  }).select('_id artikel customer aufpreis');

  return result.map((e) => ({
    id: e._id.toString(),
    artikel: e.artikel.toString(),
    customer: e.customer.toString(),
    aufpreis: e.aufpreis,
  }));
}

//  * Kunden-zentrierte Liste (Bestimmte Artikel): wie listKundenpreiseForCustomer(includeAllArticles=true),
//  * aber auf die beim Kunden hinterlegten `bestimmteArtikel` eingeschränkt.
//  *
//  * Verhalten:
//  *  - Wenn der Kunde keine `bestimmteArtikel` gesetzt hat (leer/undefined) → fällt auf listKundenpreiseForCustomer zurück.
//  *  - Ansonsten werden nur diese Artikel gelistet; fehlende Kundenpreise → Aufpreis = 0 (id = 'default').
//  
export async function listArtikelPreisForCustomerBestimmteArtikel(options: {
  customerId: string;
  q?: string;
  sort?: 'artikelNummer' | 'artikelName' | 'basispreis' | 'aufpreis' | 'effektivpreis';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}): Promise<Array<{
  id: string;
  artikel: string;
  artikelNummer?: string;
  artikelName?: string;
  einheit?: string;
  basispreis: number;
  aufpreis: number;
  effektivpreis: number;
}>> {
  const {
    customerId,
    q,
    sort = 'artikelName',
    order = 'asc',
    page = 1,
    limit = 50,
  } = options;

  if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
    throw new Error('Ungültige customerId');
  }

  // Kunde laden und bestimmteArtikel prüfen
  const kunde = await Kunde.findById(customerId).select('bestimmteArtikel').lean();
  if (!kunde) throw new Error('Kunde nicht gefunden');

  const bestimmte = Array.isArray((kunde as any).bestimmteArtikel)
    ? (kunde as any).bestimmteArtikel
    : [];

  // Keine Einschränkung gesetzt → Standardliste
  if (!bestimmte || bestimmte.length === 0) {
    return listKundenpreiseForCustomer({
      customerId,
      q,
      sort,
      order,
      page,
      limit,
      includeAllArticles: true,
    });
  }

  const sortDir = order === 'desc' ? -1 : 1;
  const skip = Math.max(0, (page - 1) * limit);

  const buildSortStage = () => {
    switch (sort) {
      case 'artikelNummer':
        return { artikelNummer: sortDir } as Record<string, 1 | -1>;
      case 'basispreis':
        return { basispreis: sortDir };
      case 'aufpreis':
        return { aufpreis: sortDir };
      case 'effektivpreis':
        return { effektivpreis: sortDir };
      case 'artikelName':
      default:
        return { artikelName: sortDir };
    }
  };

  // Bestimmte Artikel IDs normalisieren
  const bestimmteIds = (bestimmte as any[])
    .map((x) => (typeof x === 'string' ? x : x?.toString?.()))
    .filter(Boolean)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (bestimmteIds.length === 0) {
    // Falls Daten kaputt sind, lieber Standardliste statt leer
    return listKundenpreiseForCustomer({
      customerId,
      q,
      sort,
      order,
      page,
      limit,
      includeAllArticles: true,
    });
  }

  const pipeline: any[] = [
    // Nur bestimmte Artikel (und weiterhin kein Leergut)
    {
      $match: {
        _id: { $in: bestimmteIds },
        kategorie: { $ne: 'Leergut' },
      },
    },
    // Optional: Suche auf Root-Feldern (nutzt Indexe auf name/nummer)
    ...(q
      ? [
          {
            $match: {
              $or: [
                { nummer: { $regex: q, $options: 'i' } },
                { name: { $regex: q, $options: 'i' } },
              ],
            },
          },
        ]
      : []),
    // Normierung der Felder
    {
      $project: {
        _id: 1,
        artikelNummer: { $ifNull: ['$nummer', '$artikelNummer'] },
        artikelName: { $ifNull: ['$name', '$artikelName'] },
        einheit: 1,
        kategorie: 1,
        basispreis: { $ifNull: ['$preis', 0] },
      },
    },
    // Sortierung + Pagination VOR Lookup
    { $sort: buildSortStage() },
    { $skip: skip },
    { $limit: limit },
    // Lookup nur für die paginierten Zeilen
    {
      $lookup: {
        from: KundenPreisModel.collection.name,
        let: { aId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$artikel', '$$aId'] },
                  { $eq: ['$customer', new mongoose.Types.ObjectId(customerId)] },
                ],
              },
            },
          },
        ],
        as: 'kp',
      },
    },
    { $unwind: { path: '$kp', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        aufpreis: { $ifNull: ['$kp.aufpreis', 0] },
        kundenPreisId: { $ifNull: [{ $toString: '$kp._id' }, 'default'] },
        effektivpreis: { $add: ['$basispreis', { $ifNull: ['$kp.aufpreis', 0] }] },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$kundenPreisId',
        artikel: { $toString: '$_id' },
        artikelNummer: 1,
        artikelName: 1,
        einheit: 1,
        kategorie: 1,
        basispreis: { $ifNull: ['$basispreis', 0] },
        aufpreis: { $ifNull: ['$aufpreis', 0] },
        effektivpreis: { $ifNull: ['$effektivpreis', 0] },
      },
    },
  ];

  const rows = await ArtikelModel.aggregate(pipeline)
    .collation({ locale: 'de', strength: 2, numericOrdering: true })
    .exec();

  return rows as any;
}
