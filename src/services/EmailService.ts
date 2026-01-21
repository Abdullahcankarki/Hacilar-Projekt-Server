import nodemailer from "nodemailer";
import path from "path";

// --- Email Transport Konfiguration ---
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "info@hacilar.eu";
const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL || "http://localhost:3000";
const NODE_ENV = process.env.NODE_ENV || "development";
const SMTP_TLS_INSECURE =
  (process.env.SMTP_TLS_INSECURE || "").toLowerCase() === "true";

const canSendEmail = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);

const transporter = canSendEmail
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: SMTP_TLS_INSECURE
        ? { rejectUnauthorized: false }
        : { servername: SMTP_HOST },
      logger: NODE_ENV !== "production",
      debug: NODE_ENV !== "production",
    })
  : null;

const logoPath = path.join(__dirname, "..", "assets", "logo.png");

// --- Typen ---
interface AuftragEmailData {
  kundenEmail: string;
  kundenName: string;
  auftragId: string;
  auftragNummer: string;
  bestellDatum: string;
  lieferDatum?: string;
  pdfBuffer?: Buffer; // Auftragsbestätigung als PDF-Anhang
}

interface FehlmengenEmailData {
  kundenEmail: string;
  kundenName: string;
  auftragNummer: string;
  positionen: Array<{
    artikelName: string;
    bestellteMenge: number;
    gelieferteMenge: number;
    einheit: string;
    differenz: number;
  }>;
  pdfBuffer?: Buffer; // Lieferschein als PDF-Anhang
}

interface LieferscheinEmailData {
  kundenEmail: string;
  kundenName: string;
  auftragNummer: string;
  lieferDatum: string;
  lieferAdresse: string;
  positionen: Array<{
    artikelName: string;
    menge: number;
    einheit: string;
  }>;
  fahrer?: string;
  fahrzeug?: string;
}

// --- Basis Email-Styles ---
const emailStyles = `
<style>
  @media (prefers-color-scheme: dark) {
    .bg { background: #0b0f17 !important; }
    .card { background: #0f172a !important; color: #e5e7eb !important; }
    .muted { color: #94a3b8 !important; }
    .hr { border-color: #1f2937 !important; }
  }
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; padding: 16px !important; }
    .card { padding: 20px !important; }
  }
  a[x-apple-data-detectors] {
    color: inherit !important;
    text-decoration: none !important;
  }
  .text-center { text-align: center !important; }
  .link { color: #1e3a8a !important; text-decoration: underline !important; }
  table.positionen { width: 100%; border-collapse: collapse; margin: 16px 0; }
  table.positionen th, table.positionen td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid #e5e7eb;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
  }
  table.positionen th {
    background: #f8fafc;
    font-weight: 600;
    color: #0f172a;
  }
  table.positionen td { color: #475569; }
  .highlight { background: #fef3c7 !important; }
  .success-badge {
    display: inline-block;
    background: #dcfce7;
    color: #166534;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 12px;
    font-weight: 600;
  }
  .warning-badge {
    display: inline-block;
    background: #fef3c7;
    color: #92400e;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 12px;
    font-weight: 600;
  }
  .info-badge {
    display: inline-block;
    background: #dbeafe;
    color: #1e40af;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 12px;
    font-weight: 600;
  }
</style>
`;

