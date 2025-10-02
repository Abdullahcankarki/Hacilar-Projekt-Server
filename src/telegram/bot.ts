import { Telegraf, Markup } from "telegraf";

// === ENV ===
const BOT_TOKEN = process.env.TELEGRAM_API;
if (!BOT_TOKEN)
  throw new Error("Bitte TELEGRAM_API (Bot-Token) in .env setzen!");

// Optional: Kommagetrennte Liste von erlaubten User-IDs (nur interne Verkäufer)
// Beispiel: TELEGRAM_ALLOWED_IDS=1234567,7654321
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => Number(s));
const IS_WHITELIST_ACTIVE = ALLOWED_IDS.length > 0;

// Quick-Order API (interne Route deines Backends)
// Beispiel: QUICK_ORDER_URL=http://localhost:3355/api/auftraege/quick
const host = process.env.HOST;
const QUICK_ORDER_URL =
  process.env.QUICK_ORDER_URL || "http://localhost:3355/api/auftrag/quick";
// Optionaler Token, falls dein Backend Auth erfordert (z. B. ein Service-Token/JWT nur für den Bot)
const QUICK_ORDER_TOKEN = process.env.QUICK_ORDER_TOKEN; // z. B. "Bearer eyJ..."
const AUTH_LOGIN_URL =
  process.env.AUTH_LOGIN_URL || "http://localhost:3355/api/login"; // erwartet { username, password } -> { token, expiresInSec? }

const KUNDE_SEARCH_URL =
  process.env.KUNDE_SEARCH_URL || "http://localhost:3355/api/kunde?search="; // GET with ?search=
const ARTIKEL_SEARCH_URL =
  process.env.ARTIKEL_SEARCH_URL || "http://localhost:3355/api/artikel?search="; // GET with ?search=

// === BOT ===
const bot = new Telegraf(BOT_TOKEN);

// direkt nach: const bot = new Telegraf(BOT_TOKEN);
function buildDateKeyboard() {
  const today = toIsoYmdBerlin(new Date());
  const tomorrow = toIsoYmdBerlin(new Date(Date.now() + 24 * 3600 * 1000));
  const weekdayRow = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
  return Markup.keyboard([["Heute", "Morgen"], [today, tomorrow], weekdayRow])
    .resize()
    .persistent(true);
}

// Simple In-Memory-State (pro Chat)
// Session shape helper (informal)
// state.get(chatId) may hold: { kundeId?: string; kunde?: string; datum?: string; items?: any[] }
const state = new Map<number, any>();

// Auth-Session pro Chat (persistiert im RAM des Prozesses)
const authByChat = new Map<
  number,
  { token: string; expiresAt?: number; username?: string }
>();
// Temporärer Login-Flow-State
const loginFlowByChat = new Map<
  number,
  { step: "await_username" | "await_password"; username?: string }
>();

// --- Helpers ---
function isAllowed(userId?: number): boolean {
  if (!IS_WHITELIST_ACTIVE) return true; // keine Whitelist konfiguriert → alle erlaubt
  if (!userId) return false;
  return ALLOWED_IDS.includes(userId);
}


function toIsoYmdBerlin(date: Date): string {
  // Date → YYYY-MM-DDT15:00:00 (lokal, Berlin-Zeit)
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  // feste Uhrzeit 15:00
  return `${y}-${m}-${d}T15:00:00`;
}

// --- Weekday Shortcuts (German) ---
const WEEKDAY_ALIASES: Record<string, number> = {
  // 0=Sonntag ... 6=Samstag (JS getDay)
  sonntag: 0, so: 0,
  montag: 1, mo: 1,
  dienstag: 2, di: 2,
  mittwoch: 3, mi: 3,
  donnerstag: 4, do: 4,
  freitag: 5, fr: 5,
  samstag: 6, sa: 6,
  sonnabend: 6, sb: 6,
};

