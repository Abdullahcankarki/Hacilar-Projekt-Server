import PDFDocument = require("pdfkit");
import { Types } from "mongoose";
import { Kunde } from "../model/KundeModel";
import { Auftrag } from "../model/AuftragModel";
import { ArtikelPositionResource, BelegResource, BelegTyp, EmailLogResource } from "../Resources";
import { ArtikelPosition } from "../model/ArtikelPositionModel";
import fs from "fs";
import path from "path";
import { getArtikelPositionById } from "./ArtikelPositionService";

const DEBUG_BELEG = process.env.DEBUG_BELEG === '1';
function dlog(...args: any[]) {
  if (DEBUG_BELEG) {
    // eslint-disable-next-line no-console
    console.log('[BelegService]', ...args);
  }
}

type PDFKitDocument = InstanceType<typeof PDFDocument>;

// ===== Helpers =====
function euro(n?: number): string {
  if (typeof n !== "number" || isNaN(n)) return "";
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmt2(n?: number): string {
  if (typeof n !== "number" || isNaN(n)) return "";
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function num(n?: any): number | undefined {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return typeof v === "number" && !isNaN(v) ? v : undefined;
}

// Normalizes mixed ID values (string | ObjectId-like | Buffer | { id/_id }) to a string
function toIdString(v: any): string | undefined {
  if (!v) return undefined;
  // Plain string ID
  if (typeof v === 'string') return v;
  // Mongoose ObjectId instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((v as any) instanceof Types.ObjectId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (v as any).toHexString();
  }
  // BSON ObjectId (from mongodb) with toHexString
  if (typeof v === 'object' && typeof (v as any).toHexString === 'function') {
    return (v as any).toHexString();
  }
  // Buffer (full value or nested _id buffer)
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) {
    return v.toString('hex');
  }
  if (typeof v === 'object') {
    if (typeof (v as any).id === 'string') return (v as any).id;
    const _id = (v as any)._id;
    if (typeof _id === 'string') return _id;
    if (_id && typeof ( _id as any ).toHexString === 'function') return ( _id as any ).toHexString();
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(_id)) return _id.toString('hex');
  }
  // Last resort: try toString if it looks like an ObjectId
  try {
    const s = String(v);
    // 24 hex chars → likely ObjectId
    if (/^[a-fA-F0-9]{24}$/.test(s)) return s;
  } catch {}
  return undefined;
}

type TableRow = [string, string, string, string, string, string];

function drawHeader(doc: PDFKitDocument, opts: { title: string; logoPath?: string }) {
  const { title, logoPath } = opts;

  // Header base Y position
  const topY = 40;

  // Draw logo (top left)
  const logoFile = logoPath && fs.existsSync(logoPath)
    ? logoPath
    : path.join(__dirname, "../../assets/logo.png");

  try {
    if (fs.existsSync(logoFile)) {
      doc.image(logoFile, 50, topY, { width: 80 });
    }
  } catch {
    // ignore if logo not found
  }

  // Company info next to logo
  const companyName = "Hacilar Helal Et Kombinasi";
  const companySub = "Türkische Fleischgrosshandels GmbH";
  const companyAddr = "Beusselstraße 44 · 10553 Berlin";

  doc.font("Helvetica-Bold").fontSize(14).text(companyName, 150, topY + 5);
  doc.font("Helvetica").fontSize(9).text(companySub, 150, topY + 22);
  doc.fontSize(9).text(companyAddr, 150, topY + 36);

  // Title (right-aligned)
  doc.font("Helvetica-Bold").fontSize(16).text(title.toUpperCase(), 400, topY + 10, { width: 150, align: "right" });

  // Bottom border line under header
  doc.moveTo(40, topY + 55).lineTo(570, topY + 55).strokeColor("#000").lineWidth(1).stroke();
}

