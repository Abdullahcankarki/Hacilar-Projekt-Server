import { LeergutImport } from "../model/LeergutImportModel";
import { LeergutEintrag } from "../model/LeergutEintragModel";
import {
  LeergutImportResource,
  LeergutEintragResource,
} from "../Resources";

// ── Helpers ──

function importToResource(doc: any): LeergutImportResource {
  return {
    id: doc._id.toString(),
    datum: doc.datum.toISOString(),
    anzahlDateien: doc.anzahlDateien,
    anzahlKunden: doc.anzahlKunden,
  };
}

function eintragToResource(doc: any): LeergutEintragResource {
  return {
    id: doc._id.toString(),
    importId: doc.importId.toString(),
    importDatum: doc.importDatum.toISOString(),
    kundennr: doc.kundennr,
    kunde: doc.kunde,
    artikel: doc.artikel,
    alterBestand: doc.alterBestand,
  };
}

// ── CRUD ──

export async function getImports(): Promise<LeergutImportResource[]> {
  const docs = await LeergutImport.find().sort({ datum: -1 });
  return docs.map(importToResource);
}

export async function getEintraegeByImport(
  importId: string
): Promise<LeergutEintragResource[]> {
  const docs = await LeergutEintrag.find({ importId }).sort({
    kundennr: 1,
    artikel: 1,
  });
  return docs.map(eintragToResource);
}

export async function getLatestEintraege(): Promise<LeergutEintragResource[]> {
  const latestImport = await LeergutImport.findOne().sort({ datum: -1 });
  if (!latestImport) return [];
  return getEintraegeByImport(latestImport._id.toString());
}

export async function createImport(data: {
  anzahlDateien: number;
  eintraege: {
    kundennr: string;
    kunde: string;
    artikel: string;
    alterBestand: number;
  }[];
}): Promise<LeergutImportResource> {
  const now = new Date();

  // Anzahl unique Kunden
  const uniqueKunden = new Set(data.eintraege.map((e) => e.kundennr));

  const importDoc = await LeergutImport.create({
    datum: now,
    anzahlDateien: data.anzahlDateien,
    anzahlKunden: uniqueKunden.size,
  });

  if (data.eintraege.length > 0) {
    const eintragDocs = data.eintraege.map((e) => ({
      importId: importDoc._id,
      importDatum: now,
      kundennr: e.kundennr,
      kunde: e.kunde,
      artikel: e.artikel,
      alterBestand: e.alterBestand,
    }));
    await LeergutEintrag.insertMany(eintragDocs);
  }

  return importToResource(importDoc);
}

export async function deleteImport(importId: string): Promise<void> {
  await LeergutEintrag.deleteMany({ importId });
  const doc = await LeergutImport.findByIdAndDelete(importId);
  if (!doc) throw new Error("Import nicht gefunden");
}

export async function deleteKundeEintraege(kundennr: string): Promise<{ deleted: number }> {
  const result = await LeergutEintrag.deleteMany({ kundennr });
  return { deleted: result.deletedCount };
}