function parseWeekday(text: string): number | null {
  const key = text.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(WEEKDAY_ALIASES, key)
    ? WEEKDAY_ALIASES[key]
    : null;
}

function nextOccurrenceOfWeekday(targetDow: number, from: Date): Date {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const todayDow = base.getDay(); // 0..6 (So..Sa)
  let delta = (targetDow - todayDow + 7) % 7;
  if (delta === 0) delta = 7; // gleicher Tag -> nächste Woche
  const result = new Date(base);
  result.setDate(base.getDate() + delta);
  return result;
}

function parseOrderText(text: string): {
  kunde?: string;
  datum?: string;
  items: {
    artikelNr?: string;
    name?: string;
    menge: number;
    einheit?: string;
  }[];
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const result: {
    kunde?: string;
    datum?: string;
    items: {
      artikelNr?: string;
      name?: string;
      menge: number;
      einheit?: string;
    }[];
  } = { items: [] };

  // Helper regexes
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
  const itemRe = /(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|stk|kiste|karton)?$/i;

  // 1) Versuche erst das alte, gelabelte Format zu erkennen
  let consumed = 0;
  for (const line of lines) {
    if (/^kunde\s*:/i.test(line)) {
      result.kunde = line.split(":")[1]?.trim();
      consumed++;
      continue;
    }
    if (/^datum\s*:/i.test(line)) {
      result.datum = line.split(":")[1]?.trim();
      consumed++;
      continue;
    }
    if (/^artikel\s*:/i.test(line)) {
      consumed++;
      continue; // Überschrift ignorieren
    }
    // Stop parsing headers once we hit first non-labeled line
    break;
  }

  // 2) Falls nichts (oder nur wenig) gelabelt war, unterstütze das kompakte 3-Zeilen-Format:
  //    Zeile 1 = Kunde, Zeile 2 = Datum, ab Zeile 3 = Positionen
  if (!result.kunde && lines[0]) {
    // Nur übernehmen, wenn die erste Zeile NICHT wie ein Datum oder Item aussieht
    const first = lines[0];
    if (
      !isoDateRe.test(first) &&
      !/^[-•]/.test(first) &&
      !/^kunde\s*:/i.test(first) &&
      !itemRe.test(first) // <— neu: keine Artikelzeile wie "01001 200kg"
    ) {
      result.kunde = first;
      consumed = Math.max(consumed, 1);
    }
  }
  if (!result.datum && lines[1]) {
    if (isoDateRe.test(lines[1]) && !/^datum\s*:/i.test(lines[1])) {
      result.datum = lines[1];
      consumed = Math.max(consumed, 2);
    }
  }

  // 3) Restliche Zeilen als Items interpretieren (Bullet optional)
  //    Erkenne sowohl "<artikelNr> <menge><einheit>" als auch "<name> <menge><einheit>"
  const artikelNrRe = /^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/; // simple code pattern, keine Leerzeichen
  for (let i = consumed; i < lines.length; i++) {
    const rawLine = lines[i].replace(/^[-•]\s*/, "");
    if (!rawLine) continue;
    const m = rawLine.match(itemRe);
    if (m) {
      const descriptor = m[1].trim();
      const menge = Number(String(m[2]).replace(",", "."));
      const einheit = (m[3] || "kg").toLowerCase();
      if (artikelNrRe.test(descriptor) && !descriptor.includes(" ")) {
        result.items.push({ artikelNr: descriptor, menge, einheit });
      } else {
        result.items.push({ name: descriptor, menge, einheit });
      }
    } else {
      // Fallback: Alles als Name, Menge unbekannt
      if (artikelNrRe.test(rawLine) && !rawLine.includes(" ")) {
        result.items.push({ artikelNr: rawLine, menge: NaN });
      } else {
        result.items.push({ name: rawLine, menge: NaN });
      }
    }
  }

  return result;
}

