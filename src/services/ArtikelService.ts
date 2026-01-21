import { KundenPreisModel } from "../model/KundenPreisModel";
import { ArtikelModel } from "../model/ArtikelModel"; // Pfad ggf. anpassen
import { ArtikelResource } from "../Resources"; // Pfad ggf. anpassen
import { getKundenPreis } from "./KundenPreisService";
import { Types } from "mongoose";
import { Auftrag } from "../model/AuftragModel";
import { ArtikelPosition } from "../model/ArtikelPositionModel";
import { Kunde } from "../model/KundeModel";

// Helper: Robust mapping from a Mongo/Mongoose document (lean or hydrated) to ArtikelResource
function mapToArtikelResource(
  artikel: any,
  aufpreis: number = 0
): ArtikelResource {
  // Support both hydrated documents and lean objects
  const id = artikel._id?.toString
    ? artikel._id.toString()
    : String(artikel._id);
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
    erfassungsModus: artikel.erfassungsModus ?? "GEWICHT",
  };
}

export type ArtikelAnalytics = {
  artikelId: string;
  range: { from: string; to: string; granularity: "day" | "week" | "month" };
  totals: {
    totalMenge: number;
    totalUmsatz: number;
    bestellzeilen: number;
    kundenCount: number;
    avgPreisGewichtet: number | null;
    minPreis?: number | null;
    maxPreis?: number | null;
  };
  byCustomer: Array<{
    customerId: string;
    name?: string;
    kategorie?: string;
    region?: string;
    menge: number;
    umsatz: number;
    minPreis?: number | null;
    maxPreis?: number | null;
    avgPreis?: number | null;
    avgPreisGewichtet?: number | null;
  }>;
  timeline: Array<{ date: string; menge: number; umsatz: number }>;
  priceHistogram: Array<{ min: number; max: number; count: number }>;
  priceExact: Array<{ preis: number; count: number }>;
  priceExactByDate: Array<{ date: string; preis: number; count: number }>;
  recentOrders: Array<{
    auftragId: string;
    lieferdatum: string;
    menge: number;
    einzelpreis: number;
    gesamtpreis: number;
    customerId: string;
    kundeName?: string;
  }>;
  fulfillment: {
    bestelltMenge: number;
    rausMenge: number;
    differenz: number;
    rate: number | null;
    positionen: number;
  };
  fulfillmentTimeline: Array<{
    date: string;
    bestelltMenge: number;
    rausMenge: number;
    differenz: number;
  }>;
};

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
    erfassungsModus: data.erfassungsModus ?? "GEWICHT",
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
    throw new Error("Artikel nicht gefunden");
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
    sortBy?: "name" | "preis" | "kategorie" | "artikelNummer";
    sortDir?: "asc" | "desc";
  }
): Promise<{
  items: ArtikelResource[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}> {
  const page = Math.max(1, options?.page ?? 1);

  // Build filter
  const query: any = {};
  query.kategorie = { $ne: "Leergut" };
  if (options?.kategorie) {
    if (Array.isArray(options.kategorie)) {
      query.kategorie = { $in: options.kategorie };
    } else {
      // Teilstring-Suche (case-insensitive) für Kategorie
      const escapedKat = options.kategorie
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.kategorie = { $regex: escapedKat, $options: "i" };
    }
  }
  if (typeof options?.ausverkauft === "boolean") {
    query.ausverkauft = options.ausverkauft;
  }
  if (options?.erfassungsModus) {
    query.erfassungsModus = Array.isArray(options.erfassungsModus)
      ? { $in: options.erfassungsModus }
      : options.erfassungsModus;
  }
  if (options?.name && options.name.trim().length > 0) {
    const escaped = options.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { artikelNummer: { $regex: escaped, $options: "i" } },
    ];
  }

  const limit =
    options?.limit !== undefined
      ? Math.max(1, Math.min(500, options.limit))
      : 500;
  const total = await ArtikelModel.countDocuments(query);
  const pages = Math.max(1, Math.ceil(total / limit));
  const skip = (page - 1) * limit;

  // Sortierung (Standard: nach Kategorie, dann Name aufsteigend)
  let sort: any = { kategorie: 1, name: 1 };
  if (options?.sortBy) {
    const dir = options.sortDir === "desc" ? -1 : 1;
    const field =
      options.sortBy === "artikelNummer"
        ? "artikelNummer"
        : options.sortBy === "preis"
        ? "preis"
        : options.sortBy === "kategorie"
        ? "kategorie"
        : "name";
    sort = { [field]: dir };
  }

  const artikelList = await ArtikelModel.find(query)
    .collation({ locale: "de", strength: 2 })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  let items: ArtikelResource[];

  if (!customerId) {
    items = artikelList.map((a) => mapToArtikelResource(a));
  } else {
    const kundenPreise = await KundenPreisModel.find({
      customer: new Types.ObjectId(customerId),
      artikel: { $in: artikelList.map((a) => a._id) },
    }).lean();

    const preisMap = new Map<string, number>(
      kundenPreise.map((p) => [p.artikel.toHexString(), p.aufpreis])
    );

    items = artikelList.map((a) => {
      const aufpreis = preisMap.get(a._id.toString()) || 0;
      return mapToArtikelResource(a, aufpreis);
    });
  }

  return { items, page, limit, total, pages };
}

