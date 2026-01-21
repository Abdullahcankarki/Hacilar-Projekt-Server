import { Kunde } from "../model/KundeModel"; // Pfad ggf. anpassen
import { Auftrag } from "../model/AuftragModel";
import { ArtikelPosition } from "../model/ArtikelPositionModel";
import { ZerlegeAuftragModel } from "../model/ZerlegeAuftragModel";
import { KundeResource, LoginResource } from "../Resources"; // Pfad ggf. anpassen
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Types } from "mongoose";
import { AuthError } from "../routes/CustomErrors";

// JWT-Secret, idealerweise über Umgebungsvariablen konfiguriert
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

function normalizeEmail(email?: string) {
  return (email || "").trim().toLowerCase();
}

function mapKundeToResource(k: any): KundeResource {
  return {
    id: k._id.toString(),
    name: k.name,
    kundenNummer: k.kundenNummer,
    email: k.email,
    adresse: k.adresse,
    telefon: k.telefon,
    lieferzeit: k.lieferzeit,
    ustId: k.ustId,
    handelsregisterNr: k.handelsregisterNr,
    ansprechpartner: k.ansprechpartner,
    website: k.website,
    branchenInfo: k.branchenInfo,
    region: k.region,
    kategorie: k.kategorie,
    gewerbeDateiUrl: k.gewerbeDateiUrl,
    zusatzDateiUrl: k.zusatzDateiUrl,
    isApproved: k.isApproved,
    emailRechnung: k.emailRechnung,
    emailLieferschein: k.emailLieferschein,
    emailBuchhaltung: k.emailBuchhaltung,
    emailSpedition: k.emailSpedition,
    bestimmteArtikel: Array.isArray(k.bestimmteArtikel) ? k.bestimmteArtikel.map((a: any) => a.toString()) : undefined,
    fehlmengenBenachrichtigung: k.fehlmengenBenachrichtigung,
    updatedAt: k.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

// ==== Analytics Types for Kunde ====
export type KundeAnalyticsParams = {
  from?: string; // ISO start (inclusive), if omitted -> no lower bound
  to?: string;   // ISO end (inclusive), if omitted -> no upper bound
  granularity?: "day" | "week" | "month";
  topArticlesLimit?: number;
  recentOrdersLimit?: number;
  priceHistogramBuckets?: number;
};

export type KundeArticleBreakdown = {
  artikelId: string;
  artikelName?: string;
  artikelNummer?: string;
  menge: number;
  umsatz: number;
  avgPreisGewichtet: number | null;
  minPreis: number | null;
  maxPreis: number | null;
  bestellzeilen: number;
};

export type KundeFulfillmentTotals = {
  bestelltMenge: number;
  rausMenge: number;
  differenz: number;
  rate: number | null;
  positionen: number;
};

export type KundeTimelinePoint = {
  date: string;
  menge: number;
  umsatz: number;
};

export type KundeFulfillmentTimelinePoint = {
  date: string;
  bestelltMenge: number;
  rausMenge: number;
  differenz: number;
};

export type KundeRecentOrder = {
  auftragId: string;
  auftragsnummer?: string;
  lieferdatum?: string;
  artikelId: string;
  artikelName?: string;
  menge: number;
  einzelpreis: number | null;
  gesamtpreis: number;
};

export type KundeAnalytics = {
  totals: {
    totalMenge: number;
    totalUmsatz: number;
    bestellzeilen: number;
    artikelCount: number;
    avgPreisGewichtet: number | null;
    minPreis: number | null;
    maxPreis: number | null;
  };
  byArtikel: KundeArticleBreakdown[];
  priceHistogram: Array<{ min: number; max: number; count: number }>;
  priceExact: Array<{ preis: number; count: number }>;
  priceExactByDate: Array<{ date: string; preis: number; count: number }>;
  timeline: KundeTimelinePoint[];
  fulfillment: KundeFulfillmentTotals;
  fulfillmentTimeline: KundeFulfillmentTimelinePoint[];
  recentOrders: KundeRecentOrder[];
};

function parseDate(input?: string): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Registriert einen neuen Kunden.
 * Diese Funktion ist öffentlich (self registration).
 */
export async function createKunde(data: {
  name: string;
  kundenNummer?: string;
  password: string;
  email: string;
  adresse: string;
  telefon?: string;
  lieferzeit?: string;
  ustId?: string;
  ansprechpartner?: string;
  region?: string;
  kategorie?: string;
  gewerbeDateiUrl?: string;
  zusatzDateiUrl?: string;
  emailRechnung?: string;
  emailLieferschein?: string;
  emailBuchhaltung?: string;
  emailSpedition?: string;
}): Promise<KundeResource> {
  const email = normalizeEmail(data.email);
  if (!email) throw new Error("E-Mail ist erforderlich");

  // Duplikate prüfen (nur mit definierten Feldern suchen)
  const or: any[] = [{ email }];
  if (data.kundenNummer) or.push({ kundenNummer: data.kundenNummer });
  const existing = await Kunde.findOne({ $or: or });
  if (existing) {
    throw new Error("Kunde mit dieser E-Mail oder Kundennummer existiert bereits");
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);
  const newKunde = new Kunde({
    name: (data.name || "").trim(),
    kundenNummer: data.kundenNummer?.trim(),
    password: hashedPassword,
    email,
    adresse: (data.adresse || "").trim(),
    telefon: data.telefon?.trim(),
    lieferzeit: data.lieferzeit?.trim(),
    ustId: data.ustId?.trim(),
    ansprechpartner: data.ansprechpartner?.trim(),
    region: data.region?.trim(),
    kategorie: data.kategorie?.trim(),
    isApproved: false,
    gewerbeDateiUrl: data.gewerbeDateiUrl?.trim(),
    zusatzDateiUrl: data.zusatzDateiUrl?.trim(),
    emailRechnung: data.emailRechnung?.trim(),
    emailLieferschein: data.emailLieferschein?.trim(),
    emailBuchhaltung: data.emailBuchhaltung?.trim(),
    emailSpedition: data.emailSpedition?.trim(),
  });
  const saved = await newKunde.save();
  return mapKundeToResource(saved);
}

/**
 * Gibt alle Kunden zurück, die noch nicht freigegeben wurden (isApproved: false).
 * Nur für Admins erlaubt.
 */
export async function getUnapprovedKunden(
  currentUser: LoginResource
): Promise<KundeResource[]> {
  if (!currentUser.role.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }

  const kunden = await Kunde.find({ isApproved: false });
  return kunden.map(mapKundeToResource);
}

/**
 * Ruft alle Kunden ab.
 * Nur Admins (role === "a") sollten diese Funktion nutzen.
 */
export async function getAllKunden(
  params: {
    page?: number;
    limit?: number;
    search?: string;
    region?: string;
    kategorie?: string;
    isApproved?: boolean;
    sortBy?: string;       // z. B. "name" oder "-createdAt"
  },
  currentUser: LoginResource
): Promise<{ items: KundeResource[]; total: number; page: number; limit: number }> {
  if (!currentUser.role.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }

  const page = params.page ?? 1;
  const totalDocsAll = await Kunde.estimatedDocumentCount();
  const limit = params.limit !== undefined ? params.limit : (totalDocsAll || 1);

  const query: any = {};
  if (params.search) {
    query.$or = [
      { name: { $regex: params.search, $options: "i" } },
      { email: { $regex: params.search, $options: "i" } },
      { kundenNummer: { $regex: params.search, $options: "i" } },
      { kategorie: { $regex: params.search, $options: "i" } },
    ];
  }
  if (params.region) query.region = params.region;
  if (params.kategorie) query.kategorie = params.kategorie;
  if (params.isApproved !== undefined) query.isApproved = params.isApproved;

  const sort: any = {};
  if (params.sortBy) {
    // falls "-createdAt" übergeben wird -> absteigend
    if (params.sortBy.startsWith("-")) {
      sort[params.sortBy.substring(1)] = -1;
    } else {
      sort[params.sortBy] = 1;
    }
  } else {
    sort.createdAt = -1; // Standard: neueste zuerst
  }

  const [kunden, total] = await Promise.all([
    Kunde.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    Kunde.countDocuments(query),
  ]);

  return {
    items: kunden.map(mapKundeToResource),
    total,
    page,
    limit,
  };
}

/**
 * Ruft einen einzelnen Kunden anhand der ID ab.
 * Entweder ein Admin oder der Kunde selbst (currentUser.id === id) kann diese Funktion nutzen.
 */
export async function getKundeById(
  id: string,
  currentUser: LoginResource
): Promise<KundeResource> {
  if (!currentUser.role.includes("admin") && currentUser.id !== id) {
    throw new Error("Zugriff verweigert");
  }
  const kunde = await Kunde.findById(id);
  if (!kunde) {
    throw new Error("Kunde nicht gefunden");
  }
  return mapKundeToResource(kunde);
}

/**
 * Aktualisiert einen Kunden.
 * Entweder ein Admin oder der Kunde selbst darf sein Konto aktualisieren.
 */
export async function updateKunde(
  id: string,
  data: Partial<{
    name: string;
    kundenNummer: string;
    password: string;
    email: string;
    adresse: string;
    telefon: string;
    lieferzeit: string;
    ustId: string;
    handelsregisterNr: string;
    ansprechpartner: string;
    website: string;
    branchenInfo: string;
    region: string;
    kategorie: string;
    gewerbeDateiUrl: string;
    zusatzDateiUrl: string;
    isApproved: boolean;
    emailRechnung?: string;
    emailLieferschein?: string;
    emailBuchhaltung?: string;
    emailSpedition?: string;
    fehlmengenBenachrichtigung?: boolean;
  }>,
  currentUser: LoginResource
): Promise<KundeResource> {
  if (!currentUser.role.includes("admin") && currentUser.id !== id) {
    throw new Error("Zugriff verweigert");
  }

  const updateData: any = {};

  // E-Mail Update: normalisieren + Duplikate prüfen
  if (data.email !== undefined) {
    const email = normalizeEmail(data.email);
    if (!email) throw new Error("E-Mail darf nicht leer sein");
    const dupe = await Kunde.findOne({ _id: { $ne: id }, email });
    if (dupe) throw new Error("Diese E-Mail ist bereits vergeben");
    updateData.email = email;
  }

  // Kundennummer Duplikatprüfung
  if (data.kundenNummer !== undefined) {
    const num = data.kundenNummer.trim();
    if (num) {
      const dupeNum = await Kunde.findOne({ _id: { $ne: id }, kundenNummer: num });
      if (dupeNum) throw new Error("Diese Kundennummer ist bereits vergeben");
      updateData.kundenNummer = num;
    } else {
      updateData.kundenNummer = undefined;
    }
  }

  if (data.name !== undefined) updateData.name = (data.name || "").trim();
  if (data.adresse !== undefined) updateData.adresse = (data.adresse || "").trim();
  if (data.telefon !== undefined) updateData.telefon = data.telefon?.trim();
  if (data.lieferzeit !== undefined) updateData.lieferzeit = data.lieferzeit?.trim();
  if (data.ustId !== undefined) updateData.ustId = data.ustId?.trim();
  if (data.handelsregisterNr !== undefined) updateData.handelsregisterNr = data.handelsregisterNr?.trim();
  if (data.ansprechpartner !== undefined) updateData.ansprechpartner = data.ansprechpartner?.trim();
  if (data.website !== undefined) updateData.website = data.website?.trim();
  if (data.branchenInfo !== undefined) updateData.branchenInfo = data.branchenInfo?.trim();
  if (data.region !== undefined) updateData.region = data.region?.trim();
  if (data.kategorie !== undefined) updateData.kategorie = data.kategorie?.trim();
  if (data.gewerbeDateiUrl !== undefined) updateData.gewerbeDateiUrl = data.gewerbeDateiUrl?.trim();
  if (data.zusatzDateiUrl !== undefined) updateData.zusatzDateiUrl = data.zusatzDateiUrl?.trim();
  if (data.emailRechnung !== undefined) updateData.emailRechnung = data.emailRechnung?.trim();
  if (data.emailLieferschein !== undefined) updateData.emailLieferschein = data.emailLieferschein?.trim();
  if (data.emailBuchhaltung !== undefined) updateData.emailBuchhaltung = data.emailBuchhaltung?.trim();
  if (data.emailSpedition !== undefined) updateData.emailSpedition = data.emailSpedition?.trim();
  if (data.fehlmengenBenachrichtigung !== undefined) updateData.fehlmengenBenachrichtigung = data.fehlmengenBenachrichtigung;

  // Passwort ändern (optional)
  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }

  // isApproved: NICHT hier änderbar → separate Admin-Funktion nutzen (approveKunde)
  if (data.isApproved !== undefined) {
    // Ignorieren, keine Fehlermeldung um Frontend tolerant zu halten
  }

  const updated = await Kunde.findByIdAndUpdate(id, updateData, { new: true });
  if (!updated) throw new Error("Kunde nicht gefunden");
  return mapKundeToResource(updated);
}

export async function approveKunde(id: string, isApproved: boolean, currentUser: LoginResource): Promise<KundeResource> {
  if (!currentUser.role.includes("admin")) throw new Error("Admin-Zugriff erforderlich");
  const updated = await Kunde.findByIdAndUpdate(id, { isApproved }, { new: true });
  if (!updated) throw new Error("Kunde nicht gefunden");
  return mapKundeToResource(updated);
}

/**
 * Löscht einen Kunden.
 * Entweder ein Admin oder der Kunde selbst darf das Konto löschen.
 */
export async function deleteKunde(
  id: string,
  currentUser: LoginResource
): Promise<void> {
  if (!currentUser.role.includes("admin") && currentUser.id !== id) {
    throw new Error("Zugriff verweigert");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const deleted = await Kunde.findByIdAndDelete(id).session(session);
      if (!deleted) throw new Error("Kunde nicht gefunden");

      const auftraege = await Auftrag.find({ kunde: id }).session(session);
      const artikelPositionIds = auftraege.flatMap((auftrag) => auftrag.artikelPosition);

      if (artikelPositionIds.length > 0) {
        await ArtikelPosition.deleteMany({ _id: { $in: artikelPositionIds } }).session(session);
        await ZerlegeAuftragModel.deleteMany({ "artikelPositionen.artikelPositionId": { $in: artikelPositionIds } }).session(session);
      }

      await Auftrag.deleteMany({ kunde: id }).session(session);
    });
  } finally {
    await session.endSession();
  }
}