function renderSummary(
  kunde?: string,
  datum?: string,
  items: {
    artikelNr?: string;
    name?: string;
    menge: number;
    einheit?: string;
  }[] = []
) {
  const label = (p: any) => (p.artikelNr ? `#${p.artikelNr}` : p.name || "?");
  const pos = items
    .map(
      (p, i) =>
        ` ${i + 1}. ${label(p)} – ${isFinite(p.menge) ? p.menge : "?"} ${
          p.einheit || "kg"
        }`
    )
    .join("\n");
  return (
    `Bitte bestätigen:\n` +
    `Kunde: ${kunde || "?"}\n` +
    `Datum: ${datum || "?"}\n` +
    `Positionen:\n` +
    (pos || " (keine)")
  );
}

function isExpired(expiresAt?: number) {
  return typeof expiresAt === "number" && Date.now() > expiresAt;
}

function getAuthHeaderForChat(chatId: number): string | null {
  const sess = authByChat.get(chatId);
  if (sess && sess.token && !isExpired(sess.expiresAt)) {
    return sess.token.startsWith("Bearer ")
      ? sess.token
      : `Bearer ${sess.token}`;
  }
  if (QUICK_ORDER_TOKEN) return QUICK_ORDER_TOKEN; // Fallback: global Service-Token
  return null;
}

function hasAuth(chatId: number): boolean {
  return !!getAuthHeaderForChat(chatId);
}

async function searchCustomers(chatId: number, q: string) {
  const authHeader = getAuthHeaderForChat(chatId);
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const res = await fetch(`${KUNDE_SEARCH_URL}${encodeURIComponent(q)}`, {
    headers,
  } as any);
  const body = await res.text();
  if (!res.ok) {
    let msg = `Kundensuche fehlgeschlagen (${res.status})`;
    try {
      const data = body ? JSON.parse(body) : null;
      if (data?.error) msg = String(data.error);
      else if (body) msg = body;
    } catch {
      if (body) msg = body;
    }
    throw new Error(msg);
  }
  // Erfolgsfall
  try {
    const data = body ? JSON.parse(body) : null;
    if (data && Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

async function searchArticles(chatId: number, q: string) {
  const authHeader = getAuthHeaderForChat(chatId);
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const res = await fetch(`${ARTIKEL_SEARCH_URL}${encodeURIComponent(q)}`, {
    headers,
  } as any);
  const body = await res.text();
  if (!res.ok) {
    let msg = `Artikelsuche fehlgeschlagen (${res.status})`;
    try {
      const data = body ? JSON.parse(body) : null;
      if (data?.error) msg = String(data.error);
      else if (body) msg = body;
    } catch {
      if (body) msg = body;
    }
    throw new Error(msg);
  }
  try {
    const data = body ? JSON.parse(body) : null;
    if (data && Array.isArray(data.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

async function postQuickOrder(chatId: number, payload: any) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = getAuthHeaderForChat(chatId);
  if (!authHeader) {
    throw new Error("AUTH_MISSING");
  }
  headers["Authorization"] = authHeader;
  const res = await fetch(QUICK_ORDER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  } as any);
  if (!res.ok) {
    const body = await res.text();
    let msg = `Fehler (${res.status})`;
    try {
      const data = body ? JSON.parse(body) : null;
      if (data?.error) msg = String(data.error);
      else if (body) msg = body;
    } catch {
      if (body) msg = body;
    }
    throw new Error(msg);
  }
  return res.json();
}

async function postSetGesamtpreis(chatId: number, payload: { artikel: string; customer: string; gesamtpreis: number }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = getAuthHeaderForChat(chatId);
  if (!authHeader) {
    throw new Error("AUTH_MISSING");
  }
  headers["Authorization"] = authHeader;
  const url = (process.env.KUNDENPREIS_SET_URL || "http://localhost:3355/api/kundenPreis/set-gesamtpreis");
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  } as any);
  if (!res.ok) {
    const body = await res.text();
    let msg = `Fehler (${res.status})`;
    try {
      const data = body ? JSON.parse(body) : null;
      if (data?.error) msg = String(data.error);
      else if (body) msg = body;
    } catch {
      if (body) msg = body;
    }
    throw new Error(msg);
  }
  return res.json();
}

// --- Middlewares/Guards ---
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!isAllowed(uid)) {
    return ctx.reply(
      "Zugriff verweigert. Bitte beim Admin freischalten lassen."
    );
  }
  return next();
});

