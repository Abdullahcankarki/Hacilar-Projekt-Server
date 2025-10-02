import PDFDocument from "pdfkit";
import { Kunde } from "../model/KundeModel";
import { Auftrag } from "../model/AuftragModel";
import { BelegResource, BelegTyp, EmailLogResource } from "../Resources";

/**
 * Generiert einen PDF-Beleg (on-the-fly).
 * Für Lieferschein und Rechnung werden die Daten komplett aus dem Auftrag genommen.
 * Für Gutschrift und Preisdifferenz müssen zusätzliche Daten übergeben werden.
 */
export async function generateBelegPdf(
  auftragId: string,
  belegTyp: BelegTyp,
  inputData?: Partial<BelegResource>
): Promise<Buffer> {
  const auftrag = await Auftrag.findById(auftragId);
  if (!auftrag) throw new Error("Auftrag nicht gefunden");

  const kunde = await Kunde.findById(auftrag.kunde);
  if (!kunde) throw new Error("Kunde nicht gefunden");

  const doc = new PDFDocument({ margin: 50 });
  const buffers: Buffer[] = [];
  doc.on("data", buffers.push.bind(buffers));
  doc.on("end", () => {});

  // Header
  doc.fontSize(20).text("Firma XYZ", { align: "left" });
  doc.fontSize(12).text(`Beleg: ${belegTyp.toUpperCase()}`, { align: "right" });
  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown();

  // Kundendaten & Auftragsdaten in zwei Spalten
  doc.fontSize(12).text(`Kunde:\n${kunde.name}\n${kunde.email || ""}`, 50, doc.y, { width: 250 });
  doc.text(`Auftrag:\nNr: ${auftrag.auftragsnummer}\nDatum: ${new Date().toLocaleDateString()}`, 300, doc.y - 45, { width: 250 });
  doc.moveDown(3);

  // Artikelpositionen Tabelle
  if (belegTyp === "lieferschein" || belegTyp === "rechnung") {
    doc.fontSize(12).text("Artikelpositionen:", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text("Pos   Artikel                  Menge   Einheit");
    doc.moveDown(0.2);
    (auftrag.artikelPosition as any[]).forEach((pos: any, i: number) => {
      doc.text(`${i + 1}    ${pos.artikel}    ${pos.menge}    ${pos.einheit || ""}`);
    });
    doc.moveDown();
  }

  // Gutschrift/Preisdifferenz Details
  if (belegTyp === "gutschrift" || belegTyp === "preisdifferenz") {
    doc.fontSize(12).text("Details:", { underline: true });
    if (inputData?.referenzBelegNummer) doc.text(`Bezug auf Beleg: ${inputData.referenzBelegNummer}`);
    if (inputData?.betrag) doc.text(`Betrag: ${inputData.betrag} EUR`);
    doc.moveDown();
  }

  // Footer
  doc.moveTo(50, 750).lineTo(550, 750).stroke();
  doc.fontSize(8).text("Dies ist ein automatisch erstelltes Dokument.", 50, 760, { align: "center" });

  doc.end();
  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    const result = Buffer.concat(buffers);
    resolve(result);
  });
  return pdfBuffer;
}

/**
 * Fügt einen Beleg-Eintrag in einem Auftrag hinzu.
 * Lieferschein und Rechnung: Metadaten automatisch aus Auftrag.
 * Gutschrift und Preisdifferenz: Inputdaten nötig (z.B. Betrag, Referenznummer).
 */
export async function addBelegToAuftrag(
  auftragId: string,
  beleg: BelegResource
): Promise<BelegResource> {
  const auftrag = await Auftrag.findById(auftragId);
  if (!auftrag) throw new Error("Auftrag nicht gefunden");

  const belegEntry: BelegResource = {
    ...beleg,
    id: beleg.id ?? new Date().getTime().toString(),
    datum: beleg.datum ?? new Date().toISOString(),
    pdfGeneriert: beleg.pdfGeneriert ?? false,
  };

  auftrag.belegListe = auftrag.belegListe || [];
  (auftrag.belegListe as any).push(belegEntry);
  await auftrag.save();

  return belegEntry;
}

/**
 * Protokolliert den Versand einer E-Mail zu einem Beleg.
 */
export async function logEmailVersand(
  auftragId: string,
  log: Omit<EmailLogResource, "id" | "gesendetAm">
): Promise<EmailLogResource> {
  const auftrag = await Auftrag.findById(auftragId);
  if (!auftrag) throw new Error("Auftrag nicht gefunden");

  const emailLog: EmailLogResource = {
    ...log,
    id: new Date().getTime().toString(),
    gesendetAm: new Date().toISOString(),
  };

  auftrag.emailLogs = auftrag.emailLogs || [];
  (auftrag.emailLogs as any).push(emailLog);
  await auftrag.save();

  return emailLog;
}

/**
 * Liefert alle Belege eines Auftrags zurück.
 */
export async function getBelegeForAuftrag(
  auftragId: string
): Promise<BelegResource[]> {
  const auftrag = await Auftrag.findById(auftragId);
  if (!auftrag) throw new Error("Auftrag nicht gefunden");
  return (auftrag.belegListe as any) || [];
}

/**
 * Liefert alle E-Mail-Logs eines Auftrags zurück.
 */
export async function getEmailLogsForAuftrag(
  auftragId: string
): Promise<EmailLogResource[]> {
  const auftrag = await Auftrag.findById(auftragId);
  if (!auftrag) throw new Error("Auftrag nicht gefunden");
  return (auftrag.emailLogs as any) || [];
}