// Helper to draw the customer's name and address below the header
function drawRechnungskopf(doc: PDFKitDocument, kunde: any, auftrag?: any) {
  // 1 cm ≈ 28.3465pt → 6cm ≈ 170pt, 3cm ≈ 85pt
  const startY = 170; // 6 cm from top
  const startX = 85;  // 3 cm from left

  // Label über dem Rechnungskopf (ohne Layout-Verschiebung)
  doc.font("Helvetica-Bold").fontSize(9).text("Firma", startX, startY - 14);

  // Rechnungsnummer (ohne Label) wird jetzt nur noch im rechten Block angezeigt
  const rechnungsnummer = auftrag?.rechnungsNummer || auftrag?.auftragsnummer || "—";
  // Linker Block startet direkt bei startY
  const leftBlockTop = startY;

  // Customer info block (left)
  const kundeName = kunde?.name || "Kunde";
  // Normalisiere Adresse: akzeptiert String ODER Objekt
  let kundeAdresseStr = "";
  const adr = (kunde as any)?.adresse;
  if (typeof adr === "string") {
    kundeAdresseStr = adr;
  } else if (adr && typeof adr === "object") {
    const parts: string[] = [];
    const strasse = [adr.strasse || adr.street, adr.hausnummer || adr.nr].filter(Boolean).join(" ");
    const plzOrt = [adr.plz || adr.postleitzahl, adr.ort || adr.stadt || adr.city].filter(Boolean).join(" ");
    if (strasse) parts.push(strasse);
    if (plzOrt) parts.push(plzOrt);
    if (!strasse && !plzOrt) {
      // fallback: join alle String-Felder
      Object.keys(adr).forEach(k => {
        const v = adr[k];
        if (typeof v === "string" && v.trim()) parts.push(v.trim());
      });
    }
    kundeAdresseStr = parts.join(", ");
  }
  // Nach jedem Komma Zeilenumbruch
  if (kundeAdresseStr) {
    kundeAdresseStr = kundeAdresseStr.replace(/,\s*/g, "\n");
  }

  doc.font("Helvetica-Bold").fontSize(11).text(kundeName, startX, leftBlockTop);
  doc.font("Helvetica").fontSize(10).text(kundeAdresseStr, startX, leftBlockTop + 14);

  // Rechnungsinformationen block (right)
  const infoX = startX + 290;
  const infoY = startY;
  const lineH = 13;
  const rnOffset = lineH + 6; // Abstand oberhalb der Auftragsnummer/Kundenname-Zeile
  const CM = 28.3464567; // 1 cm in pt
  const labelXShift = infoX - CM; // labels 1cm nach links

  const auftragsnummer = auftrag?.auftragsnummer || "—";
  const lieferdatum = auftrag?.lieferdatum
    ? new Date(auftrag.lieferdatum).toLocaleDateString("de-DE")
    : "—";
  const rechnungsdatum = lieferdatum; // Hinweis: Rechnungsdatum entspricht immer dem Lieferdatum

  // Rechnungsnummer rechts OBEN (eine Zeile über Kunde/Auftragsnummer)
  doc.font("Helvetica-Bold").fontSize(11).text(String(rechnungsnummer), infoX, infoY - rnOffset, { width: 530 - infoX, align: 'right' });

  // Auftragsnummer exakt auf Höhe des Kundennamens (leftBlockTop)
  doc.font("Helvetica-Bold").fontSize(10).text("Auftragsnummer:", labelXShift, leftBlockTop);
  doc.font("Helvetica").text(auftragsnummer, infoX + 120, leftBlockTop);

  // Danach Liefer- und Rechnungsdatum in festen Zeilenabständen
  doc.font("Helvetica-Bold").text("Lieferdatum:", labelXShift, leftBlockTop + lineH);
  doc.font("Helvetica").text(lieferdatum, infoX + 120, leftBlockTop + lineH);

  doc.font("Helvetica-Bold").text("Rechnungsdatum:", labelXShift, leftBlockTop + lineH * 2);
  doc.font("Helvetica").text(rechnungsdatum, infoX + 120, leftBlockTop + lineH * 2);

  // Separator line below block
  // (removed per request)
}

// Helper to resolve full ArtikelPosition documents from Auftrag
async function resolveArtikelPositionen(auftrag: any): Promise<ArtikelPositionResource[]> {
  const ids: string[] = Array.isArray(auftrag.artikelPosition)
    ? (auftrag.artikelPosition as any[])
        .map((p: any) => {
          if (typeof p === 'string') return p;
          if (p && typeof p === 'object') return p.id || p._id?.toString();
          return undefined;
        })
        .filter(Boolean) as string[]
    : [];

  if (ids.length === 0) return [];

  const results: ArtikelPositionResource[] = [];
  for (const id of ids) {
    try {
      const pos = await getArtikelPositionById(id);
      results.push(pos);
    } catch (e) {
      // Überspringe fehlende Positionen, ohne die gesamte Rechnung zu blockieren
      continue;
    }
  }
  return results;
}