// --- Commands ---
bot.start((ctx) =>
  ctx.reply(
    "👋 Willkommen bei Hacilar QuickOrder!\n" +
      "Schritt 0: /login (einmalig anmelden)\n" +
      "Schritt 1: Sende **nur den Kundennamen** (z. B. 'Has Food'). Ich zeige dir eine Auswahl.\n" +
      "Schritt 2: Wähle den richtigen Kunden.\n" +
      "Schritt 3: Datum wählen (Heute/Morgen oder YYYY-MM-DD).\n" +
      "Schritt 4: Positionen senden (z. B. '01001 200kg' oder 'Hä. Flügel Landgeflügel 200kg').\n\n" +
      "Befehle: /order (Beispiele), /login, /logout, /reset, /preis"
  )
);

bot.help((ctx) =>
  ctx.reply(
    "So funktioniert's:\n" +
      "0) /login – zuerst anmelden (Token wird in der Chat-Session gespeichert).\n" +
      "1) Kundennamen senden → ich zeige passende Kunden.\n" +
      "2) Kunden auswählen → Datum setzen.\n" +
      "3) Positionen schicken → bestätigen.\n\n" +
      "Befehle:\n/order – Beispiele anzeigen\n/login – Anmelden\n/logout – Abmelden\n/reset – Session leeren\n/preis – Kunden-Artikel-Gesamtpreis setzen (berechnet Aufpreis)\n"
  )
);
bot.command("preis", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  if (!hasAuth(chatId)) {
    return ctx.reply("🔒 Bitte zuerst anmelden: /login");
  }
  const s = state.get(chatId) || {};
  // Preis-Modus starten: Kunde bewusst zurücksetzen, damit jetzt erst abgefragt wird
  state.set(chatId, { ...s, mode: "preis", kundeId: undefined, kunde: undefined, items: undefined, preisFlow: {} });
  return ctx.reply(
    "💶 Preis-Modus aktiviert.\n" +
    "1) Kunde wählen (Name senden und auswählen).\n" +
    "2) Artikelsuche senden (Nummer oder Name).\n" +
    "3) Danach den gewünschten *Gesamtpreis* senden, z. B. 12.99.\n\n" +
    "Ich berechne: Aufpreis = Gesamtpreis − Artikel.Basispreis und speichere ihn für diesen Kunden/Artikel."
  );
});

bot.command("order", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  const s = state.get(chatId) || {};
  // Aktiviert expliziten Order-Modus und leert evtl. alte Order-Daten
  state.set(chatId, { ...s, mode: "order", kundeId: undefined, kunde: undefined, datum: undefined, items: undefined });
  const today = toIsoYmdBerlin(new Date());
  const tomorrow = toIsoYmdBerlin(new Date(Date.now() + 24 * 3600 * 1000));
  await ctx.reply(
    "Ablauf:\n" +
      "1) Sende nur den Kundennamen (z. B. 'Has Food').\n" +
      "2) Wähle den richtigen Kunden.\n" +
      "3) Datum setzen: Heute / Morgen / Wochentag / YYYY-MM-DD.\n" +
      "4) Positionen (je Zeile):\n" +
      "   • 01001 200kg\n" +
      "   • Hä. Flügel Landgeflügel 200kg",
    Markup.keyboard([
      ["Heute", "Morgen"],
      [today, tomorrow],
    ])
      .oneTime()
      .resize()
  );
});

bot.command("login", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  loginFlowByChat.set(chatId, { step: "await_username" });
  await ctx.reply("👤 Bitte Benutzername eingeben:");
});