// --- Basis Email-Template ---
function baseEmailTemplate(
  title: string,
  preheader: string,
  content: string
): string {
  return `
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${title}</title>
  ${emailStyles}
</head>
<body style="margin:0;padding:0;background:#f6f7fb;" class="bg">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    ${preheader}
  </span>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f6f7fb;" class="bg">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="container" style="max-width:600px;width:100%;">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding-bottom: 16px;">
              <a href="${FRONTEND_BASE_URL}" style="text-decoration:none;">
                <span style="display:inline-block;background:#ffffff;border-radius:12px;padding:10px 14px;box-shadow:0 2px 8px rgba(15,23,42,.08);">
                  <img src="cid:hacilar-logo" alt="Hacilar" width="140" style="display:block;height:auto;border:0;outline:none;text-decoration:none;" />
                </span>
              </a>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;box-shadow:0 10px 25px rgba(2,6,23,.08);padding:28px;" class="card">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 16px 8px;">
              <p class="muted" style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#94a3b8;text-align:center;">
                © ${new Date().getFullYear()} Hacilar • Automatischer Service-Hinweis
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

// --- Helper: Email senden ---
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments: nodemailer.SendMailOptions["attachments"] = []
): Promise<void> {
  const mail: nodemailer.SendMailOptions = {
    from: SMTP_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo.png",
        path: logoPath,
        cid: "hacilar-logo",
      },
      ...attachments,
    ],
  };

  if (transporter) {
    await transporter.sendMail(mail);
  } else {
    console.warn("[MAIL] Transporter nicht konfiguriert – DEV-Log:", {
      to,
      subject,
    });
  }
}

// ============================================================
// 1. AUFTRAGSEINGANG EMAIL
// ============================================================
export async function sendAuftragseingangEmail(
  data: AuftragEmailData
): Promise<void> {
  const { kundenEmail, kundenName, auftragId, auftragNummer, bestellDatum, lieferDatum, pdfBuffer } = data;

  const auftragUrl = `${FRONTEND_BASE_URL.replace(/\/$/, "")}/auftraege/${auftragId}`;

  const content = `
    <div class="text-center">
      <span class="success-badge">Auftrag eingegangen</span>
      <h1 style="margin:16px 0 8px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#0f172a;text-align:center;">
        Vielen Dank für Ihre Bestellung!
      </h1>
    </div>

    <p style="margin:0 0 20px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#475569;text-align:center;">
      Hallo ${kundenName},<br>
      wir haben Ihren Auftrag erhalten und bearbeiten ihn schnellstmöglich.
    </p>

    <table style="width:100%;margin-bottom:20px;">
      <tr>
        <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#64748b;padding:4px 0;">
          <strong>Auftragsnummer:</strong>
        </td>
        <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;padding:4px 0;text-align:right;">
          <a href="${auftragUrl}" style="color:#1e3a8a;text-decoration:none;font-weight:600;">${auftragNummer}</a>
        </td>
      </tr>
      <tr>
        <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#64748b;padding:4px 0;">
          <strong>Bestelldatum:</strong>
        </td>
        <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;padding:4px 0;text-align:right;">
          ${bestellDatum}
        </td>
      </tr>
      ${
        lieferDatum
          ? `
      <tr>
        <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#64748b;padding:4px 0;">
          <strong>Gewünschtes Lieferdatum:</strong>
        </td>
        <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;padding:4px 0;text-align:right;">
          ${lieferDatum}
        </td>
      </tr>
      `
          : ""
      }
    </table>

    <!-- Hinweis auf PDF-Anhang -->
    <div style="background:#f0fdf4;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#166534;">
        <strong>Ihre Auftragsbestätigung finden Sie im Anhang dieser E-Mail als PDF.</strong>
      </p>
    </div>

    <!-- Auftrag ansehen Button -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center">
          <a href="${auftragUrl}" target="_blank" rel="noopener" style="display:inline-block;background:#1e3a8a;color:#ffffff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:44px;text-align:center;text-decoration:none;border-radius:8px;padding:0 24px;">
            Auftrag online ansehen
          </a>
        </td>
      </tr>
    </table>

    <hr class="hr" style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">

    <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#64748b;text-align:center;">
      Wir melden uns, sobald Ihre Ware zur Auslieferung bereit ist.<br>
      Bei Fragen erreichen Sie uns unter <a href="mailto:info@hacilar.eu" class="link">info@hacilar.eu</a>
    </p>
  `;

  const html = baseEmailTemplate(
    "Auftragsbestätigung – Hacilar",
    `Ihr Auftrag ${auftragNummer} ist eingegangen.`,
    content
  );

  const text = [
    "Auftragsbestätigung – Hacilar",
    "",
    `Hallo ${kundenName},`,
    "vielen Dank für Ihre Bestellung!",
    "",
    `Auftragsnummer: ${auftragNummer}`,
    `Bestelldatum: ${bestellDatum}`,
    lieferDatum ? `Gewünschtes Lieferdatum: ${lieferDatum}` : "",
    "",
    "Ihre Auftragsbestätigung finden Sie im Anhang dieser E-Mail als PDF.",
    "",
    `Auftrag online ansehen: ${auftragUrl}`,
    "",
    "Wir melden uns, sobald Ihre Ware zur Auslieferung bereit ist.",
    "© Hacilar",
  ]
    .filter(Boolean)
    .join("\n");

  // PDF als Anhang hinzufügen
  const attachments: nodemailer.SendMailOptions["attachments"] = [];
  if (pdfBuffer) {
    attachments.push({
      filename: `Auftragsbestaetigung_${auftragNummer}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    });
  }

  await sendEmail(kundenEmail, `Auftragsbestätigung – ${auftragNummer}`, html, text, attachments);
}