// Renders the Artikelpositionen-Tabelle (positions table) for Rechnung/Lieferschein
function drawPositionsTable(doc: PDFKitDocument, positionen: ArtikelPositionResource[], mwstSatz?: number, kunde?: any, auftrag?: any) {
  // === Page region (cm → pt) ===
  const CM = 28.3464567; // 1 cm ≈ 28.3465 pt
  const areaTop = 8.5 * CM;     // 8.5 cm from top
  const areaLeft = 2.1 * CM;    // 2.1 cm from left
  const areaRight = 1.2 * CM;   // 1.2 cm from right
  const areaBottom = 3 * CM;    // 3 cm from bottom

  const pageW = (doc as any).page.width || 595.28;
  const pageH = (doc as any).page.height || 841.89;

  const regionLeft = areaLeft;
  const regionRight = pageW - areaRight;
  const regionTop = areaTop;
  const regionBottom = pageH - areaBottom;
  const regionWidth = regionRight - regionLeft;

  // Table starts at the region top
  let y = regionTop;

  // Column headers (6 columns, no "Pos")
  const headers = [
    "Art.-Nr.",
    "Bezeichnung",
    "Charge-Nr.",
    "Gewicht",
    "Preis/kg",
    "Gesamt",
  ];

  // Column x positions responsive to region width
  const widths = [60, 220, 80, 60, 50, 50];
  const baseTotal = 520; // sum(widths)
  const scale = regionWidth / baseTotal;
  const w = widths.map(v => v * scale);
  const x = [
    regionLeft,
    regionLeft + w[0],
    regionLeft + w[0] + w[1],
    regionLeft + w[0] + w[1] + w[2],
    regionLeft + w[0] + w[1] + w[2] + w[3],
    regionLeft + w[0] + w[1] + w[2] + w[3] + w[4],
    regionRight
  ];

  // Shared layout for pagination & reserves
  const lineH = 14; // row line height for table content
  const lineH2 = 14; // for totals block text spacing
  const totalsBlockHeight = 8 + lineH2 * 3; // three lines + top gap
  const sigHeight = 40;
  const sigGap = 12;
  const reserveFinal = totalsBlockHeight + sigGap + sigHeight; // space to keep free at bottom on the last page

  // Helper to (re)draw the table header and set y under it
  const drawHeaderRow = () => {
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(headers[0], x[0], y, { width: x[1] - x[0] - 6 });
    doc.text(headers[1], x[1], y, { width: x[2] - x[1] - 6 });
    doc.text(headers[2], x[2], y, { width: x[3] - x[2] - 6 });
    doc.text(headers[3], x[3], y, { width: x[4] - x[3] - 6, align: 'right', lineBreak: false });
    doc.text(headers[4], x[4], y, { width: x[5] - x[4] - 6, align: 'right', lineBreak: false });
    doc.text(headers[5], x[5], y, { width: x[6] - x[5] - 6, align: 'right', lineBreak: false });
    doc.moveTo(regionLeft, y + 12).lineTo(regionRight, y + 12).strokeColor('#000').lineWidth(0.5).stroke();
    y += 18;
    doc.font("Helvetica").fontSize(10);
  };

  // Initial header
  drawHeaderRow();

  // Pagination state
  let pageNetto = 0; // netto sum on current page
  let carryNetto = 0; // cumulative sum from previous pages

  // Ensure there is room for `need` height, else break page with Übertrag at bottom
  const ensureRoom = (need: number) => {
    const maxY = regionBottom - reserveFinal; // never draw into final reserved area
    if (y + need <= maxY) return;

    // Draw Übertrag at bottom of the current page
    const TOTALS_TOP_LOCAL = regionBottom - totalsBlockHeight;
    doc.moveTo(regionLeft, TOTALS_TOP_LOCAL).lineTo(regionRight, TOTALS_TOP_LOCAL).strokeColor('#000').lineWidth(0.5).stroke();
    let tyLocal = TOTALS_TOP_LOCAL + 8;
    const labelXLocal = regionLeft;
    const valXLocal = regionRight;
    const uebertrag = carryNetto + pageNetto;
    doc.font("Helvetica-Bold").fontSize(10).text("Übertrag", labelXLocal, tyLocal, { width: regionWidth * 0.6, align: 'left' });
    doc.font("Helvetica").text(euro(uebertrag), valXLocal - 100, tyLocal, { width: 100, align: 'right' });

    // Prepare next page
    carryNetto += pageNetto;
    pageNetto = 0;
    doc.addPage();
    // Redraw the Rechnungskopf on the new page
    if (kunde || auftrag) {
      try { drawRechnungskopf(doc, kunde, auftrag); } catch {}
    }
    // Reset page metrics (same size assumed)
    y = regionTop;
    drawHeaderRow();
  };

  const rows = Array.isArray(positionen) ? positionen : [];
  let sumNetto = 0;
  rows.forEach((pos: ArtikelPositionResource) => {
    // Felder aus ArtikelPositionResource
    const artnr = pos.artikelNummer || ""; // Artikel-ID als String
    const bez = pos.artikelName || "Artikel";

    // Pre-calc row height (leergut lines + charge lines, at least one line)
    const leergutCount = Array.isArray(pos.leergut) ? pos.leergut.length : 0;
    const chargeLinesPreview = Array.isArray(pos.chargennummern) ? pos.chargennummern.filter(c => !!c && String(c).trim() !== '') : [];
    const maxLinesPreview = Math.max(1, chargeLinesPreview.length);
    const need = (leergutCount + maxLinesPreview) * lineH;
    ensureRoom(need);

    // ===== Leergut-Zusatzzeilen (immer DARÜBER) =====
    if (Array.isArray(pos.leergut) && pos.leergut.length > 0) {
      pos.leergut.forEach((lg) => {
        const lgName = lg?.leergutArt ? String(lg.leergutArt) : 'Leergut';
        const lgAnzahlNum = typeof (lg as any).leergutAnzahl === 'number' ? (lg as any).leergutAnzahl : undefined;
        const lgAnzahl = typeof lgAnzahlNum === 'number' ? fmt2(lgAnzahlNum) : '';

        // Art.-Nr.: leer, Bezeichnung = Leergutname, Charge: leer
        doc.text('', x[0], y, { width: x[1] - x[0] - 6 });
        doc.text(lgName, x[1], y, { width: x[2] - x[1] - 6 });
        doc.text('', x[2], y, { width: x[3] - x[2] - 6 });
        // Gewichtsspalte zeigt Anzahl
        doc.text(lgAnzahl, x[3], y, { width: x[4] - x[3] - 6, align: 'right', lineBreak: false });
        // Preis/kg = 0, Gesamt = 0
        doc.text(euro(0), x[4], y, { width: x[5] - x[4] - 6, align: 'right', lineBreak: false });
        doc.text(euro(0), x[5], y, { width: x[6] - x[5] - 6, align: 'right', lineBreak: false });

        // Nach jeder Leergut-Zeile einen Zeilensprung nach unten
        y += lineH;
      });
    }

    // Multi-line aware rendering for chargennummern
    const chargeLines = Array.isArray(pos.chargennummern) ? pos.chargennummern.filter(c => !!c && String(c).trim() !== '') : [];
    const maxLines = Math.max(1, chargeLines.length);

    // Gewicht/Menge: bevorzugt NETTOGEWICHT, dann kommissionierte Menge, dann normale Menge
    const netto = typeof pos.nettogewicht === 'number' ? pos.nettogewicht : undefined;
    const mengeKom = typeof pos.kommissioniertMenge === 'number' ? pos.kommissioniertMenge : undefined;
    const mengeNorm = typeof pos.menge === 'number' ? pos.menge : undefined;

    const anzeigeMenge = (typeof netto === 'number')
      ? netto
      : (typeof mengeKom === 'number' ? mengeKom : mengeNorm);

    const anzeigeEinheit = (typeof netto === 'number')
      ? 'kg'
      : ((pos.kommissioniertEinheit || pos.einheit) || '');

    // Preis pro Einheit (Definition: einzelpreis = Preis pro Gewichtseinheit)
    const preisProEinheit = typeof pos.einzelpreis === 'number' ? pos.einzelpreis : undefined;

    // Gesamtpreis: bevorzugt vorhandenes Feld, sonst berechnen mit anzeigeMenge
    const gesamt = typeof pos.gesamtpreis === 'number'
      ? pos.gesamtpreis
      : (typeof preisProEinheit === 'number' && typeof anzeigeMenge === 'number'
          ? preisProEinheit * anzeigeMenge
          : undefined);
    if (typeof gesamt === 'number') { sumNetto += gesamt; pageNetto += gesamt; }

    // Render first line (and single-line cells)
    doc.text(String(artnr), x[0], y, { width: x[1] - x[0] - 6 });
    doc.text(String(bez), x[1], y, { width: x[2] - x[1] - 6 });
    if (chargeLines.length > 0) {
      doc.text(String(chargeLines[0]), x[2], y, { width: x[3] - x[2] - 6 });
    } else {
      doc.text('', x[2], y, { width: x[3] - x[2] - 6 });
    }
    const gewichtText = (typeof anzeigeMenge === 'number')
      ? (anzeigeEinheit === 'kg' || anzeigeEinheit === 'KG' || !anzeigeEinheit
          ? fmt2(anzeigeMenge)
          : `${fmt2(anzeigeMenge)}`)
      : '';
    doc.text(gewichtText, x[3], y, { width: x[4] - x[3] - 6, align: 'right', lineBreak: false });
    doc.text(preisProEinheit != null ? euro(preisProEinheit) : '', x[4], y, { width: x[5] - x[4] - 6, align: 'right', lineBreak: false });
    doc.text(gesamt != null ? euro(gesamt) : '', x[5], y, { width: x[6] - x[5] - 6, align: 'right', lineBreak: false });

    // Render remaining chargennummer lines one per row span
    for (let i = 1; i < maxLines; i++) {
      const yy = y + i * lineH;
      const ch = chargeLines[i] || '';
      // Only draw into the charge column for the extra lines to avoid overlaps
      doc.text(String(ch), x[2], yy, { width: x[3] - x[2] - 6 });
    }

    // Advance Y by the tallest cell height
    y += maxLines * lineH;
  });

  // ===== Final totals & signatures on the last page =====
  // Draw only once (we are on the final page now)
  const TOTALS_TOP = regionBottom - totalsBlockHeight;
  doc.moveTo(regionLeft, TOTALS_TOP).lineTo(regionRight, TOTALS_TOP).strokeColor('#000').lineWidth(0.5).stroke();

  let ty = TOTALS_TOP + 8;
  const labelX = regionLeft;
  const valX = regionRight;
  doc.font("Helvetica").fontSize(10).text("Nettobetrag", labelX, ty, { width: regionWidth * 0.6, align: 'left' });
  doc.text(euro(sumNetto), valX - 100, ty, { width: 100, align: 'right' });
  ty += lineH2;
  const mwstSatzVal = typeof mwstSatz === 'number' ? mwstSatz : 7;
  const mwst = sumNetto * (mwstSatzVal / 100);
  const brutto = sumNetto + mwst;
  doc.text(`+ ${mwstSatzVal}% MwSt.`, labelX, ty, { width: regionWidth * 0.6, align: 'left' });
  doc.text(euro(mwst), valX - 100, ty, { width: 100, align: 'right' });
  ty += lineH2;
  doc.text("Summe MWST", labelX, ty, { width: regionWidth * 0.6, align: 'left' });
  doc.text(euro(mwst), valX - 100, ty, { width: 100, align: 'right' });
  ty += lineH2;
  doc.font("Helvetica-Bold").text("Gesamtbetrag", labelX, ty, { width: regionWidth * 0.6, align: 'left' });
  doc.text(euro(brutto), valX - 100, ty, { width: 100, align: 'right' });
  doc.font("Helvetica");

  // Signature boxes placed above totals, inside region (final page)
  const SIG_TOP = TOTALS_TOP - sigGap - sigHeight;
  const SIG_WIDTH = Math.min(220, regionWidth / 2 - 10);
  const SIG_LEFT_X = regionLeft;
  const SIG_RIGHT_X = regionLeft + regionWidth / 2 + 10;

  doc.font("Helvetica-Bold").fontSize(9).text("UNTERSCHRIFT KUNDE", SIG_LEFT_X, SIG_TOP - 14, { width: SIG_WIDTH });
  doc.font("Helvetica-Bold").fontSize(9).text("UNTERSCHRIFT MITARBEITER", SIG_RIGHT_X, SIG_TOP - 14, { width: SIG_WIDTH });

  doc.lineWidth(0.8).strokeColor('#000')
    .rect(SIG_LEFT_X, SIG_TOP, SIG_WIDTH, sigHeight).stroke()
    .rect(SIG_RIGHT_X, SIG_TOP, SIG_WIDTH, sigHeight).stroke();
}

