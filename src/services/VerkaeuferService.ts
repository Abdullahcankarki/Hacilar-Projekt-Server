import { Verkaeufer } from '../model/VerkaeuferModel'; // Pfad ggf. anpassen
import { VerkaeuferResource, LoginResource } from '../Resources'; // Pfad ggf. anpassen
import bcrypt from 'bcryptjs';
import jwt from "jsonwebtoken"

// JWT-Secret, idealerweise aus der Umgebung
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

/**
 * Erstellt einen neuen Verkäufer.
 * Nur Admins (role === "a") dürfen diese Funktion aufrufen.
 */
export async function createVerkaeufer(
  data: { name: string; password: string; admin?: boolean },
  currentUser: LoginResource
): Promise<VerkaeuferResource> {
  if (currentUser.role !== 'a') {
    throw new Error('Admin-Zugriff erforderlich');
  }
  const { name, password, admin } = data;

  // Prüfen, ob ein Verkäufer mit diesem Namen bereits existiert
  const existing = await Verkaeufer.findOne({ name });
  if (existing) {
    throw new Error('Verkäufer existiert bereits');
  }
  // Passwort hashen
  const hashedPassword = await bcrypt.hash(password, 10);
  const newVerkaeufer = new Verkaeufer({
    name,
    password: hashedPassword,
    admin: admin ?? false,
  });
  const saved = await newVerkaeufer.save();
  return {
    id: saved._id.toString(),
    name: saved.name,
    admin: saved.admin || false,
  };
}

/**
 * Ruft alle Verkäufer ab.
 * Nur Admins dürfen diese Funktion nutzen.
 */
export async function getAllVerkaeufer(
  currentUser: LoginResource
): Promise<VerkaeuferResource[]> {
  if (currentUser.role !== 'a') {
    throw new Error('Admin-Zugriff erforderlich');
  }
  const sellers = await Verkaeufer.find();
  return sellers.map(v => ({
    id: v._id.toString(),
    name: v.name,
    admin: v.admin || false,
  }));
}

/**
 * Ruft einen einzelnen Verkäufer anhand der ID ab.
 * Admins dürfen jeden Verkäufer abrufen, normale User nur ihren eigenen Account.
 */
export async function getVerkaeuferById(
  id: string,
  currentUser: LoginResource
): Promise<VerkaeuferResource> {
  if (currentUser.role !== 'a' && currentUser.id !== id) {
    throw new Error('Zugriff verweigert');
  }
  const seller = await Verkaeufer.findById(id);
  if (!seller) {
    throw new Error('Verkäufer nicht gefunden');
  }
  return {
    id: seller._id.toString(),
    name: seller.name,
    admin: seller.admin || false,
  };
}

/**
 * Aktualisiert einen Verkäufer.
 * Admins dürfen jeden Account ändern, normale User nur ihren eigenen.
 */
export async function updateVerkaeufer(
  id: string,
  data: Partial<{ name: string; password: string; admin?: boolean }>,
  currentUser: LoginResource
): Promise<VerkaeuferResource> {
  if (currentUser.role !== 'a' && currentUser.id !== id) {
    throw new Error('Zugriff verweigert');
  }
  const updateData: any = {};
  if (data.name) updateData.name = data.name;
  if (data.password) {
    updateData.password = await bcrypt.hash(data.password, 10);
  }
  // Nur Admins dürfen das admin-Feld ändern
  if (typeof data.admin === 'boolean' && currentUser.role === 'a') {
    updateData.admin = data.admin;
  }
  const updated = await Verkaeufer.findByIdAndUpdate(id, updateData, { new: true });
  if (!updated) {
    throw new Error('Verkäufer nicht gefunden');
  }
  return {
    id: updated._id.toString(),
    name: updated.name,
    admin: updated.admin || false,
  };
}

/**
 * Löscht einen Verkäufer.
 * Nur Admins dürfen Verkäufer löschen.
 */
export async function deleteVerkaeufer(
  id: string,
  currentUser: LoginResource
): Promise<void> {
  if (currentUser.role !== 'a') {
    throw new Error('Admin-Zugriff erforderlich');
  }
  const deleted = await Verkaeufer.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error('Verkäufer nicht gefunden');
  }
}

/**
 * Authentifiziert einen Verkäufer anhand von Name und Passwort.
 * Bei erfolgreicher Authentifizierung wird ein JWT-Token zurückgegeben.
 */
export async function loginVerkaeufer(
  credentials: { name: string; password: string }
): Promise<{ token: string; user: LoginResource }> {
  const { name, password } = credentials;
  if (!name || !password) {
    throw new Error('Name und Passwort sind erforderlich');
  }
  const seller = await Verkaeufer.findOne({ name });
  if (!seller) {
    throw new Error('Ungültige Anmeldedaten');
  }
  const passwordValid = await bcrypt.compare(password, seller.password);
  if (!passwordValid) {
    throw new Error('Ungültige Anmeldedaten');
  }
  const payload: LoginResource = {
    id: seller._id.toString(),
    role: seller.admin ? 'a' : 'v',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // Token gültig für 1 Tag
  };
  const token = jwt.sign(payload, JWT_SECRET);
  return { token, user: payload };
}
