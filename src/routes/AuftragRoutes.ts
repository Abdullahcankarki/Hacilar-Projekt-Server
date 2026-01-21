import express, { Request, Response, NextFunction } from "express";
import { body, param, query, validationResult } from "express-validator";
import jwt from "jsonwebtoken";
import {
  createAuftrag,
  getAuftragById,
  getAllAuftraege,
  updateAuftrag,
  deleteAuftrag,
  getAuftraegeByCustomerId,
  getLetzterAuftragMitPositionenByKundenId,
  getLetzterArtikelFromAuftragByKundenId,
  deleteAllAuftraege,
  deleteMultipleAuftraege,
  getAlleAuftraegeInBearbeitung,
  setAuftragInBearbeitung,
  getTourInfosForAuftraege,
  createAuftragQuick,
  getBestellteArtikelAggregiert,
  setAuftragInFertig,
} from "../services/AuftragService"; // Passe den Pfad ggf. an
import { LoginResource } from "../Resources"; // Passe den Pfad ggf. an

const auftragRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Typdefinition für authentifizierte Requests
interface AuthRequest extends Request {
  user?: LoginResource;
}

// Middleware: Authentifizierung anhand des JWT-Tokens
const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Kein Token vorhanden" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.id,
      role: decoded.role,
      exp: decoded.exp,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Ungültiges Token" });
  }
};

// Middleware: Prüft die Validierungsergebnisse
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/* -------------------------------
   Hilfsfunktion canViewAuftrag
---------------------------------*/
const canViewAuftrag = (user: LoginResource, auftrag: any): boolean => {
  const heute = new Date();
  const morgen = new Date();
  morgen.setDate(heute.getDate() + 1);
  const lieferdatum = new Date(auftrag.lieferdatum);

  if (!user.role) {
    return false;
  }

  if (
    user.role.includes("admin") ||
    user.role.includes("buchhaltung") ||
    user.role.includes("statistik") ||
    user.role.includes("support")
  ) {
    return true;
  }
  if (user.role.includes("kommissionierung")) {
    return (
      lieferdatum.toDateString() === heute.toDateString() ||
      lieferdatum.toDateString() === morgen.toDateString()
    );
  }
  if (user.role.includes("fahrer")) {
    return lieferdatum.toDateString() === heute.toDateString();
  }
  if (user.role.includes("kunde")) {
    return auftrag.kunde === user.id;
  }
  return false;
};

/* -------------------------------
   Routen für Aufträge
---------------------------------*/

/**
 * POST /auftraege
 * Erstellt einen neuen Auftrag.
 * Falls der angemeldete Nutzer kein Admin ist, muss das Feld "kunde" mit der eigenen ID übereinstimmen.
 */