function drawAddresses(doc: PDFKitDocument, kunde: any, firma: { name?: string; adresse?: string } = {}) {
  const y = 110;
  // Absender
  const abs = `${firma.name || "Firma"}\n${firma.adresse || ""}`.trim();
  if (abs) doc.fontSize(11).fillColor("#555").text(abs, 50, y, { width: 200 });
  doc.fillColor("black");

  // Empfänger
  const kd = [kunde?.name, kunde?.adresse].filter(Boolean).join("\n");
  doc.fontSize(11).text(kd || "Kunde", 300, y, { width: 250 });
}

function drawInfoBlock(doc: PDFKitDocument, info: Record<string, string | number | undefined>) {
  // Renders a two-column info block under addresses
  let y = 180;
  const x1 = 50, x2 = 300;
  const keys = Object.keys(info);
  const left: string[] = []; const right: string[] = [];
  keys.forEach((k, i) => {
    (i % 2 === 0 ? left : right).push(`${k}: ${info[k] ?? "—"}`);
  });
  doc.fontSize(10);
  left.forEach((l) => { doc.text(l, x1, y); y += 14; });
  y = 180;
  right.forEach((r) => { doc.text(r, x2, y); y += 14; });
}

function drawTable(doc: PDFKitDocument, headers: string[], rows: TableRow[]) {
  let y = 230;
  const x = [50, 100, 260, 360, 430, 500]; // Pos, Art-Nr, Bez., Menge, Preis, Summe
  doc.fontSize(10).fillColor("#333");
  headers.forEach((h, i) => doc.text(h, x[i], y));
  doc.moveTo(50, y + 12).lineTo(550, y + 12).stroke();
  y += 20;
  doc.fillColor("black");
  rows.forEach((r) => {
    r.forEach((c, i) => doc.text(c ?? "", x[i], y, { width: (x[i + 1] || 550) - x[i] - 4 }));
    y += 16;
  });
  return y;
}