bot.command("logout", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  authByChat.delete(chatId);
  await ctx.reply("🚪 Abgemeldet.");
});

bot.command("reset", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  state.delete(chatId);
  loginFlowByChat.delete(chatId);
  await ctx.reply("🔄 Session zurückgesetzt. Bitte Kundennamen senden.");
});

// --- Text Handler ---
bot.on("text", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  const text = ctx.message.text?.trim() || "";

  // Require login first (except when user is currently in /login flow)
  const lf = loginFlowByChat.get(chatId);
  if (!hasAuth(chatId) && !lf) {
    // allow only if user typed a command handled elsewhere (/login, /start, /help, /logout, /reset)
    if (!text.startsWith("/")) {
      return ctx.reply("🔒 Bitte zuerst anmelden: /login");
    }
  }

  const session = state.get(chatId) || {};

  // === Preis-Flow ===
  if (session.mode === "preis") {
    // 1) Kunde noch nicht gesetzt → benutze bestehenden Kundensuch-Flow (nichts zu tun hier)
    if (!session.kundeId && !session.kunde) {
      // falls der Text ein Befehl ist, ignoriere (wird anderswo behandelt)
      if (text.startsWith("/")) return; // andere Commands wie /reset, /logout
      // Triggere Kundensuche über den allgemeinen Block weiter unten
    } else {
      // 2) Wenn noch kein Artikel gewählt, versuche Artikelsuche
      const pf = session.preisFlow || {};
      if (!pf.artikelId) {
        if (text.startsWith("/")) return; // andere Commands zulassen
        try {
          const results = await searchArticles(chatId, text);
          if (!Array.isArray(results) || results.length === 0) {
            return ctx.reply("😕 Kein Artikel gefunden. Bitte präziser tippen.");
          }
          const top = results.slice(0, 8);
          const rows = top.map((a: any) => [
            Markup.button.callback(
              (a.artikelnummer || a.code || a.name || a.title || a.id),
              `pick_article:${a.id || a._id}`
            ),
          ]);
          const choices = top.map((a: any) => ({ id: String(a.id || a._id), name: String(a.artikelnummer || a.code || a.name || a.title || a.id || a._id) }));
          state.set(chatId, { ...session, preisFlow: { ...pf, artikelChoices: choices } });
          return ctx.reply('Bitte Artikel auswählen:', Markup.inlineKeyboard(rows));
        } catch (e: any) {
          const msg = String(e?.message || e);
          return ctx.reply(`❌ Artikelsuche fehlgeschlagen: ${msg}`);
        }
      }
      // 3) Artikel gewählt → Preis erwarten
      const numRe = /^\d+(?:[.,]\d+)?$/;
      if (numRe.test(text)) {
        const preis = Number(text.replace(',', '.'));
        try {
          const result = await postSetGesamtpreis(chatId, {
            artikel: pf.artikelId,
            customer: session.kundeId || session.kunde, // bevorzugt ID; Backend erwartet ID → Kunde sollte via Auswahl gesetzt sein
            gesamtpreis: preis,
          });
          // Aufräumen des Preis-Modus
          const { mode, preisFlow, ...rest } = session;
          state.set(chatId, rest);
          return ctx.reply(`✅ Aufpreis gesetzt. Artikel: ${pf.artikelName || pf.artikelId}\nGesamtpreis: ${preis}\nAufpreis: ${result?.aufpreis ?? 'gespeichert'}\nFür eine Bestellung /order`);
        } catch (e: any) {
          const msg = String(e?.message || e);
          return ctx.reply(`❌ Konnte Aufpreis nicht setzen: ${msg}`);
        }
      } else if (!text.startsWith('/')) {
        return ctx.reply("Bitte jetzt nur den gewünschten Gesamtpreis senden, z. B. 12.99");
      }
    }
  }

  // If no customer selected yet and text looks like a customer query, search and present choices
  const itemLineRe =
    /^[-•]?\s*(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|stk|kiste|karton)?$/i;
  if (
    !lf &&
    (session.mode === "order" || session.mode === "preis") &&
    !session.kundeId &&
    !session.kunde &&
    text &&
    !text.startsWith("/") &&
    !/^heute|morgen$/i.test(text) &&
    !itemLineRe.test(text)
  ) {
    try {
      const results = await searchCustomers(chatId, text);
      if (!Array.isArray(results) || results.length === 0) {
        return ctx.reply(
          "😕 Kein Kunde gefunden. Bitte präziser tippen oder anderen Namen versuchen."
        );
      }
      // build inline keyboard (top 8)
      const top = results.slice(0, 8);
      const rows = top.map((k: any) => [
        Markup.button.callback(
          k.name || k.title || k.display || k.id,
          `pick_customer:${k.id || k._id}`
        ),
      ]);
      // remember the original query and the shown choices (for later label lookup)
      const choices = top.map((k: any) => ({ id: String(k.id || k._id), name: String(k.name || k.title || k.display || k.id || k._id) }));
      state.set(chatId, { ...session, kundeQuery: text, kundenChoices: choices });
      return ctx.reply('Bitte Kunden auswählen:', Markup.inlineKeyboard(rows));
    } catch (e: any) {
      const msg = String(e?.message || e);
      const hint = msg.includes("Admin-Zugriff erforderlich")
        ? "\n🔒 Tipp: Bitte mit einem Admin-Konto einloggen (/login) oder die API für Verkäufer freischalten."
        : "";
      return ctx.reply(`❌ Kundensuche fehlgeschlagen: ${msg}${hint}`);
    }
  }

  // Login-Flow zuerst behandeln
  // const lf = loginFlowByChat.get(chatId); // removed duplicate declaration
  if (lf?.step === "await_username") {
    lf.username = text;
    lf.step = "await_password";
    loginFlowByChat.set(chatId, lf);
    return ctx.reply("🔑 Bitte Passwort eingeben:");
  }
  if (lf?.step === "await_password") {
    const username = lf.username || "";
    const password = text;
    try {
      const res = await fetch(AUTH_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: username, password }),
      } as any);
      if (!res.ok) {
        const t = await res.text();
        loginFlowByChat.delete(chatId);
        return ctx.reply(`❌ Login fehlgeschlagen: ${t}`);
      }
      const data = await res.json();
      const token = data.token || data.accessToken;
      const expiresInSec = data.expiresInSec || data.expires_in || 3600; // Fallback 1h
      const expiresAt = Date.now() + Number(expiresInSec) * 1000;
      if (!token) {
        loginFlowByChat.delete(chatId);
        return ctx.reply("❌ Login-Antwort ohne Token.");
      }
      authByChat.set(chatId, { token, expiresAt, username });
      loginFlowByChat.delete(chatId);
      return ctx.reply(
        "✅ Erfolgreich angemeldet.\nBestellung starten: /order\nPreis setzen: /preis"
      );
    } catch (e: any) {
      loginFlowByChat.delete(chatId);
      return ctx.reply(`❌ Login-Fehler: ${e?.message || e}`);
    }
  }

  // Quick shortcuts (Heute, Morgen, YYYY-MM-DD, Wochentag-Namen)
  const weekday = parseWeekday(text);
  if (
    text === "Heute" ||
    text === "Morgen" ||
    /^\d{4}-\d{2}-\d{2}$/.test(text) ||
    weekday !== null
  ) {
    const s = state.get(chatId) || {};
    if (s.mode !== "order") {
      return ctx.reply("ℹ️ Für Bestellungen bitte zuerst /order senden.");
    }
    let date: Date;
    if (text === "Heute") {
      date = new Date();
    } else if (text === "Morgen") {
      date = new Date(Date.now() + 24 * 3600 * 1000);
    } else if (weekday !== null) {
      date = nextOccurrenceOfWeekday(weekday, new Date());
    } else {
      date = new Date(text);
    }
    s.datum = toIsoYmdBerlin(date);
    state.set(chatId, s);
    const haveCustomer = !!(s.kundeId || s.kunde);
    const needWhat = haveCustomer
      ? 'Positionen (z. B. "01001 200kg")'
      : 'Kundennamen und Positionen (z. B. "01001 200kg")';
    const kb = buildDateKeyboard();
    return ctx.reply(`📅 Lieferdatum gesetzt: ${s.datum}. Sende ${needWhat}.`, kb);
  }

  if (session.mode === "order") {
    const parsed = parseOrderText(text);

    // Merge mit Session (was neu kommt, überschreibt)
    const merged = {
      kundeId: session.kundeId,
      kunde: parsed.kunde ?? session.kunde,
      datum: parsed.datum ?? session.datum,
      items:
        parsed.items && parsed.items.length > 0 ? parsed.items : session.items,
    } as any;

    // Welche Infos fehlen noch?
    const missing: string[] = [];
    if (!merged.kundeId && !merged.kunde)
      missing.push("Kundennamen wählen/senden");
    if (!merged.datum) missing.push("Datum (Heute/Morgen oder YYYY-MM-DD)");
    if (
      !merged.items ||
      !Array.isArray(merged.items) ||
      merged.items.length === 0
    )
      missing.push('Positionen (z. B. "01001 200kg")');

    // Session speichern
    state.set(chatId, { ...session, ...merged });

    // Nur das Fehlende anfordern
    if (missing.length > 0) {
      return ctx.reply(`ℹ️ Bitte noch: ${missing.join(" · ")}`);
    }

    // Alles da → Zusammenfassung + Bestätigen
    await ctx.reply(
      renderSummary(merged.kunde, merged.datum, merged.items),
      Markup.inlineKeyboard([
        [
          Markup.button.callback("✔ Bestätigen", "confirm_order"),
          Markup.button.callback("✏️ Ändern", "edit_order"),
        ],
      ])
    );
  }
  else {
    // Wenn der Text wie eine Positionszeile aussieht, freundlich auf /order hinweisen
    const looksLikeItem = /^[-•]?\s*(.+?)\s+(\d+(?:[.,]\d+)?)(?:\s*(kg|stk|kiste|karton))?$/i.test(text)
      || /^\d{4}-\d{2}-\d{2}$/.test(text);
    if (looksLikeItem && !text.startsWith('/')) {
      return ctx.reply("ℹ️ Für Bestellungen bitte zuerst /order senden.");
    }
  }
});

