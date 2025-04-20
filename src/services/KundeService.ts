import { Kunde } from '../model/KundeModel'; // Pfad ggf. anpassen
import { KundeResource, LoginResource } from '../Resources'; // Pfad ggf. anpassen
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// JWT-Secret, idealerweise über Umgebungsvariablen konfiguriert
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

/**
 * Registriert einen neuen Kunden.
 * Diese Funktion ist öffentlich (self registration).
 */
export async function createKunde(data: {
  name: string;
  kundenNummer: string;
  password: string;
  email: string;
  adresse: string;
  telefon?: string;
}): Promise<KundeResource> {
  // Prüfen, ob bereits ein Kunde mit derselben Email oder KundenNummer existiert
  const existing = await Kunde.findOne({
    $or: [{ email: data.email }, { kundenNummer: data.kundenNummer }]
  });
  if (existing) {
    throw new Error('Kunde existiert bereits');
  }
  // Passwort hashen
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const newKunde = new Kunde({
    name: data.name,
    kundenNummer: data.kundenNummer,
    password: hashedPassword,
    email: data.email,
    adresse: data.adresse,
    telefon: data.telefon,
  });
  const saved = await newKunde.save();
  return {
    id: saved._id.toString(),
    name: saved.name,
    kundenNummer: saved.kundenNummer,
    email: saved.email,
    adresse: saved.adresse,
    telefon: saved.telefon,
    updatedAt: saved.updatedAt.toISOString(),
  };
}

/**
 * Ruft alle Kunden ab.
 * Nur Admins (role === "a") sollten diese Funktion nutzen.
 */
export async function getAllKunden(currentUser: LoginResource): Promise<KundeResource[]> {
  if (currentUser.role !== 'a') {
    throw new Error('Admin-Zugriff erforderlich');
  }
  const kunden = await Kunde.find();
  return kunden.map(k => ({
    id: k._id.toString(),
    name: k.name,
    kundenNummer: k.kundenNummer,
    email: k.email,
    adresse: k.adresse,
    telefon: k.telefon,
    updatedAt: k.updatedAt.toISOString(),
  }));
}

/**
 * Ruft einen einzelnen Kunden anhand der ID ab.
 * Entweder ein Admin oder der Kunde selbst (currentUser.id === id) kann diese Funktion nutzen.
 */
export async function getKundeById(id: string, currentUser: LoginResource): Promise<KundeResource> {
  if (currentUser.role !== 'a' && currentUser.id !== id) {
    throw new Error('Zugriff verweigert');
  }
  const kunde = await Kunde.findById(id);
  if (!kunde) {
    throw new Error('Kunde nicht gefunden');
  }
  return {
    id: kunde._id.toString(),
    name: kunde.name,
    kundenNummer: kunde.kundenNummer,
    email: kunde.email,
    adresse: kunde.adresse,
    telefon: kunde.telefon,
    updatedAt: kunde.updatedAt.toISOString(),
  };
}

/**
 * Aktualisiert einen Kunden.
 * Entweder ein Admin oder der Kunde selbst darf sein Konto aktualisieren.
 */
export async function updateKunde(
  id: string,
  data: Partial<{ name: string; kundenNummer:string, password: string; email: string; adresse: string; telefon: string }>,
  currentUser: LoginResource
): Promise<KundeResource> {
  if (currentUser.role !== 'a' && currentUser.id !== id) {
    throw new Error('Zugriff verweigert');
  }
  const updateData: any = {};
  if (data.name) updateData.name = data.name;
  if (data.kundenNummer) updateData.kundenNummer = data.kundenNummer;
  if (data.email) updateData.email = data.email;
  if (data.adresse) updateData.adresse = data.adresse;
  if (data.telefon) updateData.telefon = data.telefon;
  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }
  const updated = await Kunde.findByIdAndUpdate(id, updateData, { new: true });
  if (!updated) {
    throw new Error('Kunde nicht gefunden');
  }
  return {
    id: updated._id.toString(),
    name: updated.name,
    kundenNummer: updated.kundenNummer,
    email: updated.email,
    adresse: updated.adresse,
    telefon: updated.telefon,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

/**
 * Löscht einen Kunden.
 * Entweder ein Admin oder der Kunde selbst darf das Konto löschen.
 */
export async function deleteKunde(id: string, currentUser: LoginResource): Promise<void> {
  if (currentUser.role !== 'a' && currentUser.id !== id) {
    throw new Error('Zugriff verweigert');
  }
  const deleted = await Kunde.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('Kunde nicht gefunden');
  }
}

/**
 * Authentifiziert einen Kunden anhand von Email und Passwort.
 * Bei erfolgreicher Authentifizierung wird ein JWT-Token zurückgegeben.
 */
export async function loginKunde(
  credentials: { email: string; password: string }
): Promise<{ token: string; user: LoginResource }> {
  const { email, password } = credentials;
  if (!email || !password) {
    throw new Error('Email und Passwort sind erforderlich');
  }
  const kunde = await Kunde.findOne({ email });
  if (!kunde) {
    throw new Error('Ungültige Anmeldedaten');
  }
  const passwordValid = await bcrypt.compare(password, kunde.password);
  if (!passwordValid) {
    throw new Error('Ungültige Anmeldedaten');
  }
  const payload: LoginResource = {
    id: kunde._id.toString(),
    role: 'u', // Kunde hat die Rolle "u" (user)
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
  return 'Logout erfolgreich';
}

export async function getKundenFavoriten(
  kundenId: string,
  currentUser: LoginResource
): Promise<string[]> {
  if (currentUser.role !== 'a' && currentUser.id !== kundenId) {
    throw new Error('Zugriff verweigert');
  }

  const kunde = await Kunde.findById(kundenId);
  if (!kunde) {
    throw new Error('Kunde nicht gefunden');
  }

  return kunde.favoriten?.map(f => f.toString()) || [];
}

export async function addKundenFavorit(
  kundenId: string,
  artikelId: string,
  currentUser: LoginResource
): Promise<void> {
  if (currentUser.role !== 'a' && currentUser.id !== kundenId) {
    throw new Error('Zugriff verweigert');
  }

  const kunde = await Kunde.findById(kundenId);
  if (!kunde) throw new Error('Kunde nicht gefunden');

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
  if (currentUser.role !== 'a' && currentUser.id !== kundenId) {
    throw new Error('Zugriff verweigert');
  }

  const kunde = await Kunde.findById(kundenId);
  if (!kunde) throw new Error('Kunde nicht gefunden');

  if (kunde.favoriten) {
    kunde.favoriten = kunde.favoriten.filter(f => f.toString() !== artikelId);
    await kunde.save();
  }
}