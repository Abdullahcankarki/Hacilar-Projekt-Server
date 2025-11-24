

import { ZerlegeAuftragModel } from "../model/ZerlegeAuftragModel";
import { DateTime } from "luxon";
import { Auftrag } from "../model/AuftragModel";
import {
  ArtikelPosition,
} from "../model/ArtikelPositionModel";
import { Kunde } from "../model/KundeModel";
import { ArtikelModel } from "../model/ArtikelModel";
import { ArtikelPositionResource } from "../Resources";
import { Mitarbeiter } from "../model/MitarbeiterModel";
import mongoose from "mongoose";

import { TourStop } from "../model/TourStopModel";
import { Tour } from "../model/TourModel";
import { Fahrzeug } from "../model/FahrzeugModel";

import { ReservierungModel } from "../model/ReservierungModel";
import { createReservierung, updateReservierung, cancelReservierung, listReservierungen } from "./inventory/ReservierungsService";
import { BestandAggModel } from "../model/BestandsAggModel";

// ============================================================
// Hilfstypen
// ============================================================

// ============================================================
// Debug-Helper (nur temporär für Gewicht-Analyse)
// ============================================================

export type DateRange = {
  from?: Date;
  to?: Date;
};

type AuftragStatus = "offen" | "in Bearbeitung" | "abgeschlossen" | "storniert";

export interface AuftragsOverviewStats {
  totalAuftraege: number;
  totalUmsatz: number;
  totalNettoGewichtKg: number;
  statusCounts: Record<AuftragStatus, number>;
}

export interface UmsatzByRegion {
  region: string | null;
  umsatz: number;
  nettoGewichtKg: number;
  auftragsCount: number;
}

export interface UmsatzByKundenKategorie {
  kategorie: string | null;
  umsatz: number;
  nettoGewichtKg: number;
  kundenCount: number;
}

export interface UmsatzByArtikelKategorie {
  kategorie: string | null;
  umsatz: number;
  nettoGewichtKg: number;
}

export interface TopArtikel {
  artikelId: string;
  artikelNummer?: string;
  artikelName?: string;
  kategorie?: string;
  umsatz: number;
  nettoGewichtKg: number;
}

export interface KundenRankingItem {
  kundeId: string;
  name: string;
  region?: string;
  kategorie?: string;
  umsatz: number;
  nettoGewichtKg: number;
  auftragsCount: number;
}

export interface TourOverviewStats {
  totalTouren: number;
  totalStops: number;
  totalGewichtKg: number;
  tourenByRegion: {
    region: string;
    count: number;
    gewichtKg: number;
  }[];
  tourenByFahrer: {
    fahrerId: string | null;
    fahrerName: string | null;
    count: number;
    gewichtKg: number;
  }[];
}

export interface ZerlegeOverviewStats {
  totalZerlegeAuftraege: number;
  offeneZerlegeAuftraege: number;
  erledigteZerlegeAuftraege: number;
}

// ============================================================
// Hilfsfunktionen
// ============================================================

/**
 * Baut ein $match für lieferdatum auf Basis eines DateRange.
 * Wichtig: Immer Auftrag.lieferdatum verwenden – nicht createdAt o.ä.
 */
function buildLieferdatumMatch(range?: DateRange) {
  const match: any = {};
  if (range?.from || range?.to) {
    match.lieferdatum = {};
    if (range.from) {
      match.lieferdatum.$gte = range.from;
    }
    if (range.to) {
      match.lieferdatum.$lte = range.to;
    }
  }
  return match;
}

/**
 * Ausdruck für "Netto-Gewicht wenn vorhanden, sonst Menge falls Einheit = kg".
 * Für Stück/Karton/Kiste wird kein Gewicht berechnet.
 */
function nettoGewichtExpr() {
  return {
    $cond: [
      { $and: [{ $ne: ["$nettogewicht", null] }, { $ne: ["$nettogewicht", 0] }] },
      "$nettogewicht",
      {
        $cond: [
          { $eq: ["$einheit", "kg"] },
          "$menge",
          0,
        ],
      },
    ],
  };
}