// ============================================================
// 2. FEHLMENGEN EMAIL
// ============================================================
export async function sendFehlmengenEmail(
  data: FehlmengenEmailData
): Promise<void> {
  const { kundenEmail, kundenName, auftragNummer, pdfBuffer } = data;

  const content = `
    <div class="text-center">
      <span class="warning-badge">Fehlmenge festgestellt</span>
      <h1 style="margin:16px 0 8px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#0f172a;text-align:center;">
        Hinweis zu Ihrem Auftrag
      </h1>
    </div>

    <p style="margin:0 0 20px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#475569;text-align:center;">
      Hallo ${kundenName},<br>
      bei der Kommissionierung Ihres Auftrags <strong>${auftragNummer}</strong> wurde eine Gewichtsabweichung festgestellt.
    </p>

    <div style="background:#fef3c7;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
      <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#92400e;">
        <strong>Hinweis:</strong> Die gelieferte Menge wurde beim Abwiegen ermittelt und weicht von der bestellten Menge ab.
        Die Abrechnung erfolgt nach tatsächlich gelieferter Menge.
      </p>
    </div>

    <!-- Hinweis auf PDF-Anhang -->
    <div style="background:#f0fdf4;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#166534;">
        <strong>Den Lieferschein mit allen Details finden Sie im Anhang dieser E-Mail als PDF.</strong>
      </p>
    </div>

    <hr class="hr" style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">

    <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#64748b;text-align:center;">
      Bei Fragen zu dieser Abweichung kontaktieren Sie uns gerne unter <a href="mailto:info@hacilar.eu" class="link">info@hacilar.eu</a>
    </p>
  `;

  const html = baseEmailTemplate(
    "Fehlmengen-Hinweis – Hacilar",
    `Fehlmenge bei Auftrag ${auftragNummer} festgestellt.`,
    content
  );

  const text = [
    "Fehlmengen-Hinweis – Hacilar",
    "",
    `Hallo ${kundenName},`,
    `bei der Kommissionierung Ihres Auftrags ${auftragNummer} wurde eine Gewichtsabweichung festgestellt.`,
    "",
    "Die gelieferte Menge wurde beim Abwiegen ermittelt und weicht von der bestellten Menge ab.",
    "Die Abrechnung erfolgt nach tatsächlich gelieferter Menge.",
    "",
    "Den Lieferschein mit allen Details finden Sie im Anhang dieser E-Mail als PDF.",
    "",
    "© Hacilar",
  ].join("\n");

  // PDF als Anhang hinzufügen
  const attachments: nodemailer.SendMailOptions["attachments"] = [];
  if (pdfBuffer) {
    attachments.push({
      filename: `Lieferschein_${auftragNummer}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    });
  }

  await sendEmail(kundenEmail, `Fehlmengen-Hinweis – Auftrag ${auftragNummer}`, html, text, attachments);
}

// ============================================================
// 3. WARE VERLADEN / LIEFERSCHEIN EMAIL
// ============================================================
export async function sendLieferscheinEmail(
  data: LieferscheinEmailData
): Promise<void> {
  const { kundenEmail, kundenName, auftragNummer, lieferDatum, lieferAdresse, positionen, fahrer, fahrzeug } = data;

  const positionenRows = positionen
    .map(
      (p) => `
      <tr>
        <td>${p.artikelName}</td>
        <td style="text-align:right;">${p.menge} ${p.einheit}</td>
      </tr>
    `
    )
    .join("");

  const content = `
    <div class="text-center">
      <span class="info-badge">Ware unterwegs</span>
      <h1 style="margin:16px 0 8px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#0f172a;text-align:center;">
        Ihre Ware wurde verladen!
      </h1>
    </div>

    <p style="margin:0 0 20px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#475569;text-align:center;">
      Hallo ${kundenName},<br>
      Ihr Auftrag <strong>${auftragNummer}</strong> wurde verladen und ist auf dem Weg zu Ihnen.
    </p>

    <div style="background:#dbeafe;border-radius:8px;padding:16px;margin-bottom:20px;">
      <table style="width:100%;">
        <tr>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;">
            <strong>Lieferdatum:</strong>
          </td>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;text-align:right;">
            ${lieferDatum}
          </td>
        </tr>
        <tr>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;">
            <strong>Lieferadresse:</strong>
          </td>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;text-align:right;">
            ${lieferAdresse}
          </td>
        </tr>
        ${
          fahrer
            ? `
        <tr>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;">
            <strong>Fahrer:</strong>
          </td>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;text-align:right;">
            ${fahrer}
          </td>
        </tr>
        `
            : ""
        }
        ${
          fahrzeug
            ? `
        <tr>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;">
            <strong>Fahrzeug:</strong>
          </td>
          <td style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e40af;padding:4px 0;text-align:right;">
            ${fahrzeug}
          </td>
        </tr>
        `
            : ""
        }
      </table>
    </div>

    <h2 style="margin:20px 0 12px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#0f172a;">
      Lieferumfang
    </h2>

    <table class="positionen">
      <thead>
        <tr>
          <th>Artikel</th>
          <th style="text-align:right;">Menge</th>
        </tr>
      </thead>
      <tbody>
        ${positionenRows}
      </tbody>
    </table>

    <div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin:20px 0;">
      <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#166534;">
        <strong>Lieferschein im Anhang:</strong> Den vollständigen Lieferschein finden Sie als PDF im Anhang dieser E-Mail.
      </p>
    </div>

    <hr class="hr" style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">

    <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#64748b;text-align:center;">
      Bei Fragen zur Lieferung erreichen Sie uns unter <a href="mailto:info@hacilar.eu" class="link">info@hacilar.eu</a>
    </p>
  `;

  const html = baseEmailTemplate(
    "Ihre Ware wurde verladen – Hacilar",
    `Auftrag ${auftragNummer} ist auf dem Weg zu Ihnen.`,
    content
  );

  const text = [
    "Ihre Ware wurde verladen – Hacilar",
    "",
    `Hallo ${kundenName},`,
    `Ihr Auftrag ${auftragNummer} wurde verladen und ist auf dem Weg zu Ihnen.`,
    "",
    `Lieferdatum: ${lieferDatum}`,
    `Lieferadresse: ${lieferAdresse}`,
    fahrer ? `Fahrer: ${fahrer}` : "",
    fahrzeug ? `Fahrzeug: ${fahrzeug}` : "",
    "",
    "Lieferumfang:",
    ...positionen.map((p) => `- ${p.artikelName}: ${p.menge} ${p.einheit}`),
    "",
    "Den vollständigen Lieferschein finden Sie als PDF im Anhang.",
    "© Hacilar",
  ]
    .filter(Boolean)
    .join("\n");

  // Hinweis: Anhänge (Lieferschein PDF) werden später hinzugefügt
  await sendEmail(kundenEmail, `Ihre Lieferung – Auftrag ${auftragNummer}`, html, text);
}

// --- Export des Transporters für Tests ---
export { transporter, canSendEmail };