auftragRouter.post(
  "/",
  authenticate,
  [
    body("kunde")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Kunde ist erforderlich")
      .isMongoId()
      .withMessage("Ungültige Kunde-ID"),
    body("artikelPosition")
      .isArray({ min: 0 })
      .withMessage(
        "ArtikelPosition muss ein Array mit mindestens einem Eintrag sein"
      ),
    body("artikelPosition.*")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Jeder Eintrag in ArtikelPosition muss eine gültige ID sein")
      .isMongoId()
      .withMessage("Ungültige ArtikelPosition-ID"),
    body("status")
      .optional()
      .isIn(["offen", "in Bearbeitung", "abgeschlossen", "storniert"])
      .withMessage("Ungültiger Status"),
    body("lieferdatum")
      .optional()
      .isISO8601()
      .withMessage("Lieferdatum muss ein gültiges Datum sein"),
    body("bemerkungen").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Falls der User kein Admin ist, darf das angegebene Kunde-Feld nur die eigene ID enthalten
      if (
        !req.user?.role.includes("admin") &&
        req.body.kunde !== req.user?.id
      ) {
        return res
          .status(403)
          .json({ error: "Zugriff verweigert: Kunde stimmt nicht überein" });
      }
      const result = await createAuftrag(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /auftraege/quick
 * Erstellt einen Auftrag aus vereinfachter Eingabe (z. B. Telegram/PWA 3‑Zeilen-Format)
 * Body:
 *   {
 *     kundeId?: string;           // alternativ zu kundeName
 *     kundeName?: string;         // z. B. "Has Food B.V"
 *     lieferdatum?: string;       // YYYY-MM-DD
 *     bemerkungen?: string;
 *     items: { artikelNr?: string; name?: string; menge: number; einheit?: string }[];
 *   }
 * Erlaubte Rollen: admin, kommissionierung, verkauf
 */
auftragRouter.post(
  "/quick",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const roles = req.user?.role;
      const allowed = Array.isArray(roles)
        ? roles.includes("admin") ||
          roles.includes("kommissionierung") ||
          roles.includes("verkauf")
        : roles === "admin" ||
          roles === "kommissionierung" ||
          roles === "verkauf";
      if (!allowed) return res.status(403).json({ error: "Forbidden" });

      const { kundeId, kundeName, lieferdatum, bemerkungen, items } =
        req.body || {};

      const friendlyErrors: string[] = [];
      if (!kundeId && !(typeof kundeName === "string" && kundeName.trim())) {
        friendlyErrors.push(
          "❌ Kunde fehlt. Bitte Kundennamen oder kundeId angeben."
        );
      }
      if (!Array.isArray(items) || items.length === 0) {
        friendlyErrors.push(
          "❌ Keine Positionen übergeben. Bitte mindestens eine Artikelzeile angeben."
        );
      }

      if (Array.isArray(items)) {
        items.forEach((it: any, i: number) => {
          const n = i + 1;
          if (!it || (!it.name && !it.artikelNr)) {
            friendlyErrors.push(
              `❌ Position ${n}: Bitte Artikelname oder artikelNr angeben.`
            );
          }
          if (
            typeof it?.menge !== "number" ||
            !isFinite(it.menge) ||
            it.menge <= 0
          ) {
            friendlyErrors.push(
              `❌ Position ${n}: Menge muss eine Zahl > 0 sein.`
            );
          }
          if (it?.einheit && typeof it.einheit !== "string") {
            friendlyErrors.push(
              `❌ Position ${n}: Einheit muss ein Text sein (z. B. "kg", "stk").`
            );
          }
        });
      }

      if (friendlyErrors.length) {
        return res.status(400).json({ error: friendlyErrors.join("\n") });
      }

      const order = await createAuftragQuick({
        kundeId,
        kundeName,
        lieferdatum,
        bemerkungen,
        items,
      });
      return res.status(201).json(order);
    } catch (error: any) {
      console.error("POST /auftraege/quick error:", {
        message: error?.message,
      });
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege
 * Ruft alle Aufträge ab.
 * Dieser Endpunkt ist ausschließlich Admins vorbehalten.
 */
auftragRouter.get(
  "/",
  authenticate,
  [
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1 }).toInt(),
    query("status")
      .optional()
      .isIn(["offen", "in Bearbeitung", "abgeschlossen", "storniert"]),
    query("statusIn").optional().isString(), // comma-separated
    query("kunde").optional().isMongoId(),
    query("auftragsnummer").optional().isString(),
    query("q").optional().isString(),
    query("lieferdatumVon").optional().isISO8601(),
    query("lieferdatumBis").optional().isISO8601(),
    query("createdVon").optional().isISO8601(),
    query("createdBis").optional().isISO8601(),
    query("updatedVon").optional().isISO8601(),
    query("updatedBis").optional().isISO8601(),
    query("kommissioniertStatus")
      .optional()
      .isIn(["offen", "gestartet", "fertig"]),
    query("kontrolliertStatus").optional().isIn(["offen", "geprüft"]),
    query("bearbeiter").optional().isString(),
    query("kommissioniertVon").optional().isMongoId(),
    query("kontrolliertVon").optional().isMongoId(),
    query("hasTour").optional().isBoolean().toBoolean(),
    query("sort")
      .optional()
      .isIn([
        "createdAtDesc",
        "createdAtAsc",
        "updatedAtDesc",
        "updatedAtAsc",
        "lieferdatumAsc",
        "lieferdatumDesc",
        "auftragsnummerAsc",
        "auftragsnummerDesc",
      ]),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user?.role.includes("admin")) {
        return res
          .status(403)
          .json({ error: "Nur Admins können alle Aufträge abrufen" });
      }

      const {
        page,
        limit,
        status,
        statusIn,
        kunde,
        auftragsnummer,
        q,
        lieferdatumVon,
        lieferdatumBis,
        createdVon,
        createdBis,
        updatedVon,
        updatedBis,
        kommissioniertStatus,
        kontrolliertStatus,
        bearbeiter,
        kommissioniertVon,
        kontrolliertVon,
        hasTour,
        sort,
      } = req.query as any;

      const params: any = {};
      if (page !== undefined) params.page = Number(page);
      if (limit !== undefined) params.limit = Number(limit);
      if (status) params.status = String(status);
      if (statusIn)
        params.statusIn = String(statusIn)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (kunde) params.kunde = String(kunde);
      if (auftragsnummer) params.auftragsnummer = String(auftragsnummer);
      if (q) params.q = String(q);
      if (lieferdatumVon) params.lieferdatumVon = String(lieferdatumVon);
      if (lieferdatumBis) params.lieferdatumBis = String(lieferdatumBis);
      if (createdVon) params.createdVon = String(createdVon);
      if (createdBis) params.createdBis = String(createdBis);
      if (updatedVon) params.updatedVon = String(updatedVon);
      if (updatedBis) params.updatedBis = String(updatedBis);
      if (kommissioniertStatus)
        params.kommissioniertStatus = String(kommissioniertStatus);
      if (kontrolliertStatus)
        params.kontrolliertStatus = String(kontrolliertStatus);
      if (bearbeiter) params.bearbeiter = String(bearbeiter);
      if (kommissioniertVon)
        params.kommissioniertVon = String(kommissioniertVon);
      if (kontrolliertVon) params.kontrolliertVon = String(kontrolliertVon);
      if (
        typeof hasTour === "boolean" ||
        hasTour === "true" ||
        hasTour === "false"
      ) {
        params.hasTour = hasTour === true || hasTour === "true";
      }
      if (sort) params.sort = String(sort);

      const result = await getAllAuftraege(params);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/in-bearbeitung
 * Gibt alle Aufträge mit Status "in Bearbeitung" zurück.
 * Nur Admins, Kommissionierer oder Kontrolle dürfen diesen Endpunkt aufrufen.
 */
auftragRouter.get(
  "/in-bearbeitung",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (
        !req.user?.role.includes("admin") &&
        !req.user?.role.includes("kommissionierung") &&
        !req.user?.role.includes("kontrolle")
      ) {
        return res
          .status(403)
          .json({ error: "Nur Admins dürfen diese Aufträge abrufen" });
      }
      const result = await getAlleAuftraegeInBearbeitung(
        req.user?.id,
        req.user?.role.includes("kommissionierung")
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/in-bearbeitung/tour-infos
 * Liefert Tour-Infos (Mapping) für genau die Aufträge, die der Benutzer unter /in-bearbeitung sehen darf.
 * Erlaubte Rollen: admin, kommissionierung, kontrolle
 */
auftragRouter.get(
  "/in-bearbeitung/tour-infos",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (
        !req.user?.role.includes("admin") &&
        !req.user?.role.includes("kommissionierung") &&
        !req.user?.role.includes("kontrolle")
      ) {
        return res
          .status(403)
          .json({
            error:
              "Nur Admins/Kommissionierung/Kontrolle dürfen diese Daten abrufen",
          });
      }

      const auftraege = await getAlleAuftraegeInBearbeitung(
        req.user?.id,
        req.user?.role.includes("kommissionierung")
      );
      const ids = Array.isArray(auftraege)
        ? auftraege.map((a: any) => a.id || a._id)
        : [];
      const map = await getTourInfosForAuftraege(ids);
      return res.json(map);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/letzte
 * Gibt den letzten Auftrag des eingeloggten Kunden zurück.
 */
auftragRouter.get(
  "/letzte",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Nicht authentifiziert" });
      }

      // Admins brauchen Kunden-ID im Query-Parameter (z. B. ?kunde=xyz)
      const kundenId = user.role.includes("admin")
        ? req.query.kunde?.toString()
        : user.id;

      if (!kundenId) {
        return res.status(400).json({ error: "Kunden-ID fehlt" });
      }

      const letzterAuftrag = await getLetzterAuftragMitPositionenByKundenId(
        kundenId
      );
      if (!letzterAuftrag) {
        return res.status(404).json({ error: "Kein Auftrag gefunden" });
      }

      res.json(letzterAuftrag);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/letzte
 * Gibt den letzten Auftrag des eingeloggten Kunden zurück.
 */
auftragRouter.get(
  "/letzteArtikel",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Nicht authentifiziert" });
      }

      // Admins brauchen Kunden-ID im Query-Parameter (z. B. ?kunde=xyz)
      const kundenId = user.role.includes("admin")
        ? req.query.kunde?.toString()
        : user.id;

      if (!kundenId) {
        return res.status(400).json({ error: "Kunden-ID fehlt" });
      }

      const letzterAuftrag = await getLetzterArtikelFromAuftragByKundenId(
        kundenId
      );
      if (!letzterAuftrag) {
        return res.status(404).json({ error: "Kein Auftrag gefunden" });
      }

      res.json(letzterAuftrag);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /auftraege/tour-infos
 * Liefert ein Mapping auftragId -> { reihenfolge, kennzeichen, ... } ohne die AuftragResource zu ändern.
 * Erlaubte Rollen: admin, kommissionierung, kontrolle
 * Body: { ids: string[] }
 */
auftragRouter.post(
  "/tour-infos",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user)
        return res.status(401).json({ error: "Nicht authentifiziert" });
      const erlaubt =
        user.role.includes("admin") ||
        user.role.includes("kommissionierung") ||
        user.role.includes("kontrolle");
      if (!erlaubt) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }

      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const map = await getTourInfosForAuftraege(ids);
      return res.json(map);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);


/**
 * GET /auftraege/bestellte-artikel
 * Aggregierte Sicht auf bestellte Artikel (je nach groupBy).
 * Erlaubte Rollen: admin, buchhaltung, statistik, support
 * Query:
 *   lieferdatumVon?: YYYY-MM-DD
 *   lieferdatumBis?: YYYY-MM-DD
 *   kundenKategorie?: string
 *   kundenRegion?: string
 *   kundeName?: string
 *   artikelNr?: string
 *   artikelName?: string
 *   statusIn?: comma-separated (offen,in Bearbeitung,abgeschlossen,storniert)
 *   groupBy?: artikel | artikelKunde | artikelKundeTag (default artikel)
 *   sort?: mengeDesc|mengeAsc|preisDesc|preisAsc|artikelNameAsc|artikelNameDesc|kundeNameAsc|kundeNameDesc|lieferdatumAsc|lieferdatumDesc
 *   debug?: boolean (optional, für Debug-Ausgaben)
 */
auftragRouter.get(
  "/bestellte-artikel",
  authenticate,
  [
    query("lieferdatumVon").optional().isISO8601(),
    query("lieferdatumBis").optional().isISO8601(),
    query("kundeName").optional().isString().trim(),
    query("kundenKategorie").optional().isString().trim(),
    query("kundenRegion").optional().isString().trim(),
    query("artikelNr").optional().isString().trim(),
    query("artikelName").optional().isString().trim(),
    query("statusIn")
      .optional()
      .custom((val) => {
        if (typeof val !== "string") return false;
        const allowed = ["offen", "in Bearbeitung", "abgeschlossen", "storniert"];
        return val.split(",").map((s) => s.trim()).every((s) => !s || allowed.includes(s));
      })
      .withMessage("statusIn muss eine Komma-Liste aus offen,in Bearbeitung,abgeschlossen,storniert sein"),
    query("groupBy")
      .optional()
      .isIn(["artikel", "artikelKunde", "artikelKundeTag"])
      .withMessage("groupBy muss artikel, artikelKunde oder artikelKundeTag sein"),
    query("sort")
      .optional()
      .isIn([
        "mengeDesc",
        "mengeAsc",
        "preisDesc",
        "preisAsc",
        "artikelNameAsc",
        "artikelNameDesc",
        "kundeNameAsc",
        "kundeNameDesc",
        "lieferdatumAsc",
        "lieferdatumDesc",
      ])
      .withMessage("Ungültiger sort-Wert"),
    // Add debug validator
    query("debug").optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const roles = req.user?.role || [];
      const arr = Array.isArray(roles) ? roles : [roles];
      const allowed =
        arr.includes("admin") ||
        arr.includes("buchhaltung") ||
        arr.includes("statistik") ||
        arr.includes("support");
      if (!allowed) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }

      // Destructure debug from query
      const {
        lieferdatumVon,
        lieferdatumBis,
        kundeName,
        kundenKategorie,
        kundenRegion,
        artikelNr,
        artikelName,
        statusIn,
        groupBy,
        sort,
        debug,
      } = req.query as any;

      const params: any = {};
      if (lieferdatumVon) params.lieferdatumVon = String(lieferdatumVon);
      if (lieferdatumBis) params.lieferdatumBis = String(lieferdatumBis);
      // Hinweis: Service interpretiert 'kundeName' jetzt als Kategorie (kunde.kategorie)
      if (kundenKategorie) params.kundeName = String(kundenKategorie);
      // Legacy: Falls keine Kategorie, aber kundeName (früher Name/Nummer) übergeben wurde, weiterhin unterstützen
      else if (kundeName) params.kundeName = String(kundeName);
      // Kunden-Region (regex contains, i)
      if (kundenRegion) params.kundenRegion = String(kundenRegion);
      if (artikelNr) params.artikelNr = String(artikelNr);
      if (artikelName) params.artikelName = String(artikelName);
      if (statusIn) {
        params.statusIn = String(statusIn)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (groupBy) params.groupBy = String(groupBy);
      if (sort) params.sort = String(sort);
      // Add debug to params if present
      if (debug !== undefined) params.debug = Boolean(debug);

      // Conditional debug logging
      if (
        process.env.DEBUG_BESTELLTE_ARTIKEL === "1" ||
        debug === true ||
        debug === "true"
      ) {
        console.log("[route:/auftraege/bestellte-artikel] query:", req.query);
      }

      const data = await getBestellteArtikelAggregiert(params);
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/:id
 * Ruft einen einzelnen Auftrag anhand der ID ab.
 * Admins dürfen jeden Auftrag abrufen, Kunden nur ihre eigenen.
 */
auftragRouter.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Auftrag-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getAuftragById(req.params.id);
      // Neue Zugriffslogik laut Vorgabe, inkl. Kunde darf eigenen Auftrag sehen
      const istAdmin = req.user?.role.includes("admin");
      const istBuchhaltung = req.user?.role.includes("buchhaltung");
      const istStatistik = req.user?.role.includes("statistik");
      const istSupport = req.user?.role.includes("support");
      const istKommissionierer = req.user?.role.includes("kommissionierung");
      const istKontrolleur = req.user?.role.includes("kontrolle");
      const istFahrer = req.user?.role.includes("fahrer");
      const istKunde = req.user?.role.includes("kunde");

      const heute = new Date().toISOString().slice(0, 10);
      const lieferdatumHeute = result.lieferdatum?.slice(0, 10) === heute;

      // Zugriffsprüfung:
      if (
        !istAdmin &&
        !istBuchhaltung &&
        !istStatistik &&
        !istSupport &&
        !(
          istKommissionierer &&
          result.kommissioniertStatus === "gestartet" &&
          result.kommissioniertVon === req.user?.id
        ) &&
        !(
          istKontrolleur &&
          ((result.kontrolliertStatus === "offen" &&
            result.kommissioniertStatus === "fertig") ||
            (result.kontrolliertStatus === "in Kontrolle" &&
              result.kontrolliertVon === req.user?.id))
        ) &&
        !(istFahrer && lieferdatumHeute) &&
        !(istKunde && result.kunde === req.user?.id)
      ) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /auftraege/kunden/:id
 * Ruft einen einzelnen Auftrag anhand der ID ab.
 * Admins dürfen jeden Auftrag abrufen, Kunden nur ihre eigenen.
 */

auftragRouter.get(
  "/kunden/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Kunden-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Zugriff nur auf eigene Aufträge, außer Admin
      if (
        !req.user?.role.includes("admin") &&
        !req.user?.role.includes("buchhaltung") &&
        !req.user?.role.includes("statistik") &&
        !req.user?.role.includes("support") &&
        req.params.id !== req.user?.id
      ) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }

      const result = await getAuftraegeByCustomerId(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /auftraege/:id
 * Aktualisiert einen Auftrag.
 * Nur Admins oder der Inhaber des Auftrags dürfen Aktualisierungen vornehmen.
 */
auftragRouter.put(
  "/:id",
  authenticate,
  [
    param("id").isMongoId().withMessage("Ungültige Auftrag-ID"),
    body("kunde")
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Kunde muss ein gültiger String sein")
      .isMongoId()
      .withMessage("Ungültige Kunde-ID"),
    body("artikelPosition")
      .optional()
      .isArray({ min: 1 })
      .withMessage(
        "ArtikelPosition muss ein Array mit mindestens einem Eintrag sein"
      ),
    body("artikelPosition.*")
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Jeder ArtikelPosition-Eintrag muss eine gültige ID sein")
      .isMongoId()
      .withMessage("Ungültige ArtikelPosition-ID"),
    body("status")
      .optional()
      .isIn(["offen", "in Bearbeitung", "abgeschlossen", "storniert"])
      .withMessage("Ungültiger Status"),
    body("lieferdatum")
      .optional()
      .isISO8601()
      .withMessage("Lieferdatum muss ein gültiges Datum sein"),
    body("bemerkungen").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Neue Berechtigungslogik laut Vorgabe
      const auftrag = await getAuftragById(req.params.id);

      const istAdmin = req.user?.role.includes("admin");
      const istKommissionierer = req.user?.role.includes("kommissionierung");
      const istKontrolleur = req.user?.role.includes("kontrolle");
      const istKunde = req.user?.role.includes("kunde");

      if (!istAdmin && !istKommissionierer && !istKunde && !istKontrolleur) {
        return res.status(403).json({
          error: "Nur Admins oder Kunden dürfen Aufträge bearbeiten",
        });
      }

      if (istKunde) {
        const istEigenerAuftrag = auftrag.kunde === req.user?.id;
        const hatLieferdatum = Boolean(auftrag.lieferdatum);
        if (!istEigenerAuftrag || hatLieferdatum) {
          return res.status(403).json({
            error:
              "Kunden dürfen nur ihre eigenen Aufträge ohne gesetztes Lieferdatum bearbeiten",
          });
        }
      }

      const result = await updateAuftrag(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /auftraege/:id/in-bearbeitung
 * Setzt den Status eines Auftrags auf "in Bearbeitung" und kommissioniertStatus auf "offen".
 * Nur Admins dürfen diesen Endpunkt aufrufen.
 */
auftragRouter.put(
  "/:id/in-bearbeitung",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Auftrag-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user?.role.includes("admin")) {
        return res
          .status(403)
          .json({ error: "Nur Admin darf den Status umstellen" });
      }
      const result = await setAuftragInBearbeitung(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

auftragRouter.put(
  "/:id/fertig",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Auftrag-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await setAuftragInFertig(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

auftragRouter.delete(
  "/all",
  authenticate,
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user?.role.includes("admin")) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }
      await deleteAllAuftraege();
      res.json({ message: "Auftrag gelöscht" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /auftraege/multiple
 * Löscht mehrere Aufträge basierend auf übergebenen IDs.
 * Nur Admins dürfen diesen Vorgang ausführen.
 * Body: { ids: string[] }
 */
auftragRouter.delete(
  "/multiple",
  authenticate,
  [
    body("ids")
      .isArray({ min: 1 })
      .withMessage("IDs müssen ein Array mit mindestens einem Eintrag sein"),
    body("ids.*")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Jede ID muss ein gültiger String sein")
      .isMongoId()
      .withMessage("Ungültige Auftrag-ID"),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user?.role.includes("admin")) {
        return res.status(403).json({ error: "Zugriff verweigert" });
      }
      const { ids } = req.body;
      await deleteMultipleAuftraege(ids);
      res.json({
        message: `${ids.length} Auftrag${ids.length === 1 ? '' : 'e'} gelöscht`,
        deletedCount: ids.length
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /auftraege/:id
 * Löscht einen Auftrag.
 * Nur Admins oder der Inhaber des Auftrags dürfen diesen Vorgang ausführen.
 */
auftragRouter.delete(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige Auftrag-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      // Zunächst den Auftrag abrufen, um zu prüfen, ob er dem Nutzer gehört
      const order = await getAuftragById(req.params.id);
      if (!req.user?.role.includes("admin")) {
        return res
          .status(403)
          .json({ error: "Nur Admin darf Aufträge löschen" });
      }
      await deleteAuftrag(req.params.id);
      res.json({ message: "Auftrag gelöscht" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default auftragRouter;
