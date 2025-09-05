import { Mitarbeiter } from '../model/MitarbeiterModel'; // Pfad ggf. anpassen
import { MitarbeiterResource, LoginResource, MitarbeiterRolle } from '../Resources'; // Pfad ggf. anpassen
import bcrypt from 'bcryptjs';
import jwt from "jsonwebtoken"

// Ersetzt deine aktuelle JWT_SECRET-Deklaration
const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET environment variable is not set");
  return s;
})();

// Allowed Rollen guard (keep in sync with your Resources)
const ALLOWED_ROLES: MitarbeiterRolle[] = [
  "admin",
  "verkauf",
  "kommissionierung",
  "kontrolle",
  "buchhaltung",
  "wareneingang",
  "lager",
  "fahrer",
  "zerleger",
  "statistik",
  "kunde",
  "support",
];

const JWT_EXPIRES_SECONDS = Number(process.env.JWT_EXPIRES_SECONDS || 60 * 60 * 10);

function norm(s?: string) {
  return (s || "").trim();
}
/**
 * Setzt das Passwort eines Mitarbeiters anhand des (normalisierten) Namens neu.
 * Wird vom Passwort-Reset (Option B) verwendet.
 */
export async function updateMitarbeiterPasswordByName(nameRaw: string, newPassword: string): Promise<void> {
  const name = normLower(nameRaw);
  if (!name) throw new Error("Name ist erforderlich");
  if (!newPassword || newPassword.length < 6) throw new Error("Passwort muss mind. 6 Zeichen lang sein");

  const mitarbeiter = await Mitarbeiter.findOne({ name });
  if (!mitarbeiter) {
    // absichtlich generische Meldung, um Enumeration zu vermeiden
    throw new Error("Mitarbeiter nicht gefunden");
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  (mitarbeiter as any).password = hashed;
  await mitarbeiter.save();
}
function normLower(s?: string) {
  return (s || "").trim().toLowerCase();
}
function sanitizeRollen(rollen?: string[] | MitarbeiterRolle[]): MitarbeiterRolle[] {
  const list = Array.isArray(rollen) ? rollen : [];
  const set = new Set(
    list
      .map((r) => String(r).trim().toLowerCase())
      .filter((r) => ALLOWED_ROLES.includes(r as MitarbeiterRolle))
  );
  return Array.from(set) as MitarbeiterRolle[];
}

function mapMitarbeiter(m: any): MitarbeiterResource {
  return {
    id: m._id.toString(),
    name: m.name,
    rollen: (m.rollen || []) as MitarbeiterRolle[],
    email: m.email ?? undefined,
    telefon: m.telefon ?? undefined,
    abteilung: m.abteilung ?? undefined,
    aktiv: m.aktiv ?? true,
    bemerkung: m.bemerkung ?? undefined,
    eintrittsdatum: m.eintrittsdatum ? new Date(m.eintrittsdatum).toISOString() : undefined,
  };
}

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

  const name = normLower(data.name);
  if (!name) throw new Error("Name ist erforderlich");
  if (!data.password) throw new Error("Passwort ist erforderlich");

  // Uniqueness checks (name & optional email)
  const dupeByName = await Mitarbeiter.findOne({ name });
  if (dupeByName) throw new Error("Mitarbeiter-Name bereits vergeben");

  const email = data.email ? normLower(data.email) : undefined;
  if (email) {
    const dupeByEmail = await Mitarbeiter.findOne({ email });
    if (dupeByEmail) throw new Error("E-Mail bereits vergeben");
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);
  const rollen = sanitizeRollen(data.rollen);
  if (rollen.length === 0) rollen.push("lager"); // Default-Rolle, falls nichts gesetzt

  const neuerMitarbeiter = new Mitarbeiter({
    name,
    password: hashedPassword,
    rollen,
    email,
    telefon: norm(data.telefon),
    abteilung: norm(data.abteilung),
    aktiv: data.aktiv ?? true,
    bemerkung: norm(data.bemerkung),
    eintrittsdatum: data.eintrittsdatum ? new Date(data.eintrittsdatum) : undefined,
  });

  const saved = await neuerMitarbeiter.save();
  return mapMitarbeiter(saved);
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
  const user = await Mitarbeiter.findOne({ name: name.toLowerCase() });
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
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_SECONDS,
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
  const mitarbeiter = await Mitarbeiter.find().sort({ name: 1 });
  return mitarbeiter.map(mapMitarbeiter);
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

  return mapMitarbeiter(m);
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
  const isAdmin = currentUser.role.includes("admin");
  if (!isAdmin && currentUser.id !== id) {
    throw new Error("Zugriff verweigert");
  }

  const updateData: any = {};

  if (data.name !== undefined) {
    const newName = normLower(data.name);
    if (!newName) throw new Error("Name darf nicht leer sein");
    const dupe = await Mitarbeiter.findOne({ _id: { $ne: id }, name: newName });
    if (dupe) throw new Error("Mitarbeiter-Name bereits vergeben");
    updateData.name = newName;
  }

  if (data.email !== undefined) {
    const newEmail = normLower(data.email);
    if (newEmail) {
      const dupeE = await Mitarbeiter.findOne({ _id: { $ne: id }, email: newEmail });
      if (dupeE) throw new Error("E-Mail bereits vergeben");
      updateData.email = newEmail;
    } else {
      updateData.email = undefined;
    }
  }

  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }

  if (isAdmin && data.rollen !== undefined) {
    updateData.rollen = sanitizeRollen(data.rollen);
  }
  if (isAdmin && data.aktiv !== undefined) {
    updateData.aktiv = !!data.aktiv;
  }

  if (data.telefon !== undefined) updateData.telefon = norm(data.telefon);
  if (data.abteilung !== undefined) updateData.abteilung = norm(data.abteilung);
  if (data.bemerkung !== undefined) updateData.bemerkung = norm(data.bemerkung);
  if (data.eintrittsdatum !== undefined) updateData.eintrittsdatum = data.eintrittsdatum ? new Date(data.eintrittsdatum) : undefined;

  const updated = await Mitarbeiter.findByIdAndUpdate(id, updateData, { new: true });
  if (!updated) throw new Error("Mitarbeiter nicht gefunden");

  return mapMitarbeiter(updated);
}

/**
 * Löscht einen Mitarbeiter (nur Admin).
 */
export async function deleteMitarbeiter(id: string, currentUser: LoginResource): Promise<void> {
  if (!currentUser.role.includes("admin")) {
    throw new Error("Admin-Zugriff erforderlich");
  }
  if (currentUser.id === id) {
    throw new Error("Eigenen Account nicht löschen");
  }
  const deleted = await Mitarbeiter.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error("Mitarbeiter nicht gefunden");
  }
}
