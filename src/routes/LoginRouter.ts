import express, { Request, Response, NextFunction } from "express";
import {
  body,
  validationResult,
  ValidationError,
  param,
} from "express-validator";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import path from "path";
import {
  kundeExistsByEmail,
  loginKunde,
  updateKundePasswordByEmail,
} from "../services/KundeService"; // Pfad ggf. anpassen
import {
  loginMitarbeiter,
  updateMitarbeiterPasswordByName,
} from "../services/MitarbeiterService"; // Pfad ggf. anpassen
import { LoginResource } from "../Resources"; // Pfad ggf. anpassen

const loginRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// --- Email Transport (Nodemailer) ---
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "info@hacilar.eu";
const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL || "http://localhost:3000";
const NODE_ENV = process.env.NODE_ENV || "development";

const canSendEmail = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);
const SMTP_TLS_INSECURE =
  (process.env.SMTP_TLS_INSECURE || "").toLowerCase() === "true";
const transporter = canSendEmail
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // If your server uses a self-signed / misconfigured certificate, allow insecure TLS in DEV only
      tls: SMTP_TLS_INSECURE
        ? { rejectUnauthorized: false }
        : { servername: SMTP_HOST },
      logger: NODE_ENV !== "production",
      debug: NODE_ENV !== "production",
    })
  : null;