/**
 * Liefert die "bestimmten/erlaubten" Artikel für einen Kunden.
 * Wenn der Kunde keine bestimmtenArtikel gesetzt hat (leer/undefined),
 * werden alle Artikel (wie getAllArtikel) zurückgegeben.
 */
export async function getBestimmteArtikelByKundenId(
  kundenId: string,
  options?: {
    page?: number;
    limit?: number;
    kategorie?: string | string[];
    ausverkauft?: boolean;
    name?: string;
    erfassungsModus?: string | string[];
    sortBy?: "name" | "preis" | "kategorie" | "artikelNummer";
    sortDir?: "asc" | "desc";
  }
): Promise<{
  items: ArtikelResource[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}> {
  if (!kundenId || !Types.ObjectId.isValid(kundenId)) {
    throw new Error("Ungültige Kunden-ID");
  }

  const kunde = await Kunde.findById(kundenId).lean();
  if (!kunde) {
    throw new Error("Kunde nicht gefunden");
  }

  const bestimmte = Array.isArray((kunde as any).bestimmteArtikel)
    ? (kunde as any).bestimmteArtikel
    : [];

  // Wenn keine Einschränkung gesetzt ist -> alle Artikel wie gewohnt
  if (!bestimmte || bestimmte.length === 0) {
    return getAllArtikel(kundenId, options);
  }

  const page = Math.max(1, options?.page ?? 1);

  // Build filter
  const query: any = {};
  query.kategorie = { $ne: "Leergut" };

  // Nur erlaubte Artikel des Kunden
  query._id = { $in: bestimmte };

  if (options?.kategorie) {
    if (Array.isArray(options.kategorie)) {
      query.kategorie = { $in: options.kategorie };
    } else {
      const escapedKat = options.kategorie
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.kategorie = { $regex: escapedKat, $options: "i" };
    }
  }
  if (typeof options?.ausverkauft === "boolean") {
    query.ausverkauft = options.ausverkauft;
  }
  if (options?.erfassungsModus) {
    query.erfassungsModus = Array.isArray(options.erfassungsModus)
      ? { $in: options.erfassungsModus }
      : options.erfassungsModus;
  }
  if (options?.name && options.name.trim().length > 0) {
    const escaped = options.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { artikelNummer: { $regex: escaped, $options: "i" } },
    ];
  }

  // Limit/Skip/Pages
  const limit =
    options?.limit !== undefined
      ? Math.max(1, Math.min(500, options.limit))
      : 500;

  const total = await ArtikelModel.countDocuments(query);
  const pages = Math.max(1, Math.ceil(total / limit));
  const skip = (page - 1) * limit;

  // Sortierung (Standard: nach Kategorie, dann Name aufsteigend)
  let sort: any = { kategorie: 1, name: 1 };
  if (options?.sortBy) {
    const dir = options.sortDir === "desc" ? -1 : 1;
    const field =
      options.sortBy === "artikelNummer"
        ? "artikelNummer"
        : options.sortBy === "preis"
        ? "preis"
        : options.sortBy === "kategorie"
        ? "kategorie"
        : "name";
    sort = { [field]: dir };
  }

  const artikelList = await ArtikelModel.find(query)
    .collation({ locale: "de", strength: 2 })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  // Kunden-Aufpreise laden
  const kundenPreise = await KundenPreisModel.find({
    customer: new Types.ObjectId(kundenId),
    artikel: { $in: artikelList.map((a) => a._id) },
  }).lean();

  const preisMap = new Map<string, number>(
    kundenPreise.map((p) => [p.artikel.toHexString(), p.aufpreis])
  );

  const items = artikelList.map((a) => {
    const aufpreis = preisMap.get(a._id.toString()) || 0;
    return mapToArtikelResource(a, aufpreis);
  });

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
    throw new Error("Artikel nicht gefunden");
  }

  return mapToArtikelResource(artikel);
}