// --- Actions ---
bot.action("confirm_order", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id as number;
    if (!hasAuth(chatId)) {
      return ctx.reply("🔒 Bitte zuerst anmelden: /login");
    }
    const s = state.get(chatId);
    if (
      !(s?.kundeId || s?.kunde) ||
      !s?.datum ||
      !Array.isArray(s?.items) ||
      s.items.length === 0
    ) {
      return ctx.reply(
        "Session abgelaufen oder unvollständig. Bitte /order erneut senden."
      );
    }

    // Quick-Order: Entweder kundeName oder kundeId verwenden (hier: kundeName)
    const payload: any = {
      lieferdatum: s.datum,
      items: s.items,
    };
    if (s.kundeId) payload.kundeId = s.kundeId;
    else payload.kundeName = s.kunde;

    const created = await postQuickOrder(chatId, payload);
    state.delete(chatId);
    await ctx.editMessageText("✅ Auftrag angelegt.");
    await ctx.reply(
      `Auftragsnummer: ${created?.auftragsnummer || "(unbekannt)"}`
    );
  } catch (err: any) {
    if (String(err?.message).includes("AUTH_MISSING")) {
      return ctx.reply("🔒 Bitte zuerst anmelden: /login");
    }
    console.error("confirm_order error:", err);
    const pretty = String(err?.message || err).trim();
    await ctx.reply(`❌ Auftrag nicht angelegt:\n${pretty}`);
  }
});

