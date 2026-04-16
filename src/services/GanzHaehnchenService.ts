import { GanzHaehnchenEintrag } from "../model/GanzHaehnchenEintragModel";
import { GanzHaehnchenConfig } from "../model/GanzHaehnchenConfigModel";
import {
  LoginResource,
  GanzHaehnchenEintragResource,
  GanzHaehnchenConfigResource,
} from "../Resources";

function requireGefluegel(user: LoginResource) {
  if (!user.role.includes("gefluegel")) {
    throw new Error("Zugriff nur mit Rolle 'Zerlegung Geflügel'.");
  }
}

function eintragToResource(doc: any): GanzHaehnchenEintragResource {
  return {
    id: doc._id.toString(),
    datum: doc.datum.toISOString().split("T")[0],
    zerlegerId: doc.zerlegerId.toString(),
    zerlegerName: doc.zerlegerName,
    anzahlKisten: doc.anzahlKisten,
    gewichtGesamt: doc.gewichtGesamt,
    brust: doc.brust,
    keule: doc.keule,
    fluegel: doc.fluegel,
    kosten: doc.kosten,
  };
}

export async function getGanzHaehnchenEintraegeByDatum(datum: string, user: LoginResource) {
  requireGefluegel(user);
  const start = new Date(datum + "T00:00:00.000Z");
  const end = new Date(datum + "T23:59:59.999Z");
  const docs = await GanzHaehnchenEintrag.find({ datum: { $gte: start, $lte: end } }).sort({
    zerlegerName: 1,
  });
  return docs.map(eintragToResource);
}

export async function getGanzHaehnchenEintraegeByRange(
  von: string,
  bis: string,
  user: LoginResource
) {
  requireGefluegel(user);
  const start = new Date(von + "T00:00:00.000Z");
  const end = new Date(bis + "T23:59:59.999Z");
  const docs = await GanzHaehnchenEintrag.find({ datum: { $gte: start, $lte: end } }).sort({
    datum: 1,
    zerlegerName: 1,
  });
  return docs.map(eintragToResource);
}

export async function upsertGanzHaehnchenEintrag(
  data: Omit<GanzHaehnchenEintragResource, "id">,
  user: LoginResource
) {
  requireGefluegel(user);
  const datumDate = new Date(data.datum + "T00:00:00.000Z");

  const doc = await GanzHaehnchenEintrag.findOneAndUpdate(
    { datum: datumDate, zerlegerId: data.zerlegerId },
    {
      datum: datumDate,
      zerlegerId: data.zerlegerId,
      zerlegerName: data.zerlegerName,
      anzahlKisten: data.anzahlKisten,
      gewichtGesamt: data.gewichtGesamt,
      brust: data.brust,
      keule: data.keule,
      fluegel: data.fluegel,
      kosten: data.kosten,
    },
    { upsert: true, new: true }
  );
  return eintragToResource(doc);
}

export async function deleteGanzHaehnchenEintrag(id: string, user: LoginResource) {
  requireGefluegel(user);
  const result = await GanzHaehnchenEintrag.findByIdAndDelete(id);
  if (!result) throw new Error("Eintrag nicht gefunden");
  return { message: "Eintrag gelöscht" };
}

// ── Config (Singleton) ──

export async function getGanzHaehnchenConfig(user: LoginResource): Promise<GanzHaehnchenConfigResource> {
  requireGefluegel(user);
  let doc = await GanzHaehnchenConfig.findOne({ key: "singleton" });
  if (!doc) {
    doc = await GanzHaehnchenConfig.create({ key: "singleton" });
  }
  return {
    sollBrust: doc.sollBrust,
    sollKeule: doc.sollKeule,
    sollFluegel: doc.sollFluegel,
  };
}

export async function updateGanzHaehnchenConfig(
  data: GanzHaehnchenConfigResource,
  user: LoginResource
): Promise<GanzHaehnchenConfigResource> {
  requireGefluegel(user);
  const doc = await GanzHaehnchenConfig.findOneAndUpdate(
    { key: "singleton" },
    {
      key: "singleton",
      sollBrust: data.sollBrust,
      sollKeule: data.sollKeule,
      sollFluegel: data.sollFluegel,
    },
    { upsert: true, new: true }
  );
  return {
    sollBrust: doc.sollBrust,
    sollKeule: doc.sollKeule,
    sollFluegel: doc.sollFluegel,
  };
}