async function sendResetEmail(to: string, token: string) {
  const resetUrl = `${FRONTEND_BASE_URL.replace(
    /\/$/,
    ""
  )}/reset-password?token=${encodeURIComponent(token)}`;
  const logoPath = path.join(__dirname, "..", "assets", "logo.png");
  const mail = {
    from: SMTP_FROM,
    to,
    subject: "Passwort zurücksetzen – Hacilar Neu",
    html: `
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Passwort zurücksetzen – Hacilar Neu</title>
  <style>
    /* Dark mode friendly defaults */
    @media (prefers-color-scheme: dark) {
      .bg { background: #0b0f17 !important; }
      .card { background: #0f172a !important; color: #e5e7eb !important; }
      .muted { color: #94a3b8 !important; }
      .btn { color: #111827 !important; }
      .hr { border-color: #1f2937 !important; }
    }

    /* Mobile tweaks */
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 16px !important; }
      .card { padding: 20px !important; }
      .btn { display: block !important; width: 100% !important; }
      .code { word-break: break-all !important; }
    }

    /* Ensure links are clickable */
    a[x-apple-data-detectors] { 
      color: inherit !important; 
      text-decoration: none !important; 
    }
    
    /* Better button styling for all clients */
    .btn-link {
      display: inline-block !important;
      background: #1e3a8a !important;
      color: #ffffff !important;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 16px !important;
      font-weight: 700 !important;
      line-height: 44px !important;
      text-align: center !important;
      text-decoration: none !important;
      border-radius: 8px !important;
      padding: 0 20px !important;
      min-width: 260px !important;
      mso-hide: all;
    }
    
    /* Text alignment fixes */
    .text-center { text-align: center !important; }
    
    /* Link styling */
    .link {
      color: #1e3a8a !important;
      text-decoration: underline !important;
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f6f7fb;" class="bg">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    Passwort zurücksetzen für dein Hacilar Neu Konto. Link 30 Minuten gültig.
  </span>

  <!-- Outer table for full width background -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f6f7fb;" class="bg">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        
        <!-- Main container -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="container" style="max-width:600px;width:100%;">
          
          <!-- Brand Header -->
          <tr>
            <td align="center" style="padding-bottom: 16px;">
              <a href="${FRONTEND_BASE_URL}" style="text-decoration:none;">
                <span style="display:inline-block;background:#ffffff;border-radius:12px;padding:10px 14px;box-shadow:0 2px 8px rgba(15,23,42,.08);">
                  <img src="cid:hacilar-logo" alt="Hacilar Neu" width="140" style="display:block;height:auto;border:0;outline:none;text-decoration:none;" />
                </span>
              </a>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;box-shadow:0 10px 25px rgba(2,6,23,.08);padding:28px;" class="card">
              
              <!-- Title - Centered -->
              <div class="text-center">
                <h1 style="margin:0 0 8px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;color:#0f172a;text-align:center;">
                  Passwort zurücksetzen
                </h1>
              </div>

              <!-- Description - Centered -->
              <div class="text-center">
                <p style="margin:0 0 16px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#475569;text-align:center;">
                  Du hast eine Zurücksetzung deines Passworts angefordert. Klicke auf den Button, um ein neues Passwort zu vergeben.
                  <br><br>
                  Der Link ist <strong>30 Minuten</strong> gültig.
                </p>
              </div>

              <!-- CTA Button - Centered and Clickable -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
                <tr>
                  <td align="center">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${resetUrl}" style="height:44px;v-text-anchor:middle;width:300px;" arcsize="16%" stroke="f" fillcolor="#1e3a8a">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:Segoe UI, Arial, sans-serif;font-size:16px;font-weight:700;">
                        Passwort jetzt zurücksetzen
                      </center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${resetUrl}" target="_blank" rel="noopener" class="btn-link" style="display:inline-block;background:#1e3a8a;color:#ffffff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:44px;text-align:center;text-decoration:none;border-radius:8px;padding:0 20px;min-width:260px;">
                      Passwort jetzt zurücksetzen
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>

              <!-- Helper Text - Centered -->
              <div class="text-center">
                <p style="margin:0 0 10px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#64748b;text-align:center;">
                  Falls der Button nicht funktioniert, nutze diesen Link:
                </p>
              </div>

              <!-- Backup Link - Centered and Clickable -->
              <div class="text-center">
                <p class="code" style="margin:0 0 16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;color:#0f172a;text-align:center;">
                  <a href="${resetUrl}" target="_blank" rel="noopener" class="link" style="color:#1e3a8a;text-decoration:underline;word-break:break-all;">
                    ${resetUrl}
                  </a>
                </p>
              </div>

              <hr class="hr" style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">

              <!-- Tips - Centered -->
              <div class="text-center">
                <ul style="margin:0 0 12px 0;padding:0;list-style:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#64748b;line-height:1.6;text-align:center;">
                  <li style="margin-bottom:4px;">• Du hast das nicht angefordert? Ignoriere diese E‑Mail einfach.</li>
                  <li>• Aus Sicherheitsgründen funktioniert der Link nur einmal.</li>
                </ul>
              </div>

              <!-- Secondary CTA - Centered -->
              <div class="text-center">
                <p style="margin:12px 0 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;text-align:center;">
                  Brauchst du Hilfe? 
                  <a href="${FRONTEND_BASE_URL}/support" class="link" style="color:#1e3a8a;text-decoration:none;">Support kontaktieren</a>
                </p>
              </div>

            </td>
          </tr>

          <!-- Footer - Centered -->
          <tr>
            <td align="center" style="padding: 16px 8px;">
              <p class="muted" style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#94a3b8;text-align:center;">
                © ${new Date().getFullYear()} Hacilar Neu • Automatischer Service‑Hinweis
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`,
    text: [
      "Passwort zurücksetzen – Hacilar Neu",
      "",
      "Du hast eine Zurücksetzung deines Passworts angefordert. Der Link ist 30 Minuten gültig.",
      "Link öffnen:",
      resetUrl,
      "",
      "Wenn du diese Anfrage nicht gestellt hast, ignoriere diese E‑Mail.",
      "© Hacilar Neu",
    ].join("\n"),
    attachments: [
      {
        filename: "logo.png",
        path: logoPath,
        cid: "hacilar-logo",
      },
    ],
  };

  if (transporter) {
    await transporter.sendMail(mail);
  } else {
    console.warn("[MAIL] Transporter nicht konfiguriert – DEV-Log:", {
      to,
      resetUrl,
    });
  }
}

// --- Simple in-memory Rate Limiter (per IP) ---
type RateEntry = { count: number; resetAt: number };
const rateStore = new Map<string, RateEntry>();