/**
 * Ruft alle Artikel ab.
 */
export async function getAllArtikelClean(options?: {
  page?: number;
  limit?: number;
  kategorie?: string | string[];
  ausverkauft?: boolean;
  name?: string; // substring filter (case-insensitive)
  erfassungsModus?: string | string[];
  sortBy?: "name" | "preis" | "kategorie" | "artikelNummer";
  sortDir?: "asc" | "desc";
}): Promise<{
  items: ArtikelResource[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}> {
  const page = Math.max(1, options?.page ?? 1);

  const limit =
    options?.limit !== undefined
      ? Math.max(1, Math.min(500, options.limit))
      : 500;

  const query: any = {};
  if (options?.kategorie) {
    if (Array.isArray(options.kategorie)) {
      query.kategorie = { $in: options.kategorie };
    } else {
      const escapedKat = options.kategorie
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.kategorie = { $regex: escapedKat, $options: "i" };
    }
  }
  if (typeof options?.ausverkauft === "boolean") {
    query.ausverkauft = options.ausverkauft;
  }
  if (options?.erfassungsModus) {
    query.erfassungsModus = Array.isArray(options.erfassungsModus)
      ? { $in: options.erfassungsModus }
      : options.erfassungsModus;
  }
  if (options?.name && options.name.trim().length > 0) {
    const escaped = options.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { artikelNummer: { $regex: escaped, $options: "i" } },
    ];
  }

  const total = await ArtikelModel.countDocuments(query);
  const pages = Math.max(1, Math.ceil(total / limit));
  const skip = (page - 1) * limit;

  // Sortierung (Standard: nach Kategorie, dann Name aufsteigend)
  let sort: any = { kategorie: 1, name: 1 };
  if (options?.sortBy) {
    const dir = options.sortDir === "desc" ? -1 : 1;
    const field =
      options.sortBy === "artikelNummer"
        ? "artikelNummer"
        : options.sortBy === "preis"
        ? "preis"
        : options.sortBy === "kategorie"
        ? "kategorie"
        : "name";
    sort = { [field]: dir };
  }

  const artikelList = await ArtikelModel.find(query)
    .collation({ locale: "de", strength: 2 })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  const items = artikelList.map((a) => mapToArtikelResource(a));
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
    .collation({ locale: "de", strength: 2 })
    .lean();

  // 2. Wenn kein Kunde angegeben ist, einfach Artikel ohne Aufpreis zurückgeben
  if (!customerId) {
    return artikelList.map((a) => mapToArtikelResource(a));
  }

  // 3. Alle Kundenpreise für diese Artikel laden
  const kundenPreise = await KundenPreisModel.find({
    customer: new Types.ObjectId(customerId),
    artikel: { $in: artikelList.map((a) => a._id) },
  }).lean();

  // 4. Map zur schnellen Zuordnung
  const preisMap = new Map<string, number>(
    kundenPreise.map((p) => [p.artikel.toHexString(), p.aufpreis])
  );

  // 5. Ergebnis zusammenbauen
  return artikelList.map((a) => {
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
  const updated = await ArtikelModel.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });
  if (!updated) {
    throw new Error("Artikel nicht gefunden");
  }
  return mapToArtikelResource(updated);
}