function drawTotals(doc: PDFKitDocument, yStart: number, totals: { netto?: number; mwstSatz?: number; brutto?: number }) {
  const xLabel = 400, xVal = 520; let y = Math.max(yStart + 10, 260);
  const items: [string, string][] = [];
  if (typeof totals.netto === "number") items.push(["Zwischensumme", euro(totals.netto)]);
  if (typeof totals.mwstSatz === "number" && typeof totals.netto === "number") {
    const mwst = totals.netto * (totals.mwstSatz / 100);
    items.push([`MwSt (${totals.mwstSatz}%)`, euro(mwst)]);
    items.push(["Gesamtbetrag", euro((totals.netto || 0) + mwst)]);
  }
  if (typeof totals.brutto === "number" && items.length === 0) items.push(["Gesamtbetrag", euro(totals.brutto)]);
  doc.fontSize(10);
  items.forEach(([l, v]) => { doc.text(l, xLabel, y, { align: "right", width: 100 }); doc.text(v, xVal, y, { align: "right", width: 80 }); y += 16; });
  return y;
}

function drawFooter(
  doc: PDFKitDocument,
  text?: string,
  columns?: { left?: string; center?: string; right?: string }
) {
  const bottomY = 775; // moved footer 2 lines higher
  // separator line slightly above footer text
  doc
    .lineWidth(1)
    .moveTo(40, bottomY - 24)
    .lineTo(570, bottomY - 24)
    .strokeColor('#000')
    .stroke();

  // If columns provided, render three-column micro footer
  if (columns && (columns.left || columns.center || columns.right)) {
    doc.fontSize(7).fillColor('#333');

    const norm = (s?: string) => (s || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const colW = 160;
    const baseY = bottomY - 20; // same top Y for all
    const leftX = 50, centerX = 230, rightX = 410;
    const lineH = 9; // fixed line height for 7pt font

    const leftLines = norm(columns.left);
    const centerLines = norm(columns.center);
    const rightLines = norm(columns.right);

    const maxLines = Math.max(leftLines.length, centerLines.length, rightLines.length);

    // Draw each column line-by-line, same Y per row, to avoid wrapping inconsistencies
    for (let i = 0; i < maxLines; i++) {
      const y = baseY + i * lineH;
      const l = leftLines[i];
      const c = centerLines[i];
      const r = rightLines[i];
      if (typeof l === 'string') doc.text(l, leftX, y, { width: colW, align: 'left' });
      if (typeof c === 'string') doc.text(c, centerX, y, { width: colW, align: 'left' });
      if (typeof r === 'string') doc.text(r, rightX, y, { width: colW, align: 'left' });
    }

    // keep cursor untouched
    doc.fillColor('black');
    return;
  }

  // fallback: single centered text (previous behavior)
  doc.fontSize(8).fillColor('#555').text(text || 'Dies ist ein automatisch erstelltes Dokument.', 50, bottomY - 18, { align: 'center', width: 500 });
  doc.fillColor('black');
}

async function renderRechnung(doc: PDFKitDocument, auftrag: any, kunde: any, opts?: { logoPath?: string; firma?: { name?: string; adresse?: string }; mwstSatz?: number; }) {
  drawHeader(doc, { title: "Rechnung", logoPath: opts?.logoPath });
  drawAddresses(doc, kunde, opts?.firma);

  drawInfoBlock(doc, {
    "Rechnungsnummer": auftrag.rechnungsNummer || "—",
    "Auftragsnummer": auftrag.auftragsnummer || "—",
    Datum: new Date().toLocaleDateString("de-DE"),
    Kunde: kunde?.name || "—",
  });

  // Tabellenzeilen bauen
  const rows: TableRow[] = [];
  let sumNetto = 0;
  const posList: any[] = Array.isArray(auftrag.artikelPosition) ? (auftrag.artikelPosition as any[]) : [];
  posList.forEach((pos: any, i: number) => {
    const artikelNr = pos.artikel || "";
    const bezeichnung = pos.bezeichnung || pos.artikelName || "Artikel";
    const menge = num(pos.menge) ?? undefined;
    const einheit = pos.einheit || "";
    const preis = num(pos.einzelpreis) ?? num(pos.preis) ?? undefined;
    const zeilenSumme = typeof preis === "number" && typeof menge === "number" ? preis * menge : undefined;
    if (typeof zeilenSumme === "number") sumNetto += zeilenSumme;
    rows.push([
      String(i + 1),
      String(artikelNr),
      String(bezeichnung),
      menge !== undefined ? `${menge} ${einheit}` : `${einheit}`,
      preis !== undefined ? euro(preis) : "",
      zeilenSumme !== undefined ? euro(zeilenSumme) : "",
    ]);
  });

  const lastY = drawTable(doc, ["Pos", "Art.-Nr.", "Bezeichnung", "Menge", "Einzelpreis", "Summe"], rows);
  const totalsY = drawTotals(doc, lastY, { netto: sumNetto, mwstSatz: opts?.mwstSatz ?? 19 });

  drawFooter(doc, undefined, {
    left:
      'Beusselstraße 44\n10553 Berlin\nTelefon: +49 30 398019330\ninfo@haclar-et.de',
    center:
      'Berliner Volksbank\nKto-Nr. 2951 7360 00  BLZ 100 900 00\nIBAN DE88 1009 2951 7360 00\nSWIFT BEVODEBBXXX',
    right:
      'Geschäftsführer:\nA. Kadioglu, R. Kazancioglu\nAmtsgericht Berlin-Charlottenburg HRB 30292\nSt-Nr.: 30/038/75076 USt-ID-NR. DE 136685882',
  });
}

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

  dlog('generateBelegPdf:start', { auftragId, belegTyp });
  dlog('auftrag.artikelPosition raw:', (auftrag as any).artikelPosition);

  const doc = new PDFDocument({ margin: 50, size: 'A4', autoFirstPage: true, bufferPages: true });
  const buffers: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => buffers.push(chunk));

  // === Header + Footer (ohne weitere Inhalte) ===
  drawRechnungskopf(doc, kunde, auftrag);
  // Body: Artikelpositionen-Tabelle (Rechnung & Lieferschein)
  if (belegTyp === 'rechnung' || belegTyp === 'lieferschein') {
    const raw = Array.isArray(auftrag.artikelPosition) ? (auftrag.artikelPosition as any[]) : [];
    const ids = raw.map((p: any) => toIdString(p)).filter(Boolean) as string[];
    dlog('normalized position ids:', ids);

    const positionen: ArtikelPositionResource[] = [];
    for (const id of ids) {
      try {
        const pos = await getArtikelPositionById(id);
        positionen.push(pos);
        dlog('position fetched', id, {
          artikel: pos.artikel,
          artikelName: pos.artikelName,
          menge: pos.menge,
          einheit: pos.einheit,
          kommissioniertMenge: pos.kommissioniertMenge,
          kommissioniertEinheit: pos.kommissioniertEinheit,
          gesamtpreis: pos.gesamtpreis,
        });
      } catch (e: any) {
        dlog('position fetch FAILED', id, e?.message || e);
      }
    }
    dlog('positions resolved count:', positionen.length);

    const mwstSatz = (auftrag as any).mwstSatz ?? 7;
    dlog('mwstSatz used:', mwstSatz);
    drawPositionsTable(doc, positionen, mwstSatz, kunde, auftrag);
  }


  const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
    doc.end();
  });
  dlog('generateBelegPdf:end', { bytes: Buffer.concat(buffers).length });
  return pdfBuffer;
}