function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const entry = rateStore.get(key);
  if (!entry || entry.resetAt <= now) {
    rateStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (entry.count >= limit) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count += 1;
  rateStore.set(key, entry);
  return { ok: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

// Middleware: Validierungsergebnisse prüfen
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Fehlerhafte Eingaben",
      errors: errors.array().map((e) => {
        if ("param" in e) {
          return {
            field: e.param,
            message: e.msg,
          };
        }
        return {
          field: "unknown",
          message: e.msg,
        };
      }),
    });
  }
  next();
};

/**
 * POST /login
 * Kombinierter Login-Endpoint.
 * - Wenn im Body eine "email" enthalten ist, wird der Kundenlogin genutzt.
 * - Wenn stattdessen "name" angegeben wird, erfolgt der Verkäuferlogin.
 */

loginRouter.post(
  "/",
  [
    body().custom((body) => {
      if (!body.email && !body.name) {
        throw new Error('Entweder "email" oder "name" muss angegeben werden.');
      }
      return true;
    }),
    body("email")
      .if(body("email").exists())
      .isEmail()
      .withMessage("Ungültige Email"),
    body("name")
      .if(body("name").exists())
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Name ist erforderlich"),
    body("password")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Passwort ist erforderlich"),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      let result: { token: string; user: LoginResource };

      if (req.body.email) {
        result = await loginKunde(req.body);
      } else if (req.body.name) {
        result = await loginMitarbeiter(req.body);
      } else {
        return res.status(400).json({
          code: "INVALID_INPUT",
          message: "Weder Email noch Name wurde übermittelt.",
        });
      }

      res.json(result);
    } catch (error: any) {
      console.error("LOGIN ERROR:", error);

      const msg = error.message?.toLowerCase() || "";

      if (msg.includes("passwort")) {
        return res.status(401).json({
          code: "AUTH_FAILED",
          message: "Das Passwort ist nicht korrekt.",
        });
      }

      if (msg.includes("nicht gefunden")) {
        return res.status(401).json({
          code: "USER_NOT_FOUND",
          message: "Benutzer nicht gefunden.",
        });
      }

      if (msg.includes("ungültige anmeldedaten")) {
        return res.status(401).json({
          code: "INVALID_CREDENTIALS",
          message: "Benutzername oder Passwort ist falsch.",
        });
      }

      return res.status(500).json({
        code: "INTERNAL_ERROR",
        message:
          "Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.",
      });
    }
  }
);

loginRouter.get("/check-token", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ message: "Kein Token gesendet" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
    return res.status(200).json({ valid: true, user: decoded });
  } catch (err) {
    return res.status(401).json({ message: "Token ungültig oder abgelaufen" });
  }
});

/**
 * OPTION B — Passwort-Zurücksetzen (zweistufig)
 * 1) POST /password/forgot  -> erzeugt einen zeitlich begrenzten Reset-Token (JWT)
 * 2) POST /password/reset   -> setzt neues Passwort anhand des Tokens
 *
 * HINWEIS: Die eigentliche Passwort-Aktualisierung in der Datenbank ist hier als TODO markiert.
 *          Später durch Service-Calls ersetzen (z. B. KundeService.updatePasswordByEmail / MitarbeiterService.updatePasswordByName).
 */