/**
 * Löscht einen Artikel anhand der ID.
 */
export async function deleteArtikel(id: string): Promise<void> {
  const deleted = await ArtikelModel.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error("Artikel nicht gefunden");
  }
}

/**
 * Liefert umfangreiche Analytics zu einem Artikel in einem gewählten Zeitraum.
 * - Zeitraumfilter basiert auf dem Lieferdatum (aus Auftrag).
 * - Aggregiert Mengen, Umsätze, Kundenranking, Preisstatistiken, Histogramm und Zeitachse.
 *
 * @param artikelId  ID des Artikels
 * @param params     { from: ISO-Date, to: ISO-Date, granularity?: 'day'|'week'|'month', topCustomersLimit?: number, recentOrdersLimit?: number }
 */
export async function getArtikelAnalytics(
  artikelId: string,
  params: {
    from: string;
    to: string;
    granularity?: "day" | "week" | "month";
    topCustomersLimit?: number;
    recentOrdersLimit?: number;
  }
): Promise<ArtikelAnalytics> {
  
  const granularity = params.granularity ?? "day";
  const fromDate = new Date(params.from);
  const toDate = new Date(params.to);

  // defensive: ensure valid dates
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error("Ungültiger Datumsbereich (from/to)");
  }


  const artikelObjectId = new Types.ObjectId(artikelId);

  // Build collection names dynamically (robust against custom collection names)
  const auftragCollection = Auftrag.collection.name;
  const kundeCollection = Kunde.collection.name;

  // Aggregation startet bei ArtikelPositionen
  const pipeline: any[] = [
    { $match: { artikel: artikelObjectId } },
    // Auftrag (für Lieferdatum, Kunde) joinen: via artikelPosition array in Auftrag
    {
      $lookup: {
        from: auftragCollection,
        let: { posId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $in: ["$$posId", "$artikelPosition"] },
            },
          },
        ],
        as: "auftrag",
      },
    },
    { $unwind: "$auftrag" },
    // Lieferdatum & Kunde robust extrahieren und casten
    {
      $addFields: {
        // 1) Kunde
        customer: "$auftrag.kunde",
        // 2) Roh-Lieferdatum aus möglichen Feldvarianten
        lieferdatumRaw: {
          $ifNull: [
            "$auftrag.lieferDatum",
            {
              $ifNull: [
                "$auftrag.lieferdatum",
                { $ifNull: ["$auftrag.liefer_datum", null] },
              ],
            },
          ],
        },
      },
    },
    // Cast zu echtem Date (falls als String gespeichert)
    {
      $addFields: {
        lieferdatum: {
          $convert: {
            input: "$lieferdatumRaw",
            to: "date",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    // Zeitraumfilter (Lieferdatum)
    {
      $match: {
        lieferdatum: { $ne: null, $gte: fromDate, $lte: toDate },
      },
    },
    // Kunde joinen (für Name/Kategorie/Region)
    {
      $lookup: {
        from: kundeCollection,
        localField: "customer",
        foreignField: "_id",
        as: "kunde",
      },
    },
    { $unwind: { path: "$kunde", preserveNullAndEmptyArrays: true } },
    // Felder vereinheitlichen
    {
      $project: {
        menge: 1,
        einzelpreis: 1,
        gesamtpreis: {
          $ifNull: [
            "$gesamtpreis",
            {
              $let: {
                vars: {
                  m: {
                    $convert: {
                      input: "$menge",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                  p: {
                    $convert: {
                      input: "$einzelpreis",
                      to: "double",
                      onError: null,
                      onNull: null,
                    },
                  },
                },
                in: {
                  $cond: [
                    { $and: [{ $ne: ["$$p", null] }, { $gt: ["$$m", 0] }] },
                    { $multiply: ["$$m", "$$p"] },
                    0,
                  ],
                },
              },
            },
          ],
        },
        lieferdatum: 1,
        customer: 1,
        kundeName: "$kunde.name",
        kundeKategorie: "$kunde.kategorie",
        kundeRegion: "$kunde.region",
        auftragId: "$auftrag._id",
        nettogewicht: 1,
      },
    },
    // Für einige Statistiken benötigen wir min/max Preis und validiertes Nettogewicht
    {
      $addFields: {
        _einzelpreisValid: {
          $convert: {
            input: "$einzelpreis",
            to: "double",
            onError: null,
            onNull: null,
          },
        },
        _nettogewichtValid: {
          $convert: {
            input: "$nettogewicht",
            to: "double",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    // Facets für verschiedene Auswertungen
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalMenge: { $sum: "$menge" },
              totalUmsatz: { $sum: "$gesamtpreis" },
              bestellzeilen: { $sum: 1 },
              kundenSet: { $addToSet: "$customer" },
              minPreis: { $min: "$_einzelpreisValid" },
              maxPreis: { $max: "$_einzelpreisValid" },
            },
          },
          {
            $project: {
              _id: 0,
              totalMenge: 1,
              totalUmsatz: 1,
              bestellzeilen: 1,
              kundenCount: { $size: "$kundenSet" },
              avgPreisGewichtet: {
                $cond: [
                  { $gt: ["$totalMenge", 0] },
                  { $divide: ["$totalUmsatz", "$totalMenge"] },
                  null,
                ],
              },
              minPreis: 1,
              maxPreis: 1,
            },
          },
        ],
        byCustomer: [
          {
            $group: {
              _id: "$customer",
              name: { $first: "$kundeName" },
              kategorie: { $first: "$kundeKategorie" },
              region: { $first: "$kundeRegion" },
              menge: { $sum: "$menge" },
              umsatz: { $sum: "$gesamtpreis" },
              minPreis: { $min: "$_einzelpreisValid" },
              maxPreis: { $max: "$_einzelpreisValid" },
              sumPreisMalMenge: {
                $sum: {
                  $let: {
                    vars: {
                      m: {
                        $convert: {
                          input: "$menge",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      p: {
                        $convert: {
                          input: "$_einzelpreisValid",
                          to: "double",
                          onError: null,
                          onNull: null,
                        },
                      },
                    },
                    in: {
                      $cond: [
                        { $ne: ["$$p", null] },
                        { $multiply: ["$$m", "$$p"] },
                        0,
                      ],
                    },
                  },
                },
              },
            },
          },
          {
            $addFields: {
              avgPreisGewichtet: {
                $cond: [
                  { $gt: ["$menge", 0] },
                  { $divide: ["$sumPreisMalMenge", "$menge"] },
                  null,
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              customerId: { $toString: "$_id" },
              name: 1,
              kategorie: 1,
              region: 1,
              menge: 1,
              umsatz: 1,
              minPreis: 1,
              maxPreis: 1,
              avgPreis: null, // optional separat berechnen, hier fokussiert auf gewichtetes Mittel
              avgPreisGewichtet: 1,
            },
          },
          { $sort: { menge: -1 } },
        ],
        priceHistogram: [
          // Buckets über Einzelpreis (sofern vorhanden)
          {
            $match: { _einzelpreisValid: { $ne: null } },
          },
          {
            $bucketAuto: { groupBy: "$_einzelpreisValid", buckets: 10 },
          },
        ],
        priceExact: [
          { $match: { _einzelpreisValid: { $ne: null } } },
          {
            $group: {
              _id: { $round: ["$_einzelpreisValid", 4] }, // exakte Preise, leicht gerundet
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, preis: { $convert: { input: '$_id', to: 'double', onError: null, onNull: null } }, count: 1 } },
        ],
        fulfillmentTotals: [
          { $match: { _nettogewichtValid: { $ne: null } } },
          {
            $group: {
              _id: null,
              bestelltMenge: {
                $sum: {
                  $convert: { input: "$menge", to: "double", onError: 0, onNull: 0 }
                }
              },
              rausMenge: { $sum: "$_nettogewichtValid" },
              positionen: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              bestelltMenge: 1,
              rausMenge: 1,
              differenz: { $subtract: ["$rausMenge", "$bestelltMenge"] },
              rate: {
                $cond: [
                  { $gt: ["$bestelltMenge", 0] },
                  { $divide: ["$rausMenge", "$bestelltMenge"] },
                  null
                ]
              },
              positionen: 1
            },
          },
        ],
        fulfillmentTimeline: [
          { $match: { _nettogewichtValid: { $ne: null }, lieferdatum: { $ne: null } } },
          {
            $group: {
              _id: {
                $dateTrunc: {
                  date: "$lieferdatum",
                  unit: granularity,
                  startOfWeek: "Monday",
                },
              },
              bestelltMenge: {
                $sum: {
                  $convert: { input: "$menge", to: "double", onError: 0, onNull: 0 }
                }
              },
              rausMenge: { $sum: "$_nettogewichtValid" },
            },
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              _id: 0,
              date: "$_id",
              bestelltMenge: 1,
              rausMenge: 1,
              differenz: { $subtract: ["$rausMenge", "$bestelltMenge"] },
            },
          },
        ],
        priceExactByDate: [
          {
            $match: {
              _einzelpreisValid: { $ne: null },
              lieferdatum: { $ne: null },
            },
          },
          {
            $group: {
              _id: {
                price: { $round: ["$_einzelpreisValid", 4] },
                d: {
                  $dateTrunc: {
                    date: "$lieferdatum",
                    unit: granularity,
                    startOfWeek: "Monday",
                  },
                },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.d": 1, "_id.price": 1 } },
          {
            $project: {
              _id: 0,
              date: "$_id.d",
              preis: { $convert: { input: '$_id.price', to: 'double', onError: null, onNull: null } },
              count: 1
            },
          },
        ],
        timeline: [
          { $match: { lieferdatum: { $ne: null } } },
          {
            $group: {
              _id: {
                $dateTrunc: {
                  date: "$lieferdatum",
                  unit: granularity,
                },
              },
              menge: { $sum: "$menge" },
              umsatz: { $sum: "$gesamtpreis" },
            },
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              _id: 0,
              date: "$_id",
              menge: 1,
              umsatz: 1,
            },
          },
        ],
        recentOrders: [
          { $sort: { lieferdatum: -1 } },
          { $limit: params.recentOrdersLimit ?? 200 },
          {
            $project: {
              _id: 0,
              auftragId: { $toString: "$auftragId" },
              lieferdatum: 1,
              menge: 1,
              einzelpreis: "$_einzelpreisValid",
              gesamtpreis: 1,
              customerId: { $toString: "$customer" },
              kundeName: "$kundeName",
            },
          },
        ],
      },
    },
  ];

  // Deaktiviert volles Pipeline-Logging standardmäßig, aktiviere bei Bedarf:
  if (process.env.ANALYTICS_LOG_PIPELINE === "1") {
    try {
      // (pipeline logging removed)
    } catch {
      // (pipeline logging removed)
    }
  }
  const agg = await (ArtikelPosition as any).aggregate(pipeline).exec();
  const first = agg[0] || {};

  // Preis-Histogramm bleibt wie bisher...

  const priceExact = Array.isArray(first.priceExact)
    ? first.priceExact.map((p: any) => ({
        preis: Number(p.preis ?? 0),
        count: Number(p.count ?? 0),
      }))
    : [];

  const priceExactByDate = Array.isArray(first.priceExactByDate)
    ? first.priceExactByDate.map((r: any) => ({
        date: new Date(r.date).toISOString(),
        preis: Number(r.preis ?? 0),
        count: Number(r.count ?? 0),
      }))
    : [];

  const fulfillment =
    Array.isArray(first.fulfillmentTotals) && first.fulfillmentTotals[0]
      ? {
          bestelltMenge: Number(first.fulfillmentTotals[0].bestelltMenge ?? 0),
          rausMenge: Number(first.fulfillmentTotals[0].rausMenge ?? 0),
          differenz: Number(first.fulfillmentTotals[0].differenz ?? 0),
          rate:
            typeof first.fulfillmentTotals[0].rate === "number"
              ? first.fulfillmentTotals[0].rate
              : first.fulfillmentTotals[0].rate != null
              ? Number(first.fulfillmentTotals[0].rate)
              : null,
          positionen: Number(first.fulfillmentTotals[0].positionen ?? 0),
        }
      : {
          bestelltMenge: 0,
          rausMenge: 0,
          differenz: 0,
          rate: null,
          positionen: 0,
        };

  const fulfillmentTimeline = Array.isArray(first.fulfillmentTimeline)
    ? first.fulfillmentTimeline.map((r: any) => ({
        date: new Date(r.date).toISOString(),
        bestelltMenge: Number(r.bestelltMenge ?? 0),
        rausMenge: Number(r.rausMenge ?? 0),
        differenz: Number(r.differenz ?? 0),
      }))
    : [];

  // Debug counter for how many docs were dropped due to missing lieferdatum
  if (process.env.ANALYTICS_LOG_PIPELINE === "1") {
    // hint: to debug date casting issues further, sample a few records without lieferdatum
    try {
      const sampleNoDate = await (ArtikelPosition as any)
        .aggregate([
          { $match: { artikel: artikelObjectId } },
          {
            $lookup: {
              from: auftragCollection,
              localField: "auftrag",
              foreignField: "_id",
              as: "auftrag",
            },
          },
          { $unwind: "$auftrag" },
          {
            $project: {
              _id: 1,
              ld: [
                "$auftrag.lieferDatum",
                "$auftrag.lieferdatum",
                "$auftrag.liefer_datum",
              ],
            },
          },
          { $limit: 3 },
        ])
        .exec();
      // (logging removed)
    } catch (e) {
      // (logging removed)
    }
  }

  const totals = (first.totals && first.totals[0]) || {
    totalMenge: 0,
    totalUmsatz: 0,
    bestellzeilen: 0,
    kundenCount: 0,
    avgPreisGewichtet: null,
    minPreis: null,
    maxPreis: null,
  };

  // Top-Kunden begrenzen (optional)
  let byCustomer = Array.isArray(first.byCustomer) ? first.byCustomer : [];
  if (params.topCustomersLimit && params.topCustomersLimit > 0) {
    byCustomer = byCustomer.slice(0, params.topCustomersLimit);
  }

  // Preis-Histogramm normalisieren (Mongo $bucketAuto liefert min/max unter _id.{min,max})
  const rawBuckets = Array.isArray(first.priceHistogram)
    ? first.priceHistogram
    : [];
  const priceHistogram = rawBuckets.map((b: any) => ({
    min:
      b && b._id && typeof b._id.min !== "undefined"
        ? b._id.min
        : typeof b.min !== "undefined"
        ? b.min
        : null,
    max:
      b && b._id && typeof b._id.max !== "undefined"
        ? b._id.max
        : typeof b.max !== "undefined"
        ? b.max
        : null,
    count: typeof b.count === "number" ? b.count : 0,
  }));
  

  // Timeline formatieren (ISO-String)
  const timeline = (Array.isArray(first.timeline) ? first.timeline : []).map(
    (t: any) => ({
      date: new Date(t.date).toISOString(),
      menge: t.menge,
      umsatz: t.umsatz,
    })
  );

  const recentOrders = Array.isArray(first.recentOrders)
    ? first.recentOrders
    : [];

  const result: ArtikelAnalytics = {
    artikelId,
    range: { from: params.from, to: params.to, granularity },
    totals,
    byCustomer,
    timeline,
    priceHistogram,
    priceExact,
    priceExactByDate,
    fulfillment,
    fulfillmentTimeline,
    recentOrders,
  };

  return result;
}
