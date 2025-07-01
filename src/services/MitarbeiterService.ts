import { Mitarbeiter } from '../model/MitarbeiterModel'; // Pfad ggf. anpassen
import { MitarbeiterResource, LoginResource, MitarbeiterRolle } from '../Resources'; // Pfad ggf. anpassen
import bcrypt from 'bcryptjs';
import jwt from "jsonwebtoken"

// JWT-Secret, idealerweise aus der Umgebung
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

/**
 * Erstellt einen neuen Mitarbeiter.
 * Nur Admins (role enthält "admin") dürfen diese Funktion aufrufen.
 */
export async function createMitarbeiter(
  data: {
    name: string;
    password: string;
    rollen: string[];
    email?: string;
    telefon?: string;
    abteilung?: string;
    aktiv?: boolean;
    bemerkung?: string;
    eintrittsdatum?: string;
  },
  currentUser: LoginResource
): Promise<MitarbeiterResource> {
  if (!currentUser.role.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }

  const existing = await Mitarbeiter.findOne({ name: data.name });
  if (existing) {
    throw new Error("Mitarbeiter existiert bereits");
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);
  const neuerMitarbeiter = new Mitarbeiter({
    name: data.name,
    password: hashedPassword,
    rollen: data.rollen,
    email: data.email,
    telefon: data.telefon,
    abteilung: data.abteilung,
    aktiv: data.aktiv ?? true,
    bemerkung: data.bemerkung,
    eintrittsdatum: data.eintrittsdatum ? new Date(data.eintrittsdatum) : undefined,
  });

  const saved = await neuerMitarbeiter.save();
  return {
    id: saved._id.toString(),
    name: saved.name,
    rollen: saved.rollen as MitarbeiterRolle[],
    email: saved.email,
    telefon: saved.telefon,
    abteilung: saved.abteilung,
    aktiv: saved.aktiv,
    bemerkung: saved.bemerkung,
    eintrittsdatum: saved.eintrittsdatum?.toISOString(),
  };
}

/**
 * Authentifiziert einen Mitarbeiter anhand von Name und Passwort.
 * Bei erfolgreicher Authentifizierung wird ein JWT-Token zurückgegeben.
 */
export async function loginMitarbeiter(
  credentials: { name: string; password: string }
): Promise<{ token: string; user: LoginResource }> {
  const { name, password } = credentials;
  if (!name || !password) {
    throw new Error("Name und Passwort sind erforderlich");
  }
  const user = await Mitarbeiter.findOne({ name });
  if (!user) {
    throw new Error("Ungültige Anmeldedaten");
  }
  const passwordValid = await bcrypt.compare(password, user.password);
  if (!passwordValid) {
    throw new Error("Ungültige Anmeldedaten");
  }
  const payload: LoginResource = {
    id: user._id.toString(),
    role: user.rollen as MitarbeiterRolle[],
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  };
  const token = jwt.sign(payload, JWT_SECRET);
  return { token, user: payload };
}

/**
 * Gibt alle Mitarbeiter zurück (nur für Admins).
 */
export async function getAllMitarbeiter(currentUser: LoginResource): Promise<MitarbeiterResource[]> {
  if (!currentUser.role.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }

  const mitarbeiter = await Mitarbeiter.find();
  return mitarbeiter.map(m => ({
    id: m._id.toString(),
    name: m.name,
    rollen: m.rollen as MitarbeiterRolle[],
    email: m.email,
    telefon: m.telefon,
    abteilung: m.abteilung,
    aktiv: m.aktiv,
    bemerkung: m.bemerkung,
    eintrittsdatum: m.eintrittsdatum?.toISOString(),
  }));
}

/**
 * Gibt einen einzelnen Mitarbeiter anhand der ID zurück.
 * Admins dürfen jeden sehen, sonst nur sich selbst.
 */
export async function getMitarbeiterById(id: string, currentUser: LoginResource): Promise<MitarbeiterResource> {
  if (!currentUser.role.includes("admin") && currentUser.id !== id) {
    throw new Error("Zugriff verweigert");
  }

  const m = await Mitarbeiter.findById(id);
  if (!m) throw new Error("Mitarbeiter nicht gefunden");

  return {
    id: m._id.toString(),
    name: m.name,
    rollen: m.rollen as MitarbeiterRolle[],
    email: m.email,
    telefon: m.telefon,
    abteilung: m.abteilung,
    aktiv: m.aktiv,
    bemerkung: m.bemerkung,
    eintrittsdatum: m.eintrittsdatum?.toISOString(),
  };
}

/**
 * Aktualisiert einen Mitarbeiter.
 */
export async function updateMitarbeiter(
  id: string,
  data: Partial<{
    name: string;
    password: string;
    rollen: string[];
    email: string;
    telefon: string;
    abteilung: string;
    aktiv: boolean;
    bemerkung: string;
    eintrittsdatum: string;
  }>,
  currentUser: LoginResource
): Promise<MitarbeiterResource> {
  if (!currentUser.role.includes("admin") && currentUser.id !== id) {
    throw new Error("Zugriff verweigert");
  }

  const updateData: any = { ...data };
  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }
  if (data.eintrittsdatum) {
    updateData.eintrittsdatum = new Date(data.eintrittsdatum);
  }

  const updated = await Mitarbeiter.findByIdAndUpdate(id, updateData, { new: true });
  if (!updated) throw new Error("Mitarbeiter nicht gefunden");

  return {
    id: updated._id.toString(),
    name: updated.name,
    rollen: updated.rollen as MitarbeiterRolle[],
    email: updated.email,
    telefon: updated.telefon,
    abteilung: updated.abteilung,
    aktiv: updated.aktiv,
    bemerkung: updated.bemerkung,
    eintrittsdatum: updated.eintrittsdatum?.toISOString(),
  };
}

/**
 * Löscht einen Mitarbeiter (nur Admin).
 */
export async function deleteMitarbeiter(id: string, currentUser: LoginResource): Promise<void> {
  if (!currentUser.role.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }

  const deleted = await Mitarbeiter.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error("Mitarbeiter nicht gefunden");
  }
}
