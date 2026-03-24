import { OffenerPostenImport } from "../model/OffenerPostenImportModel";
import { OffenerPosten } from "../model/OffenerPostenModel";
import {
  OffenerPostenImportResource,
  OffenerPostenResource,
} from "../Resources";

// ── Helpers ──

function importToResource(doc: any): OffenerPostenImportResource {
  return {
    id: doc._id.toString(),
    datum: doc.datum.toISOString(),
    berichtsDatum: doc.berichtsDatum.toISOString(),
    dateiname: doc.dateiname,
    anzahlPosten: doc.anzahlPosten,
    gesamtBetrag: doc.gesamtBetrag,
  };
}

function postenToResource(doc: any): OffenerPostenResource {
  return {
    id: doc._id.toString(),
    importId: doc.importId.toString(),
    importDatum: doc.importDatum.toISOString(),
    berichtsDatum: doc.berichtsDatum.toISOString(),
    kontonr: doc.kontonr,
    kunde: doc.kunde,
    buchNr: doc.buchNr,
    datum: doc.datum.toISOString(),
    reNr: doc.reNr,
    betrag: doc.betrag,
    tageOffen: doc.tageOffen,
    mahndatum: doc.mahndatum ? doc.mahndatum.toISOString() : undefined,
    stufe: doc.stufe,
  };
}

// ── CRUD ──

export async function getImports(): Promise<OffenerPostenImportResource[]> {
  const docs = await OffenerPostenImport.find().sort({ datum: -1 });
  return docs.map(importToResource);
}

export async function getPostenByImport(
  importId: string
): Promise<OffenerPostenResource[]> {
  const docs = await OffenerPosten.find({ importId }).sort({
    kontonr: 1,
    datum: 1,
  });
  return docs.map(postenToResource);
}

export async function getLatestPosten(): Promise<OffenerPostenResource[]> {
  const latestImport = await OffenerPostenImport.findOne().sort({ datum: -1 });
  if (!latestImport) return [];
  return getPostenByImport(latestImport._id.toString());
}

export async function createImport(data: {
  berichtsDatum: string;
  dateiname: string;
  posten: {
    kontonr: string;
    kunde: string;
    buchNr: string;
    datum: string;
    reNr: string;
    betrag: number;
    tageOffen: number;
    mahndatum?: string;
    stufe: string;
  }[];
}): Promise<OffenerPostenImportResource> {
  const now = new Date();
  const gesamtBetrag = data.posten.reduce((sum, p) => sum + p.betrag, 0);

  const importDoc = await OffenerPostenImport.create({
    datum: now,
    berichtsDatum: new Date(data.berichtsDatum),
    dateiname: data.dateiname,
    anzahlPosten: data.posten.length,
    gesamtBetrag,
  });

  if (data.posten.length > 0) {
    const postenDocs = data.posten.map((p) => ({
      importId: importDoc._id,
      importDatum: now,
      berichtsDatum: new Date(data.berichtsDatum),
      kontonr: p.kontonr,
      kunde: p.kunde,
      buchNr: p.buchNr,
      datum: new Date(p.datum),
      reNr: p.reNr,
      betrag: p.betrag,
      tageOffen: p.tageOffen,
      mahndatum: p.mahndatum ? new Date(p.mahndatum) : undefined,
      stufe: p.stufe,
    }));
    await OffenerPosten.insertMany(postenDocs);
  }

  return importToResource(importDoc);
}

export async function deleteImport(importId: string): Promise<void> {
  await OffenerPosten.deleteMany({ importId });
  const doc = await OffenerPostenImport.findByIdAndDelete(importId);
  if (!doc) throw new Error("Import nicht gefunden");
}