export async function loginKunde(credentials: {
  email: string;
  password: string;
}): Promise<{ token: string; user: LoginResource }> {
  const { email: rawEmail, password } = credentials;

  if (!rawEmail || !password) {
    throw new AuthError("MISSING_FIELDS", "Email und Passwort sind erforderlich", 400);
  }

  const email = normalizeEmail(rawEmail);
  const kunde = await Kunde.findOne({ email });
  if (!kunde) {
    throw new AuthError("INVALID_EMAIL", "Diese Email existiert nicht.", 401);
  }

  const passwordValid = await bcrypt.compare(password, kunde.password);
  if (!passwordValid) {
    throw new AuthError("INVALID_PASSWORD", "Passwort ist falsch.", 401);
  }

  if (!kunde.isApproved) {
    throw new AuthError("NOT_APPROVED", "Der Account wurde noch nicht freigegeben.", 403);
  }

  const payload: LoginResource = {
    id: kunde._id.toString(),
    role: ["kunde"],
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
  };

  const token = jwt.sign(payload, JWT_SECRET);
  return { token, user: payload };
}

/**
 * Logout-Funktion.
 * Da beim JWT-Ansatz der Logout clientseitig (Token löschen) erfolgt,
 * gibt diese Funktion lediglich eine Erfolgsmeldung zurück.
 */
