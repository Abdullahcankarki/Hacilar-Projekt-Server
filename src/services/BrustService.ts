import { BrustEintrag } from "../model/BrustEintragModel";
import { BrustConfig } from "../model/BrustConfigModel";
import {
  LoginResource,
  BrustEintragResource,
  BrustConfigResource,
} from "../Resources";

function requireGefluegel(user: LoginResource) {
  if (!user.role.includes("gefluegel")) {
    throw new Error("Zugriff nur mit Rolle 'Zerlegung Geflügel'.");
  }
}

function eintragToResource(doc: any): BrustEintragResource {
  return {
    id: doc._id.toString(),
    datum: doc.datum.toISOString().split("T")[0],
    zerlegerId: doc.zerlegerId.toString(),
    zerlegerName: doc.zerlegerName,
    anzahlKisten: doc.anzahlKisten,
    gewichtMitKnochen: doc.gewichtMitKnochen,
    brustMitHaut: doc.brustMitHaut,
    brustOhneHaut: doc.brustOhneHaut,
    haut: doc.haut,
    kosten: doc.kosten,
  };
}

export async function getBrustEintraegeByDatum(datum: string, user: LoginResource) {
  requireGefluegel(user);
  const start = new Date(datum + "T00:00:00.000Z");
  const end = new Date(datum + "T23:59:59.999Z");
  const docs = await BrustEintrag.find({ datum: { $gte: start, $lte: end } }).sort({
    zerlegerName: 1,
  });
  return docs.map(eintragToResource);
}

export async function getBrustEintraegeByRange(
  von: string,
  bis: string,
  user: LoginResource
) {
  requireGefluegel(user);
  const start = new Date(von + "T00:00:00.000Z");
  const end = new Date(bis + "T23:59:59.999Z");
  const docs = await BrustEintrag.find({ datum: { $gte: start, $lte: end } }).sort({
    datum: 1,
    zerlegerName: 1,
  });
  return docs.map(eintragToResource);
}

export async function upsertBrustEintrag(
  data: Omit<BrustEintragResource, "id">,
  user: LoginResource
) {
  requireGefluegel(user);
  const datumDate = new Date(data.datum + "T00:00:00.000Z");

  const doc = await BrustEintrag.findOneAndUpdate(
    { datum: datumDate, zerlegerId: data.zerlegerId },
    {
      datum: datumDate,
      zerlegerId: data.zerlegerId,
      zerlegerName: data.zerlegerName,
      anzahlKisten: data.anzahlKisten,
      gewichtMitKnochen: data.gewichtMitKnochen,
      brustMitHaut: data.brustMitHaut,
      brustOhneHaut: data.brustOhneHaut,
      haut: data.haut,
      kosten: data.kosten,
    },
    { upsert: true, new: true }
  );
  return eintragToResource(doc);
}

export async function deleteBrustEintrag(id: string, user: LoginResource) {
  requireGefluegel(user);
  const result = await BrustEintrag.findByIdAndDelete(id);
  if (!result) throw new Error("Eintrag nicht gefunden");
  return { message: "Eintrag gelöscht" };
}

// ── Config (Singleton) ──

export async function getBrustConfig(user: LoginResource): Promise<BrustConfigResource> {
  requireGefluegel(user);
  let doc = await BrustConfig.findOne({ key: "singleton" });
  if (!doc) {
    doc = await BrustConfig.create({ key: "singleton" });
  }
  return {
    sollMitHaut: doc.sollMitHaut,
    sollOhneHaut: doc.sollOhneHaut,
    sollHaut: doc.sollHaut,
  };
}

export async function updateBrustConfig(
  data: BrustConfigResource,
  user: LoginResource
): Promise<BrustConfigResource> {
  requireGefluegel(user);
  const doc = await BrustConfig.findOneAndUpdate(
    { key: "singleton" },
    {
      key: "singleton",
      sollMitHaut: data.sollMitHaut,
      sollOhneHaut: data.sollOhneHaut,
      sollHaut: data.sollHaut,
    },
    { upsert: true, new: true }
  );
  return {
    sollMitHaut: doc.sollMitHaut,
    sollOhneHaut: doc.sollOhneHaut,
    sollHaut: doc.sollHaut,
  };
}
