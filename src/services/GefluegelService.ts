import { GefluegelLieferant } from "../model/GefluegelLieferantModel";
import { GefluegelZerleger } from "../model/GefluegelZerlegerModel";
import { GefluegelEintrag } from "../model/GefluegelEintragModel";
import { GefluegelTagesConfig } from "../model/GefluegelTagesConfigModel";
import {
  LoginResource,
  GefluegelLieferantResource,
  GefluegelZerlegerResource,
  GefluegelEintragResource,
} from "../Resources";

function requireGefluegel(user: LoginResource) {
  if (!user.role.includes("gefluegel")) {
    throw new Error("Zugriff nur mit Rolle 'Zerlegung Geflügel'.");
  }
}

// ── Lieferanten ──

function lieferantToResource(doc: any): GefluegelLieferantResource {
  return {
    id: doc._id.toString(),
    name: doc.name,
    sollProzent: doc.sollProzent,
    ekProKg: doc.ekProKg,
    zerlegungskostenProKiste: doc.zerlegungskostenProKiste,
    kistenGewichtKg: doc.kistenGewichtKg,
    aktiv: doc.aktiv,
    reihenfolge: doc.reihenfolge,
  };
}

export async function getAllLieferanten() {
  return (await GefluegelLieferant.find().sort({ reihenfolge: 1, name: 1 })).map(
    lieferantToResource
  );
}

export async function createLieferant(
  data: Omit<GefluegelLieferantResource, "id">,
  user: LoginResource
) {
  requireGefluegel(user);
  const doc = await GefluegelLieferant.create(data);
  return lieferantToResource(doc);
}

export async function updateLieferant(
  id: string,
  data: Partial<GefluegelLieferantResource>,
  user: LoginResource
) {
  requireGefluegel(user);
  const doc = await GefluegelLieferant.findByIdAndUpdate(id, data, { new: true });
  if (!doc) throw new Error("Lieferant nicht gefunden");
  return lieferantToResource(doc);
}

export async function deleteLieferant(id: string, user: LoginResource) {
  requireGefluegel(user);
  const result = await GefluegelLieferant.findByIdAndDelete(id);
  if (!result) throw new Error("Lieferant nicht gefunden");
  return { message: "Lieferant gelöscht" };
}

// ── Zerleger ──

function zerlegerToResource(doc: any): GefluegelZerlegerResource {
  return {
    id: doc._id.toString(),
    name: doc.name,
    kategorien: doc.kategorien ?? ["haehnchen"],
    aktiv: doc.aktiv,
    reihenfolge: doc.reihenfolge ?? 0,
  };
}

export async function getAllZerleger() {
  return (await GefluegelZerleger.find().sort({ reihenfolge: 1, name: 1 })).map(zerlegerToResource);
}

export async function createZerleger(
  data: Omit<GefluegelZerlegerResource, "id">,
  user: LoginResource
) {
  requireGefluegel(user);
  const doc = await GefluegelZerleger.create(data);
  return zerlegerToResource(doc);
}

export async function updateZerleger(
  id: string,
  data: Partial<GefluegelZerlegerResource>,
  user: LoginResource
) {
  requireGefluegel(user);
  const doc = await GefluegelZerleger.findByIdAndUpdate(id, data, { new: true });
  if (!doc) throw new Error("Zerleger nicht gefunden");
  return zerlegerToResource(doc);
}

export async function deleteZerleger(id: string, user: LoginResource) {
  requireGefluegel(user);
  const result = await GefluegelZerleger.findByIdAndDelete(id);
  if (!result) throw new Error("Zerleger nicht gefunden");
  return { message: "Zerleger gelöscht" };
}

// ── Einträge ──

function eintragToResource(doc: any): GefluegelEintragResource {
  return {
    id: doc._id.toString(),
    datum: doc.datum.toISOString().split("T")[0],
    zerlegerId: doc.zerlegerId.toString(),
    zerlegerName: doc.zerlegerName,
    lieferantId: doc.lieferantId.toString(),
    lieferantName: doc.lieferantName,
    kisten: doc.kisten,
    kg: doc.kg,
  };
}

export async function getEintraegeByDatum(datum: string, user: LoginResource) {
  requireGefluegel(user);
  const start = new Date(datum + "T00:00:00.000Z");
  const end = new Date(datum + "T23:59:59.999Z");
  const docs = await GefluegelEintrag.find({
    datum: { $gte: start, $lte: end },
  }).sort({ zerlegerName: 1 });
  return docs.map(eintragToResource);
}

export async function getEintraegeByRange(von: string, bis: string, user: LoginResource) {
  requireGefluegel(user);
  const start = new Date(von + "T00:00:00.000Z");
  const end = new Date(bis + "T23:59:59.999Z");
  const docs = await GefluegelEintrag.find({
    datum: { $gte: start, $lte: end },
  }).sort({ datum: 1, zerlegerName: 1 });
  return docs.map(eintragToResource);
}

export async function upsertEintrag(
  data: Omit<GefluegelEintragResource, "id">,
  user: LoginResource
) {
  requireGefluegel(user);
  const datumDate = new Date(data.datum + "T00:00:00.000Z");

  const doc = await GefluegelEintrag.findOneAndUpdate(
    {
      datum: datumDate,
      zerlegerId: data.zerlegerId,
      lieferantId: data.lieferantId,
    },
    {
      datum: datumDate,
      zerlegerId: data.zerlegerId,
      zerlegerName: data.zerlegerName,
      lieferantId: data.lieferantId,
      lieferantName: data.lieferantName,
      kisten: data.kisten,
      kg: data.kg,
    },
    { upsert: true, new: true }
  );
  return eintragToResource(doc);
}

export async function updateEintrag(
  id: string,
  data: Partial<GefluegelEintragResource>,
  user: LoginResource
) {
  requireGefluegel(user);
  const update: any = {};
  if (data.kisten !== undefined) update.kisten = data.kisten;
  if (data.kg !== undefined) update.kg = data.kg;

  const doc = await GefluegelEintrag.findByIdAndUpdate(id, update, { new: true });
  if (!doc) throw new Error("Eintrag nicht gefunden");
  return eintragToResource(doc);
}

export async function deleteEintrag(id: string, user: LoginResource) {
  requireGefluegel(user);
  const result = await GefluegelEintrag.findByIdAndDelete(id);
  if (!result) throw new Error("Eintrag nicht gefunden");
  return { message: "Eintrag gelöscht" };
}

// ── TagesConfig ──

export async function getTagesConfig(datum: string, user: LoginResource) {
  requireGefluegel(user);
  const datumDate = new Date(datum + "T00:00:00.000Z");
  const doc = await GefluegelTagesConfig.findOne({ datum: datumDate });
  return { datum, hiddenLieferanten: doc?.hiddenLieferanten ?? [] };
}

export async function upsertTagesConfig(
  datum: string,
  hiddenLieferanten: string[],
  user: LoginResource
) {
  requireGefluegel(user);
  const datumDate = new Date(datum + "T00:00:00.000Z");
  const doc = await GefluegelTagesConfig.findOneAndUpdate(
    { datum: datumDate },
    { datum: datumDate, hiddenLieferanten },
    { upsert: true, new: true }
  );
  return { datum, hiddenLieferanten: doc.hiddenLieferanten };
}