bot.action("edit_order", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Sende die Daten erneut im selben Format oder nutze die Schnell-Buttons (Heute/Morgen)."
  );
});

bot.action(/^pick_customer:(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id as number;
    if (!hasAuth(chatId)) {
      return ctx.reply("🔒 Bitte zuerst anmelden: /login");
    }
    const id = ctx.match[1];
    // We need the label text from the button the user clicked; Telegram doesn't feed it back, so we can edit message or store last list.
    // For simplicity, we reuse the current message text and set kundeId; Kunde-Name can be re-fetched later if needed.
    const current = state.get(chatId) || {};
    let kundeName: string | undefined;
    if (Array.isArray(current.kundenChoices)) {
      const hit = current.kundenChoices.find((c: any) => String(c.id) === String(id));
      if (hit) kundeName = hit.name;
    }
    state.set(chatId, { ...current, kundeId: id, kunde: kundeName, kundenChoices: undefined });
    const mode = (state.get(chatId) || {}).mode;
    if (mode === "order") {
      const kb = buildDateKeyboard();
      await ctx.reply(
        `✅ Kunde gesetzt${kundeName ? `: ${kundeName}` : ''}. Bitte Datum senden (Heute/Morgen, Wochentag oder YYYY-MM-DD).`,
        kb
      );
    } else if (mode === "preis") {
      await ctx.reply(
        `✅ Kunde gesetzt${kundeName ? `: ${kundeName}` : ''}. Jetzt Artikel suchen (Nummer oder Name) und auswählen.`
      );
    } else {
      await ctx.reply(
        `✅ Kunde gesetzt${kundeName ? `: ${kundeName}` : ''}.`
      );
    }
  } catch (e: any) {
    await ctx.reply(
      `❌ Konnte Kundenwahl nicht übernehmen: ${e?.message || e}`
    );
  }
});