export async function logoutKunde(): Promise<string> {
  return "Logout erfolgreich";
}

/**
 * Setzt das Passwort eines Kunden anhand der E-Mail neu.
 * Wird vom Passwort-Reset (Option B) verwendet.
 */
export async function updateKundePasswordByEmail(emailRaw: string, newPassword: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  if (!email) throw new Error("E-Mail ist erforderlich");
  if (!newPassword || newPassword.length < 6) throw new Error("Passwort muss mind. 6 Zeichen lang sein");

  const kunde = await Kunde.findOne({ email });
  if (!kunde) {
    // absichtlich generische Meldung, um Enumeration zu vermeiden
    throw new Error("Kunde nicht gefunden: " + email);
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  (kunde as any).password = hashed;
  await kunde.save();
}

/**
 * Prüft, ob ein Kunde mit dieser E-Mail existiert (normalisiert).
 * Wird genutzt, um Reset-Mails nur an echte Kunden zu senden.
 */
export async function kundeExistsByEmail(emailRaw: string): Promise<boolean> {
  const email = normalizeEmail(emailRaw);
  if (!email) return false;
  const kunde = await Kunde.findOne({ email });
  return !!kunde;
}

export async function getKundenFavoriten(
  kundenId: string,
  currentUser: LoginResource
): Promise<string[]> {
  if (!currentUser.role.includes("admin") && currentUser.id !== kundenId) {
    throw new Error("Zugriff verweigert");
  }

  const kunde = await Kunde.findById(kundenId);
  if (!kunde) {
    throw new Error("Kunde nicht gefunden");
  }

  return kunde.favoriten?.map((f) => f.toString()) || [];
}

export async function setBestimmteArtikel(
  kundenId: string,
  artikelIds: string[] | undefined,
  currentUser: LoginResource
): Promise<KundeResource> {
  if (!currentUser.role.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }

  if (!kundenId) throw new Error("kundenId ist erforderlich");

  const kunde = await Kunde.findById(kundenId);
  if (!kunde) {
    throw new Error("Kunde nicht gefunden");
  }

  // Normalisieren: nur gültige ObjectIds, Duplikate entfernen
  const ids = (artikelIds || [])
    .map((id) => (id || "").trim())
    .filter((id) => !!id);

  const uniqueIds = Array.from(new Set(ids));

  const objectIds: Types.ObjectId[] = [];
  for (const id of uniqueIds) {
    if (!Types.ObjectId.isValid(id)) {
      throw new Error("Ungültige Artikel-ID: " + id);
    }
    objectIds.push(new Types.ObjectId(id));
  }

  (kunde as any).bestimmteArtikel = objectIds;
  await kunde.save();

  return mapKundeToResource(kunde);
}

export async function addKundenFavorit(
  kundenId: string,
  artikelId: string,
  currentUser: LoginResource
): Promise<void> {
  if (!currentUser.role.includes("admin") && currentUser.id !== kundenId) {
    throw new Error("Zugriff verweigert");
  }

  const kunde = await Kunde.findById(kundenId);
  if (!kunde) throw new Error("Kunde nicht gefunden");

  if (!kunde.favoriten) kunde.favoriten = [];
  if (!kunde.favoriten.includes(artikelId as any)) {
    kunde.favoriten.push(artikelId as any);
    await kunde.save();
  }
}

export async function removeKundenFavorit(
  kundenId: string,
  artikelId: string,
  currentUser: LoginResource
): Promise<void> {
  if (!currentUser.role.includes("admin") && currentUser.id !== kundenId) {
    throw new Error("Zugriff verweigert");
  }

  const kunde = await Kunde.findById(kundenId);
  if (!kunde) throw new Error("Kunde nicht gefunden");

  if (kunde.favoriten) {
    kunde.favoriten = kunde.favoriten.filter((f) => f.toString() !== artikelId);
    await kunde.save();
  }
}

export async function normalizeKundenEmails(): Promise<number> {
  const kunden = await Kunde.find({ email: { $exists: true, $ne: null } });

  let count = 0;
  for (const k of kunden) {
    const normalized = k.email.trim().toLowerCase();
    if (k.email !== normalized) {
      k.email = normalized;
      await k.save();
      count++;
    }
  }

  return count;
}

/**
 * Analytics für einen Kunden: Zeitraumbasierte Auswertung der Einkaufsdaten.
 * - Menge/Umsatz über Zeit (Lieferdatum)
 * - Top-Artikel (Menge/Umsatz, min/max/avg Preis)
 * - Preisverteilung (Histogramm + exakte Preise)
 * - Fulfillment (bestellt Menge vs. raus Nettogewicht) – nur wenn Nettogewicht vorhanden
 * - Letzte Bestellungen
 */
export async function getKundeAnalytics(
  kundenId: string,
  params: KundeAnalyticsParams = {}
): Promise<KundeAnalytics> {
  // Validate & prepare
  if (!kundenId) throw new Error("kundenId ist erforderlich");
  const kundeObj = new Types.ObjectId(kundenId);

  const fromDate = parseDate(params.from || "");
  const toDate = parseDate(params.to || "");
  const granularity: "day" | "week" | "month" = params.granularity || "week";
  const topArticlesLimit = Math.max(1, Math.min(params.topArticlesLimit || 20, 100));
  const recentOrdersLimit = Math.max(1, Math.min(params.recentOrdersLimit || 50, 200));
  const priceHistogramBuckets = Math.max(1, Math.min(params.priceHistogramBuckets || 10, 50));

  // Pipeline: Start von ArtikelPosition, dann in Aufträge joinen, die diesen Kunden betreffen
  const pipeline: any[] = [
    // Positionen überhaupt
    { $match: { } },
    // Join Aufträge, die diese Position enthalten und dem Kunden gehören
    {
      $lookup: {
        from: "auftrags",
        let: { posId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ["$$posId", "$artikelPosition"] },
                  { $eq: ["$kunde", kundeObj] }
                ]
              }
            }
          }
        ],
        as: "auftrag"
      }
    },
    { $unwind: "$auftrag" },
    // Lieferdatum robust gewinnen und casten
    {
      $addFields: {
        lieferdatumRaw: {
          $ifNull: [
            "$auftrag.lieferdatum",
            { $ifNull: ["$auftrag.lieferDatum", "$auftrag.liefer_datum"] }
          ]
        }
      }
    },
    {
      $addFields: {
        lieferdatum: {
          $convert: { input: "$lieferdatumRaw", to: "date", onError: null, onNull: null }
        }
      }
    },
    // Datumsfilter, falls gesetzt
    ...(fromDate || toDate
      ? [{
          $match: {
            lieferdatum: {
              ...(fromDate ? { $gte: fromDate } : {}),
              ...(toDate ? { $lte: toDate } : {}),
            }
          }
        }]
      : []),
    // Artikel-Infos anreichern
    {
      $lookup: {
        from: "artikels",
        localField: "artikel",
        foreignField: "_id",
        as: "artikelDoc"
      }
    },
    { $unwind: { path: "$artikelDoc", preserveNullAndEmptyArrays: true } },
    // Casting & abgeleitete Felder
    {
      $addFields: {
        _menge: { $convert: { input: "$menge", to: "double", onError: 0, onNull: 0 } },
        _einzelpreisValid: { $convert: { input: "$einzelpreis", to: "double", onError: null, onNull: null } },
        _nettogewichtValid: { $convert: { input: "$nettogewicht", to: "double", onError: null, onNull: null } },
      }
    },
    {
      $addFields: {
        gesamtpreisCalc: {
          $cond: [
            { $ne: ["$_einzelpreisValid", null] },
            { $multiply: ["$_menge", "$_einzelpreisValid"] },
            0
          ]
        }
      }
    },
    // Nur sinnvolle Datensätze für spätere Berechnungen
    {
      $project: {
        artikel: 1,
        artikelName: { $ifNull: ["$artikelName", "$artikelDoc.name"] },
        artikelNummer: { $ifNull: ["$artikelNummer", "$artikelDoc.artikelNummer"] },
        menge: "$_menge",
        einzelpreis: "$_einzelpreisValid",
        gesamtpreis: { $ifNull: ["$gesamtpreis", "$gesamtpreisCalc"] },
        nettogewicht: "$_nettogewichtValid",
        lieferdatum: 1,
        auftragId: "$auftrag._id",
        auftragsnummer: "$auftrag.auftragsnummer"
      }
    },
    // Ab hier werden die Facets erzeugt
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalMenge: { $sum: "$menge" },
              totalUmsatz: { $sum: "$gesamtpreis" },
              bestellzeilen: { $sum: 1 },
              artikelSet: { $addToSet: "$artikel" },
              sumPreisMalMenge: {
                $sum: {
                  $cond: [
                    { $ne: ["$einzelpreis", null] },
                    { $multiply: ["$menge", "$einzelpreis"] },
                    0
                  ]
                }
              },
              sumMengeMitPreis: {
                $sum: {
                  $cond: [
                    { $ne: ["$einzelpreis", null] },
                    "$menge",
                    0
                  ]
                }
              },
              minPreis: { $min: "$einzelpreis" },
              maxPreis: { $max: "$einzelpreis" }
            }
          },
          {
            $project: {
              _id: 0,
              totalMenge: 1,
              totalUmsatz: 1,
              bestellzeilen: 1,
              artikelCount: { $size: "$artikelSet" },
              avgPreisGewichtet: {
                $cond: [
                  { $gt: ["$sumMengeMitPreis", 0] },
                  { $divide: ["$sumPreisMalMenge", "$sumMengeMitPreis"] },
                  null
                ]
              },
              minPreis: 1,
              maxPreis: 1
            }
          }
        ],
        byArtikel: [
          {
            $group: {
              _id: "$artikel",
              artikelName: { $first: "$artikelName" },
              artikelNummer: { $first: "$artikelNummer" },
              menge: { $sum: "$menge" },
              umsatz: { $sum: "$gesamtpreis" },
              bestellzeilen: { $sum: 1 },
              sumPreisMalMenge: {
                $sum: {
                  $cond: [
                    { $ne: ["$einzelpreis", null] },
                    { $multiply: ["$menge", "$einzelpreis"] },
                    0
                  ]
                }
              },
              sumMengeMitPreis: {
                $sum: {
                  $cond: [
                    { $ne: ["$einzelpreis", null] },
                    "$menge",
                    0
                  ]
                }
              },
              minPreis: { $min: "$einzelpreis" },
              maxPreis: { $max: "$einzelpreis" }
            }
          },
          {
            $project: {
              _id: 0,
              artikelId: { $toString: "$_id" },
              artikelName: 1,
              artikelNummer: 1,
              menge: 1,
              umsatz: 1,
              avgPreisGewichtet: {
                $cond: [
                  { $gt: ["$sumMengeMitPreis", 0] },
                  { $divide: ["$sumPreisMalMenge", "$sumMengeMitPreis"] },
                  null
                ]
              },
              minPreis: 1,
              maxPreis: 1,
              bestellzeilen: 1
            }
          },
          { $sort: { menge: -1, umsatz: -1 } },
          { $limit: topArticlesLimit }
        ],
        priceHistogram: [
          { $match: { einzelpreis: { $ne: null } } },
          {
            $bucketAuto: {
              groupBy: "$einzelpreis",
              buckets: priceHistogramBuckets,
              output: { count: { $sum: 1 } }
            }
          }
        ],
        priceExact: [
          { $match: { einzelpreis: { $ne: null } } },
          {
            $group: {
              _id: { $round: ["$einzelpreis", 4] },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, preis: { $convert: { input: "$_id", to: "double", onError: null, onNull: null } }, count: 1 } }
        ],
        priceExactByDate: [
          { $match: { einzelpreis: { $ne: null }, lieferdatum: { $ne: null } } },
          {
            $group: {
              _id: {
                price: { $round: ["$einzelpreis", 4] },
                d: {
                  $dateTrunc: { date: "$lieferdatum", unit: granularity, startOfWeek: "Monday" }
                }
              },
              count: { $sum: 1 }
            }
          },
          { $sort: { "_id.d": 1, "_id.price": 1 } },
          {
            $project: {
              _id: 0,
              date: "$_id.d",
              preis: { $convert: { input: "$_id.price", to: "double", onError: null, onNull: null } },
              count: 1
            }
          }
        ],
        timeline: [
          { $match: { lieferdatum: { $ne: null } } },
          {
            $group: {
              _id: {
                $dateTrunc: { date: "$lieferdatum", unit: granularity, startOfWeek: "Monday" }
              },
              menge: { $sum: "$menge" },
              umsatz: { $sum: "$gesamtpreis" }
            }
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: "$_id", menge: 1, umsatz: 1 } }
        ],
        fulfillmentTotals: [
          { $match: { nettogewicht: { $ne: null } } },
          {
            $group: {
              _id: null,
              bestelltMenge: { $sum: "$menge" },
              rausMenge: { $sum: "$nettogewicht" },
              positionen: { $sum: 1 }
            }
          },
          {
            $project: {
              _id: 0,
              bestelltMenge: 1,
              rausMenge: 1,
              differenz: { $subtract: ["$rausMenge", "$bestelltMenge"] },
              rate: {
                $cond: [{ $gt: ["$bestelltMenge", 0] }, { $divide: ["$rausMenge", "$bestelltMenge"] }, null]
              },
              positionen: 1
            }
          }
        ],
        fulfillmentTimeline: [
          { $match: { nettogewicht: { $ne: null }, lieferdatum: { $ne: null } } },
          {
            $group: {
              _id: {
                $dateTrunc: { date: "$lieferdatum", unit: granularity, startOfWeek: "Monday" }
              },
              bestelltMenge: { $sum: "$menge" },
              rausMenge: { $sum: "$nettogewicht" }
            }
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              _id: 0,
              date: "$_id",
              bestelltMenge: 1,
              rausMenge: 1,
              differenz: { $subtract: ["$rausMenge", "$bestelltMenge"] }
            }
          }
        ],
        recentOrders: [
          { $sort: { lieferdatum: -1, _id: -1 } },
          { $limit: recentOrdersLimit },
          {
            $project: {
              _id: 0,
              auftragId: { $toString: "$auftragId" },
              auftragsnummer: 1,
              lieferdatum: 1,
              artikelId: { $toString: "$artikel" },
              artikelName: 1,
              menge: 1,
              einzelpreis: 1,
              gesamtpreis: 1
            }
          }
        ]
      }
    }
  ];

  const agg = await ArtikelPosition.aggregate(pipeline);
  const first = agg[0] || {};

  // Normalize priceHistogram buckets (support $bucketAuto shape)
  const rawBuckets = Array.isArray(first.priceHistogram) ? first.priceHistogram : [];
  const priceHistogram = rawBuckets.map((b: any) => ({
    min: (b && b._id && typeof b._id.min !== "undefined") ? b._id.min : (typeof b.min !== "undefined" ? b.min : null),
    max: (b && b._id && typeof b._id.max !== "undefined") ? b._id.max : (typeof b.max !== "undefined" ? b.max : null),
    count: typeof b.count === "number" ? b.count : 0
  }));

  const totalsRaw = Array.isArray(first.totals) && first.totals[0] ? first.totals[0] : null;
  const totals = totalsRaw ? {
    totalMenge: Number(totalsRaw.totalMenge ?? 0),
    totalUmsatz: Number(totalsRaw.totalUmsatz ?? 0),
    bestellzeilen: Number(totalsRaw.bestellzeilen ?? 0),
    artikelCount: Number(totalsRaw.artikelCount ?? 0),
    avgPreisGewichtet: totalsRaw.avgPreisGewichtet != null ? Number(totalsRaw.avgPreisGewichtet) : null,
    minPreis: totalsRaw.minPreis != null ? Number(totalsRaw.minPreis) : null,
    maxPreis: totalsRaw.maxPreis != null ? Number(totalsRaw.maxPreis) : null
  } : {
    totalMenge: 0, totalUmsatz: 0, bestellzeilen: 0, artikelCount: 0, avgPreisGewichtet: null, minPreis: null, maxPreis: null
  };

  const byArtikel = Array.isArray(first.byArtikel) ? first.byArtikel.map((r: any) => ({
    artikelId: r.artikelId,
    artikelName: r.artikelName,
    artikelNummer: r.artikelNummer,
    menge: Number(r.menge ?? 0),
    umsatz: Number(r.umsatz ?? 0),
    avgPreisGewichtet: r.avgPreisGewichtet != null ? Number(r.avgPreisGewichtet) : null,
    minPreis: r.minPreis != null ? Number(r.minPreis) : null,
    maxPreis: r.maxPreis != null ? Number(r.maxPreis) : null,
    bestellzeilen: Number(r.bestellzeilen ?? 0)
  })) : [];

  const priceExact = Array.isArray(first.priceExact) ? first.priceExact.map((p: any) => ({
    preis: Number(p.preis ?? 0),
    count: Number(p.count ?? 0)
  })) : [];

  const priceExactByDate = Array.isArray(first.priceExactByDate) ? first.priceExactByDate.map((r: any) => ({
    date: new Date(r.date).toISOString(),
    preis: Number(r.preis ?? 0),
    count: Number(r.count ?? 0)
  })) : [];

  const timeline = Array.isArray(first.timeline) ? first.timeline.map((t: any) => ({
    date: new Date(t.date).toISOString(),
    menge: Number(t.menge ?? 0),
    umsatz: Number(t.umsatz ?? 0)
  })) : [];

  const fulfillmentTotals = Array.isArray(first.fulfillmentTotals) && first.fulfillmentTotals[0] ? first.fulfillmentTotals[0] : null;
  const fulfillment: KundeFulfillmentTotals = fulfillmentTotals ? {
    bestelltMenge: Number(fulfillmentTotals.bestelltMenge ?? 0),
    rausMenge: Number(fulfillmentTotals.rausMenge ?? 0),
    differenz: Number(fulfillmentTotals.differenz ?? 0),
    rate: fulfillmentTotals.rate != null ? Number(fulfillmentTotals.rate) : null,
    positionen: Number(fulfillmentTotals.positionen ?? 0)
  } : { bestelltMenge: 0, rausMenge: 0, differenz: 0, rate: null, positionen: 0 };

  const fulfillmentTimeline = Array.isArray(first.fulfillmentTimeline) ? first.fulfillmentTimeline.map((r: any) => ({
    date: new Date(r.date).toISOString(),
    bestelltMenge: Number(r.bestelltMenge ?? 0),
    rausMenge: Number(r.rausMenge ?? 0),
    differenz: Number(r.differenz ?? 0)
  })) : [];

  const recentOrders = Array.isArray(first.recentOrders) ? first.recentOrders.map((o: any) => ({
    auftragId: o.auftragId,
    auftragsnummer: o.auftragsnummer,
    lieferdatum: o.lieferdatum ? new Date(o.lieferdatum).toISOString() : undefined,
    artikelId: o.artikelId,
    artikelName: o.artikelName,
    menge: Number(o.menge ?? 0),
    einzelpreis: o.einzelpreis != null ? Number(o.einzelpreis) : null,
    gesamtpreis: Number(o.gesamtpreis ?? 0)
  })) : [];

  return {
    totals,
    byArtikel,
    priceHistogram,
    priceExact,
    priceExactByDate,
    timeline,
    fulfillment,
    fulfillmentTimeline,
    recentOrders
  };
}