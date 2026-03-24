import { PuteEintrag } from "../model/PuteEintragModel";
import { PuteConfig } from "../model/PuteConfigModel";
import { LoginResource, PuteEintragResource, PuteConfigResource } from "../Resources";

function requireGefluegel(user: LoginResource) {
  if (!user.role.includes("gefluegel")) {
    throw new Error("Zugriff nur mit Rolle 'Zerlegung Geflügel'.");
  }
}

// ── Einträge ──

function eintragToResource(doc: any): PuteEintragResource {
  return {
    id: doc._id.toString(),
    datum: doc.datum.toISOString().split("T")[0],
    kategorie: doc.kategorie,
    zerlegerId: doc.zerlegerId.toString(),
    zerlegerName: doc.zerlegerName,
    mitKnochen: doc.mitKnochen,
    ohneKnochen: doc.ohneKnochen,
  };
}

export async function getPuteEintraegeByDatum(
  datum: string,
  kategorie: string,
  user: LoginResource
) {
  requireGefluegel(user);
  const start = new Date(datum + "T00:00:00.000Z");
  const end = new Date(datum + "T23:59:59.999Z");
  const filter: any = { datum: { $gte: start, $lte: end } };
  if (kategorie) filter.kategorie = kategorie;
  const docs = await PuteEintrag.find(filter).sort({ zerlegerName: 1 });
  return docs.map(eintragToResource);
}

export async function getPuteEintraegeByRange(
  von: string,
  bis: string,
  kategorie: string,
  user: LoginResource
) {
  requireGefluegel(user);
  const start = new Date(von + "T00:00:00.000Z");
  const end = new Date(bis + "T23:59:59.999Z");
  const filter: any = { datum: { $gte: start, $lte: end } };
  if (kategorie) filter.kategorie = kategorie;
  const docs = await PuteEintrag.find(filter).sort({ datum: 1, zerlegerName: 1 });
  return docs.map(eintragToResource);
}

export async function upsertPuteEintrag(
  data: Omit<PuteEintragResource, "id">,
  user: LoginResource
) {
  requireGefluegel(user);
  const datumDate = new Date(data.datum + "T00:00:00.000Z");

  const doc = await PuteEintrag.findOneAndUpdate(
    {
      datum: datumDate,
      kategorie: data.kategorie,
      zerlegerId: data.zerlegerId,
    },
    {
      datum: datumDate,
      kategorie: data.kategorie,
      zerlegerId: data.zerlegerId,
      zerlegerName: data.zerlegerName,
      mitKnochen: data.mitKnochen,
      ohneKnochen: data.ohneKnochen,
    },
    { upsert: true, new: true }
  );
  return eintragToResource(doc);
}

export async function deletePuteEintrag(id: string, user: LoginResource) {
  requireGefluegel(user);
  const result = await PuteEintrag.findByIdAndDelete(id);
  if (!result) throw new Error("Eintrag nicht gefunden");
  return { message: "Eintrag gelöscht" };
}

// ── Config ──

function configToResource(doc: any): PuteConfigResource {
  return {
    id: doc._id.toString(),
    kategorie: doc.kategorie,
    sollProzent: doc.sollProzent,
  };
}

export async function getAllPuteConfigs(user: LoginResource) {
  requireGefluegel(user);
  const docs = await PuteConfig.find();
  return docs.map(configToResource);
}

export async function upsertPuteConfig(
  data: Omit<PuteConfigResource, "id">,
  user: LoginResource
) {
  requireGefluegel(user);
  const doc = await PuteConfig.findOneAndUpdate(
    { kategorie: data.kategorie },
    { kategorie: data.kategorie, sollProzent: data.sollProzent },
    { upsert: true, new: true }
  );
  return configToResource(doc);
}