// POST /password/forgot
// Body: { email?: string, name?: string }
loginRouter.post(
  "/password/forgot",
  [
    body().custom((b) => {
      if (!b.email && !b.name) {
        throw new Error(
          "Bitte E-Mail (Kunde) ODER Name (Mitarbeiter) angeben."
        );
      }
      return true;
    }),
    body("email").optional().isEmail().withMessage("Ungültige E-Mail"),
    body("name")
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Name ist erforderlich"),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      // Rate limit: max 5 requests per 15 minutes per IP
      const rlKey = `forgot:${req.ip}`;
      const rl = rateLimit(rlKey, 5, 15 * 60 * 1000);
      if (!rl.ok) {
        const retrySec = Math.max(
          1,
          Math.ceil((rl.resetAt - Date.now()) / 1000)
        );
        return res.status(429).json({
          code: "RATE_LIMITED",
          message: `Zu viele Anfragen. Bitte in ${retrySec}s erneut versuchen.`,
        });
      }

      const { email, name } = req.body as { email?: string; name?: string };

      // JWT-Reset-Token: 30 Minuten gültig
      const token = jwt.sign(
        {
          purpose: "password_reset",
          userType: email ? "kunde" : "mitarbeiter",
          identifier: email || name, // email (Kunde) oder name (Mitarbeiter)
        },
        JWT_SECRET,
        { expiresIn: "30m" }
      );

      // E-Mail-Versand versuchen; Fehler nur loggen (Response bleibt generisch erfolgreich)
      // Nur senden, wenn die E-Mail einem Kunden gehört
      if (email) {
        try {
          const exists = await kundeExistsByEmail(email);
          if (exists) {
            try {
              await sendResetEmail(email, token);
            } catch (mailErr) {
              console.error("[MAIL] Versand fehlgeschlagen:", mailErr);
            }
          } else {
            // Kein Versand, wenn kein Kunde – Response bleibt generisch erfolgreich (Enumeration vermeiden)
            console.info(
              "[MAIL] Reset übersprungen – E-Mail gehört keinem Kunden:",
              email
            );
          }
        } catch (existsErr) {
          console.error("[MAIL] Kundenprüfungsfehler:", existsErr);
          // Sicherheitshalber nicht senden
        }
      }

      // In Development geben wir den Token zurück; in Produktion nicht.
      const payload: any = {
        ok: true,
        message: "Wenn der Benutzer existiert, wurde ein Reset-Link versendet.",
      };
      if (NODE_ENV !== "production") {
        payload.tokenDev = token;
      }
      return res.status(200).json(payload);
    } catch (err) {
      console.error("FORGOT PW ERROR:", err);
      return res.status(500).json({
        code: "INTERNAL_ERROR",
        message:
          "Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.",
      });
    }
  }
);

// POST /password/reset
// Body: { token: string, newPassword: string }
loginRouter.post(
  "/password/reset",
  [
    body("token").isString().notEmpty().withMessage("Reset-Token fehlt."),
    body("newPassword")
      .isString()
      .isLength({ min: 6 })
      .withMessage("Passwort muss mind. 6 Zeichen lang sein."),
  ],
  validate,
  async (req: Request, res: Response) => {
    try {
      // Rate limit: max 10 resets per 15 minutes per IP
      const rlKey = `reset:${req.ip}`;
      const rl = rateLimit(rlKey, 10, 15 * 60 * 1000);
      if (!rl.ok) {
        const retrySec = Math.max(
          1,
          Math.ceil((rl.resetAt - Date.now()) / 1000)
        );
        return res.status(429).json({
          code: "RATE_LIMITED",
          message: `Zu viele Anfragen. Bitte in ${retrySec}s erneut versuchen.`,
        });
      }

      const { token, newPassword } = req.body as {
        token: string;
        newPassword: string;
      };

      let decoded: any;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        return res.status(400).json({
          code: "INVALID_OR_EXPIRED_TOKEN",
          message: "Der Reset-Token ist ungültig oder abgelaufen.",
        });
      }

      if (
        decoded?.purpose !== "password_reset" ||
        !decoded?.identifier ||
        !decoded?.userType
      ) {
        return res.status(400).json({
          code: "INVALID_TOKEN_PAYLOAD",
          message: "Reset-Token hat ein ungültiges Format.",
        });
      }

      const identifier: string = decoded.identifier;
      const userType: "kunde" | "mitarbeiter" = decoded.userType;

      try {
        if (userType === "kunde") {
          await updateKundePasswordByEmail(identifier, newPassword);
        } else {
          await updateMitarbeiterPasswordByName(identifier, newPassword);
        }
      } catch (updateErr: any) {
        console.error("PASSWORD UPDATE ERROR:", updateErr);
        return res.status(400).json({
          code: "PASSWORD_UPDATE_FAILED",
          message: "Passwort konnte nicht aktualisiert werden.",
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Passwort erfolgreich aktualisiert.",
      });
    } catch (err) {
      console.error("RESET PW ERROR:", err);
      return res.status(500).json({
        code: "INTERNAL_ERROR",
        message:
          "Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.",
      });
    }
  }
);

export default loginRouter;
