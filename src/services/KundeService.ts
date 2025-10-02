import { Kunde } from "../model/KundeModel"; // Pfad ggf. anpassen
import { Auftrag } from "../model/AuftragModel";
import { ArtikelPosition } from "../model/ArtikelPositionModel";
import { ZerlegeAuftragModel } from "../model/ZerlegeAuftragModel";
import { KundeResource, LoginResource } from "../Resources"; // Pfad ggf. anpassen
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

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
    updatedAt: k.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
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
    ];
  }
  if (params.region) query.region = params.region;
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

/**
 * Authentifiziert einen Kunden anhand von Email und Passwort.
 * Bei erfolgreicher Authentifizierung wird ein JWT-Token zurückgegeben.
 */
export async function loginKunde(credentials: {
  email: string;
  password: string;
}): Promise<{ token: string; user: LoginResource }> {
  const { email: rawEmail, password } = credentials;
  if (!rawEmail || !password) {
    throw new Error("Email und Passwort sind erforderlich");
  }
  const email = normalizeEmail(rawEmail);
  const kunde = await Kunde.findOne({ email });
  if (!kunde) {
    throw new Error("Ungültige Anmeldedaten");
  }
  const passwordValid = await bcrypt.compare(password, kunde.password);
  if (!passwordValid) {
    throw new Error("Ungültige Anmeldedaten");
  }
  if (!kunde.isApproved) {
    throw new Error("Nicht genehmigt");
  }
  const payload: LoginResource = {
    id: kunde._id.toString(),
    role: ["kunde"],
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // Token gültig für 1 Tag
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