/**
 * Generiert mehrere Belege (einzeln) und liefert sie als Liste zurück.
 * Wichtig: Es wird **kein** Sammel-PDF erzeugt. Jede Ausgabe ist eine eigene PDF-Datei.
 *
 * Frontend-Use-Case: Benutzer wählt mehrere Aufträge → Backend liefert Array von
 * { auftragId, filename, pdf } zurück. Das Frontend kann dann pro Eintrag einen
 * Download anstoßen.
 */
export async function generateBelegePdfs(
  auftragIds: string[],
  belegTyp: BelegTyp
): Promise<{ auftragId: string; filename: string; pdf: Buffer }[]> {
  if (!Array.isArray(auftragIds) || auftragIds.length === 0) {
    throw new Error("Keine Auftrag-IDs übergeben");
  }

  const results: { auftragId: string; filename: string; pdf: Buffer }[] = [];

  for (const auftragId of auftragIds) {
    try {
      const auftrag = await Auftrag.findById(auftragId);
      if (!auftrag) {
        dlog('generateBelegePdfs: Auftrag nicht gefunden', auftragId);
        continue; // Überspringen statt komplett abbrechen
      }
      const kunde = await Kunde.findById(auftrag.kunde).catch(() => undefined);

      // Sinnvollen Dateinamen erzeugen
      const typLabel =
        belegTyp === 'rechnung' ? 'Rechnung' :
        belegTyp === 'lieferschein' ? 'Lieferschein' :
        belegTyp === 'gutschrift' ? 'Gutschrift' :
        belegTyp === 'preisdifferenz' ? 'Preisdifferenz' : 'Beleg';

      const rn = (auftrag as any).rechnungsNummer || (auftrag as any).auftragsnummer || auftragId;
      const kdName = (kunde?.name ? String(kunde.name) : 'Kunde').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_\-]/g, '');
      const filename = `${typLabel}_${rn}_${kdName}.pdf`;

      // Wiederverwendung der Einzelfunktion
      const pdf = await generateBelegPdf(auftragId, belegTyp);

      results.push({ auftragId, filename, pdf });
    } catch (err: any) {
      dlog('generateBelegePdfs: Fehler bei', auftragId, err?.message || err);
      // Fehlerhafte IDs werden übersprungen – optional könnte man hier auch
      // einen Platzhalter mit Fehlermeldung zurückgeben
      continue;
    }
  }

  return results;
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