export function initTelegramBot() {
  bot.launch(); // Long-Polling (für Produktion ggf. auf Webhook umstellen)
  console.log("🤖 Telegram-Bot gestartet");
}

bot.action(/^pick_article:(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id as number;
    const session = state.get(chatId) || {};
    const id = ctx.match[1];
    let artikelName: string | undefined;
    if (session?.preisFlow?.artikelChoices && Array.isArray(session.preisFlow.artikelChoices)) {
      const hit = session.preisFlow.artikelChoices.find((c: any) => String(c.id) === String(id));
      if (hit) artikelName = hit.name;
    }
    const pf = { ...(session.preisFlow || {}), artikelId: id, artikelName, artikelChoices: undefined };
    state.set(chatId, { ...session, preisFlow: pf });
    await ctx.reply(`✅ Artikel gesetzt${artikelName ? `: ${artikelName}` : ''}. Bitte gewünschten *Gesamtpreis* senden, z. B. 12.99`);
  } catch (e: any) {
    await ctx.reply(`❌ Konnte Artikelauswahl nicht übernehmen: ${e?.message || e}`);
  }
});

bot.command("status", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  const s = state.get(chatId) || {};
  const summary = renderSummary(s.kunde, s.datum, s.items || []);
  const missing: string[] = [];
  if (!s.kundeId && !s.kunde) missing.push("Kundennamen wählen/senden");
  if (!s.datum) missing.push("Datum");
  if (!s.items || !Array.isArray(s.items) || s.items.length === 0) missing.push("Positionen");
  await ctx.reply((missing.length ? `🔎 Es fehlt noch: ${missing.join(" · ")}\n\n` : "") + summary);
});

bot.command("cancel", async (ctx) => {
  const chatId = ctx.chat?.id as number;
  const s = state.get(chatId) || {};
  if (s.mode || s.preisFlow) {
    const { mode, preisFlow, ...rest } = s;
    state.set(chatId, rest);
    return ctx.reply("✅ Aktueller Modus beendet. Du kannst normal weitermachen.");
  }
  return ctx.reply("Es läuft gerade kein spezieller Modus.");
});