// ============================================================
// 1) Auftrags-Overview (Umsatz, Gewicht, Status) – nach Lieferdatum
// ============================================================

export async function getAuftragsOverviewByLieferdatum(range?: DateRange): Promise<AuftragsOverviewStats> {
  const match: any = buildLieferdatumMatch(range);

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(match).length > 0) {
    pipeline.push({ $match: match });
  }

  // Join auf ArtikelPositionen, damit wir wie überall mit gesamtpreis arbeiten
  pipeline.push(
    {
      $lookup: {
        from: ArtikelPosition.collection.name,
        localField: "artikelPosition",
        foreignField: "_id",
        as: "positionen",
      },
    },
    {
      $unwind: {
        path: "$positionen",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $group: {
        _id: null,
        // Anzahl unterschiedlicher Aufträge
        auftraegeSet: { $addToSet: "$_id" },
        // Summe aller Positions-Gesamtpreise
        totalUmsatz: {
          $sum: {
            $ifNull: ["$positionen.gesamtpreis", 0],
          },
        },
        // Statuszählung basierend auf Auftrag.status
        offen: {
          $sum: {
            $cond: [{ $eq: ["$status", "offen"] }, 1, 0],
          },
        },
        inBearbeitung: {
          $sum: {
            $cond: [{ $eq: ["$status", "in Bearbeitung"] }, 1, 0],
          },
        },
        abgeschlossen: {
          $sum: {
            $cond: [{ $eq: ["$status", "abgeschlossen"] }, 1, 0],
          },
        },
        storniert: {
          $sum: {
            $cond: [{ $eq: ["$status", "storniert"] }, 1, 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalAuftraege: { $size: "$auftraegeSet" },
        totalUmsatz: 1,
        offen: 1,
        inBearbeitung: 1,
        abgeschlossen: 1,
        storniert: 1,
      },
    }
  );

  const result = await Auftrag.aggregate(pipeline).exec();
  const base: AuftragsOverviewStats = {
    totalAuftraege: 0,
    totalUmsatz: 0,
    totalNettoGewichtKg: 0,
    statusCounts: {
      offen: 0,
      "in Bearbeitung": 0,
      abgeschlossen: 0,
      storniert: 0,
    },
  };

  const group = result[0];
  if (!group) {
    return base;
  }

  // Netto-Gewicht holen wir separat aus ArtikelPositionen, damit immer nettogewicht bevorzugt wird
  const gewicht = await getTotalNettoGewichtByLieferdatum(range);

  return {
    totalAuftraege: group.totalAuftraege,
    totalUmsatz: group.totalUmsatz,
    totalNettoGewichtKg: gewicht,
    statusCounts: {
      offen: group.offen,
      "in Bearbeitung": group.inBearbeitung,
      abgeschlossen: group.abgeschlossen,
      storniert: group.storniert,
    },
  };
}

// ============================================================
// 2) Gesamt-Netto-Gewicht nach Lieferdatum (über ArtikelPositionen)
// ============================================================

export async function getTotalNettoGewichtByLieferdatum(range?: DateRange): Promise<number> {
  const matchAuftrag: any = buildLieferdatumMatch(range);

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(matchAuftrag).length > 0) {
    pipeline.push({ $match: matchAuftrag });
  }

  pipeline.push(
    {
      $lookup: {
        from: ArtikelPosition.collection.name,
        localField: "artikelPosition",
        foreignField: "_id",
        as: "positionen",
      },
    },
    { $unwind: "$positionen" },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: "positionen.artikel",
        foreignField: "_id",
        as: "artikel",
      },
    },
    { $unwind: { path: "$artikel", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        totalNettoGewicht: {
          $sum: {
            $let: {
              vars: {
                netto: "$positionen.nettogewicht",
                gesamt: "$positionen.gesamtgewicht",
              },
              in: {
                $cond: [
                  { $gt: ["$$netto", 0] },
                  "$$netto",
                  {
                    $cond: [
                      { $gt: ["$$gesamt", 0] },
                      "$$gesamt",
                      {
                        $cond: [
                          { $eq: ["$positionen.einheit", "kg"] },
                          "$positionen.menge",
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    }
  );

  const result = await Auftrag.aggregate(pipeline).exec();
  if (!result[0]) {
    return 0;
  }
  return result[0].totalNettoGewicht || 0;
}

// ============================================================
// 3) Umsatz nach Region (Kunde.region) – nach Lieferdatum
// ============================================================

export async function getUmsatzByRegion(range?: DateRange): Promise<UmsatzByRegion[]> {
  const matchAuftrag: any = buildLieferdatumMatch(range);

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(matchAuftrag).length > 0) {
    pipeline.push({ $match: matchAuftrag });
  }

  pipeline.push(
    {
      $lookup: {
        from: Kunde.collection.name,
        localField: "kunde",
        foreignField: "_id",
        as: "kunde",
      },
    },
    { $unwind: { path: "$kunde", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: ArtikelPosition.collection.name,
        localField: "artikelPosition",
        foreignField: "_id",
        as: "positionen",
      },
    },
    {
      $unwind: {
        path: "$positionen",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: "positionen.artikel",
        foreignField: "_id",
        as: "artikel",
      },
    },
    { $unwind: { path: "$artikel", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$kunde.region",
        umsatz: { $sum: { $ifNull: ["$positionen.gesamtpreis", 0] } },
        nettoGewichtKg: {
          $sum: {
            $let: {
              vars: {
                netto: "$positionen.nettogewicht",
                gesamt: "$positionen.gesamtgewicht",
              },
              in: {
                $cond: [
                  { $gt: ["$$netto", 0] },
                  "$$netto",
                  {
                    $cond: [
                      { $gt: ["$$gesamt", 0] },
                      "$$gesamt",
                      {
                        $cond: [
                          { $eq: ["$positionen.einheit", "kg"] },
                          "$positionen.menge",
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        auftragsCount: { $addToSet: "$_id" },
      },
    },
    {
      $project: {
        _id: 0,
        region: "$_id",
        umsatz: 1,
        nettoGewichtKg: 1,
        auftragsCount: { $size: "$auftragsCount" },
      },
    },
    { $sort: { umsatz: -1 } }
  );

  const result = await Auftrag.aggregate(pipeline).exec();
  return result as UmsatzByRegion[];
}

// ============================================================
// 4) Umsatz nach Kunden-Kategorie (Kunde.kategorie) – nach Lieferdatum
// ============================================================

export async function getUmsatzByKundenKategorie(range?: DateRange): Promise<UmsatzByKundenKategorie[]> {
  const matchAuftrag: any = buildLieferdatumMatch(range);

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(matchAuftrag).length > 0) {
    pipeline.push({ $match: matchAuftrag });
  }

  pipeline.push(
    {
      $lookup: {
        from: Kunde.collection.name,
        localField: "kunde",
        foreignField: "_id",
        as: "kunde",
      },
    },
    { $unwind: { path: "$kunde", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: ArtikelPosition.collection.name,
        localField: "artikelPosition",
        foreignField: "_id",
        as: "positionen",
      },
    },
    { $unwind: { path: "$positionen", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: "positionen.artikel",
        foreignField: "_id",
        as: "artikel",
      },
    },
    { $unwind: { path: "$artikel", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$kunde.kategorie",
        umsatz: { $sum: { $ifNull: ["$positionen.gesamtpreis", 0] } },
        nettoGewichtKg: {
          $sum: {
            $let: {
              vars: {
                netto: "$positionen.nettogewicht",
                gesamt: "$positionen.gesamtgewicht",
              },
              in: {
                $cond: [
                  { $gt: ["$$netto", 0] },
                  "$$netto",
                  {
                    $cond: [
                      { $gt: ["$$gesamt", 0] },
                      "$$gesamt",
                      {
                        $cond: [
                          { $eq: ["$positionen.einheit", "kg"] },
                          "$positionen.menge",
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        kunden: { $addToSet: "$kunde._id" },
      },
    },
    {
      $project: {
        _id: 0,
        kategorie: "$_id",
        umsatz: 1,
        nettoGewichtKg: 1,
        kundenCount: { $size: "$kunden" },
      },
    },
    { $sort: { umsatz: -1 } }
  );

  const result = await Auftrag.aggregate(pipeline).exec();
  return result as UmsatzByKundenKategorie[];
}

// ============================================================
// 5) Umsatz nach Artikel-Kategorie – nach Lieferdatum
// ============================================================

export async function getUmsatzByArtikelKategorie(range?: DateRange): Promise<UmsatzByArtikelKategorie[]> {
  const matchAuftrag: any = buildLieferdatumMatch(range);

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(matchAuftrag).length > 0) {
    pipeline.push({ $match: matchAuftrag });
  }

  pipeline.push(
    {
      $lookup: {
        from: ArtikelPosition.collection.name,
        localField: "artikelPosition",
        foreignField: "_id",
        as: "positionen",
      },
    },
    { $unwind: { path: "$positionen", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: "positionen.artikel",
        foreignField: "_id",
        as: "artikel",
      },
    },
    { $unwind: { path: "$artikel", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$artikel.kategorie",
        umsatz: { $sum: { $ifNull: ["$positionen.gesamtpreis", 0] } },
        nettoGewichtKg: {
          $sum: {
            $let: {
              vars: {
                netto: "$positionen.nettogewicht",
                gesamt: "$positionen.gesamtgewicht",
              },
              in: {
                $cond: [
                  { $gt: ["$$netto", 0] },
                  "$$netto",
                  {
                    $cond: [
                      { $gt: ["$$gesamt", 0] },
                      "$$gesamt",
                      {
                        $cond: [
                          { $eq: ["$positionen.einheit", "kg"] },
                          "$positionen.menge",
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        kategorie: "$_id",
        umsatz: 1,
        nettoGewichtKg: 1,
      },
    },
    { $sort: { umsatz: -1 } }
  );

  const result = await Auftrag.aggregate(pipeline).exec();
  return result as UmsatzByArtikelKategorie[];
}

// ============================================================
// 6) Top-Artikel nach Umsatz – nach Lieferdatum
// ============================================================

export async function getTopArtikel(range?: DateRange, limit = 10): Promise<TopArtikel[]> {
  const matchAuftrag: any = buildLieferdatumMatch(range);
  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(matchAuftrag).length > 0) {
    pipeline.push({ $match: matchAuftrag });
  }

  pipeline.push(
    {
      $lookup: {
        from: ArtikelPosition.collection.name,
        localField: "artikelPosition",
        foreignField: "_id",
        as: "positionen",
      },
    },
    { $unwind: { path: "$positionen", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: "positionen.artikel",
        foreignField: "_id",
        as: "artikel",
      },
    },
    { $unwind: { path: "$artikel", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$positionen.artikel",
        umsatz: { $sum: { $ifNull: ["$positionen.gesamtpreis", 0] } },
        nettoGewichtKg: {
          $sum: {
            $let: {
              vars: {
                netto: "$positionen.nettogewicht",
                gesamt: "$positionen.gesamtgewicht",
              },
              in: {
                $cond: [
                  { $gt: ["$$netto", 0] },
                  "$$netto",
                  {
                    $cond: [
                      { $gt: ["$$gesamt", 0] },
                      "$$gesamt",
                      {
                        $cond: [
                          { $eq: ["$positionen.einheit", "kg"] },
                          "$positionen.menge",
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
    { $sort: { umsatz: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "artikel",
      },
    },
    { $unwind: { path: "$artikel", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        artikelId: { $toString: "$_id" },
        artikelNummer: "$artikel.artikelNummer",
        artikelName: "$artikel.name",
        kategorie: "$artikel.kategorie",
        umsatz: 1,
        nettoGewichtKg: 1,
      },
    }
  );

  const result = await Auftrag.aggregate(pipeline).exec();
  return result as TopArtikel[];
}

// ============================================================
// 7) Kunden-Ranking nach Umsatz – nach Lieferdatum
// ============================================================

export async function getKundenRanking(range?: DateRange, limit = 50): Promise<KundenRankingItem[]> {
  const matchAuftrag: any = buildLieferdatumMatch(range);

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(matchAuftrag).length > 0) {
    pipeline.push({ $match: matchAuftrag });
  }

  pipeline.push(
    {
      $lookup: {
        from: Kunde.collection.name,
        localField: "kunde",
        foreignField: "_id",
        as: "kunde",
      },
    },
    { $unwind: { path: "$kunde", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: ArtikelPosition.collection.name,
        localField: "artikelPosition",
        foreignField: "_id",
        as: "positionen",
      },
    },
    { $unwind: { path: "$positionen", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: ArtikelModel.collection.name,
        localField: "positionen.artikel",
        foreignField: "_id",
        as: "artikel",
      },
    },
    { $unwind: { path: "$artikel", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$kunde._id",
        name: { $first: "$kunde.name" },
        region: { $first: "$kunde.region" },
        kategorie: { $first: "$kunde.kategorie" },
        umsatz: { $sum: { $ifNull: ["$positionen.gesamtpreis", 0] } },
        nettoGewichtKg: {
          $sum: {
            $let: {
              vars: {
                netto: "$positionen.nettogewicht",
                gesamt: "$positionen.gesamtgewicht",
              },
              in: {
                $cond: [
                  { $gt: ["$$netto", 0] },
                  "$$netto",
                  {
                    $cond: [
                      { $gt: ["$$gesamt", 0] },
                      "$$gesamt",
                      {
                        $cond: [
                          { $eq: ["$positionen.einheit", "kg"] },
                          "$positionen.menge",
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        auftragsCount: { $addToSet: "$_id" },
      },
    },
    { $sort: { umsatz: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        kundeId: { $toString: "$_id" },
        name: 1,
        region: 1,
        kategorie: 1,
        umsatz: 1,
        nettoGewichtKg: 1,
        auftragsCount: { $size: "$auftragsCount" },
      },
    }
  );

  const result = await Auftrag.aggregate(pipeline).exec();
  return result as KundenRankingItem[];
}

// ============================================================
// 8) Tour-Overview – auf Basis Tour.datum
// ============================================================

export async function getTourOverview(range?: DateRange): Promise<TourOverviewStats> {
  const match: any = {};
  if (range?.from || range?.to) {
    match.datum = {};
    if (range.from) {
      match.datum.$gte = range.from;
    }
    if (range.to) {
      match.datum.$lte = range.to;
    }
  }

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(match).length > 0) {
    pipeline.push({ $match: match });
  }

pipeline.push(
  {
    $lookup: {
      from: TourStop.collection.name,
      localField: "_id",
      foreignField: "tourId",
      as: "stops",
    },
  },
  {
    // Pro Tour ein Dokument, stopsCount ist einfach die Länge des Arrays
    $project: {
      region: 1,
      fahrerId: 1,
      belegtesGewichtKg: 1,
      stopsCount: { $size: "$stops" },
    },
  }
);

  const tours = await Tour.aggregate(pipeline).exec();

  const totalTouren = tours.length;
  const totalStops = tours.reduce((sum: number, t: any) => sum + (t.stopsCount || 0), 0);
  const totalGewichtKg = tours.reduce((sum: number, t: any) => sum + (t.belegtesGewichtKg || 0), 0);

  const byRegionMap = new Map<string, { region: string; count: number; gewichtKg: number }>();
  const byFahrerMap = new Map<string, { fahrerId: string | null; fahrerName: string | null; count: number; gewichtKg: number }>();

  for (const t of tours) {
    const regionKey = t.region || "Unbekannt";
    const regionObj = byRegionMap.get(regionKey) || { region: regionKey, count: 0, gewichtKg: 0 };
    regionObj.count += 1;
    regionObj.gewichtKg += t.belegtesGewichtKg || 0;
    byRegionMap.set(regionKey, regionObj);

    const fahrerId = t.fahrerId ? String(t.fahrerId) : null;
    const fahrerKey = fahrerId || "null";
    const fahrerObj = byFahrerMap.get(fahrerKey) || { fahrerId, fahrerName: null, count: 0, gewichtKg: 0 };
    fahrerObj.count += 1;
    fahrerObj.gewichtKg += t.belegtesGewichtKg || 0;
    byFahrerMap.set(fahrerKey, fahrerObj);
  }

  // Fahrer-Namen nachladen
  const fahrerIds = Array.from(byFahrerMap.values())
    .map((f) => f.fahrerId)
    .filter((id): id is string => !!id);

  if (fahrerIds.length > 0) {
    const fahrerDocs = await Mitarbeiter.find({ _id: { $in: fahrerIds } }).select("name").lean();
    const nameMap = new Map<string, string>();
    fahrerDocs.forEach((f: any) => {
      nameMap.set(String(f._id), f.name);
    });

    for (const f of byFahrerMap.values()) {
      if (f.fahrerId) {
        f.fahrerName = nameMap.get(f.fahrerId) || null;
      }
    }
  }

  return {
    totalTouren,
    totalStops,
    totalGewichtKg,
    tourenByRegion: Array.from(byRegionMap.values()),
    tourenByFahrer: Array.from(byFahrerMap.values()),
  };
}

// ============================================================
// 9) Zerlege-Overview – einfacher Statusüberblick
// ============================================================

export async function getZerlegeOverview(range?: DateRange): Promise<ZerlegeOverviewStats> {
  const match: any = {};
  if (range?.from || range?.to) {
    // erstelltAm ist ein ISO-String; wir wandeln ihn in Date-Bereiche um
    if (range.from || range.to) {
      const fromIso = range.from ? DateTime.fromJSDate(range.from).toISO() : undefined;
      const toIso = range.to ? DateTime.fromJSDate(range.to).toISO() : undefined;

      match.erstelltAm = {};
      if (fromIso) {
        match.erstelltAm.$gte = fromIso;
      }
      if (toIso) {
        match.erstelltAm.$lte = toIso;
      }
    }
  }

  const pipeline: mongoose.PipelineStage[] = [];

  if (Object.keys(match).length > 0) {
    pipeline.push({ $match: match });
  }

  pipeline.push({
    $group: {
      _id: null,
      totalZerlegeAuftraege: { $sum: 1 },
      offeneZerlegeAuftraege: {
        $sum: {
          $cond: [{ $eq: ["$archiviert", false] }, 1, 0],
        },
      },
      erledigteZerlegeAuftraege: {
        $sum: {
          $cond: [{ $eq: ["$archiviert", true] }, 1, 0],
        },
      },
    },
  });

  const result = await ZerlegeAuftragModel.aggregate(pipeline).exec();
  const base: ZerlegeOverviewStats = {
    totalZerlegeAuftraege: 0,
    offeneZerlegeAuftraege: 0,
    erledigteZerlegeAuftraege: 0,
  };

  if (!result[0]) {
    return base;
  }

  return {
    totalZerlegeAuftraege: result[0].totalZerlegeAuftraege || 0,
    offeneZerlegeAuftraege: result[0].offeneZerlegeAuftraege || 0,
    erledigteZerlegeAuftraege: result[0].erledigteZerlegeAuftraege || 0,
  };
}

export type StatsDateRange = {
  from?: string;
  to?: string;
};

/**
 * Generic Vergleichsfunktion:
 * - Du übergibst eine bestehende KPI-Funktion (z.B. api.getStatsAuftragsOverview)
 * - plus zwei Zeiträume
 * - die Funktion ruft die KPI-Funktion für beide Zeiträume auf und gibt beide Ergebnisse zurück
 */
export async function compareKpi<T>(
  kpiFn: (params: { from?: string; to?: string }) => Promise<T>,
  rangeA: StatsDateRange,
  rangeB: StatsDateRange
): Promise<{ rangeA: T; rangeB: T }> {
  const [resultA, resultB] = await Promise.all([
    kpiFn({ from: rangeA.from, to: rangeA.to }),
    kpiFn({ from: rangeB.from, to: rangeB.to }),
  ]);
  return { rangeA: resultA, rangeB: resultB };
}
