import express, { Request, Response, NextFunction } from "express";
import { body, param, validationResult } from "express-validator";
import jwt from "jsonwebtoken";
import {
  createArtikelPosition,
  getArtikelPositionById,
  getAllArtikelPositionen,
  updateArtikelPosition,
  deleteArtikelPosition,
} from "../services/ArtikelPositionService"; // Pfad ggf. anpassen
import { LoginResource } from "../Resources"; // Pfad ggf. anpassen
import { ArtikelPosition } from "../model/ArtikelPositionModel";
import { getAllArtikel, getAllArtikelClean } from "../services/ArtikelService";

const artikelPositionRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// Typdefinition für authentifizierte Requests
interface AuthRequest extends Request {
  user?: LoginResource;
}

// Middleware: Authentifizierung mittels JWT
const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Kein Token vorhanden" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as LoginResource;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Ungültiges Token" });
  }
};

// Middleware: Validierungsergebnisse prüfen
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/* -------------------------------
   Routen für ArtikelPosition
---------------------------------*/

/**
 * POST /artikelposition
 * Erstellt eine neue Artikelposition.
 */
artikelPositionRouter.post(
  "/",
  authenticate,
  [
    body("artikel")
      .optional()
      .isString()
      .trim()
      .withMessage("Artikel-ID ist erforderlich")
      .isMongoId()
      .withMessage("Ungültige Artikel-ID"),
    body("menge")
      .optional()
      .isNumeric()
      .withMessage("Menge muss eine Zahl sein"),
    body("einheit")
      .optional()
      .isString()
      .trim()
      .withMessage("Einheit ist erforderlich")
      .isIn(["kg", "stück", "kiste", "karton"])
      .withMessage("Ungültige Einheit"),
    body("einzelpreis")
      .optional()
      .isNumeric()
      .withMessage("Einzelpreis muss eine Zahl sein"),
    body("zerlegung")
      .optional()
      .isBoolean()
      .withMessage("Zerlegung muss ein Boolean sein"),
    body("vakuum")
      .optional()
      .isBoolean()
      .withMessage("Vakuum muss ein Boolean sein"),
    body("bemerkung").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await createArtikelPosition(req.body);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /artikelposition
 * Ruft alle Artikelpositionen ab.
 */
artikelPositionRouter.get(
  "/",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getAllArtikelPositionen();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

artikelPositionRouter.get("/asad", authenticate, async (req: AuthRequest, res: Response) => {
  const start = Date.now();
  const isAdminUser = req.user?.role === "a";
  const kundeId = isAdminUser
    ? req.query.kunde?.toString() ?? req.user?.id
    : req.user?.id;
  await getAllArtikel(kundeId);
  console.log("Dauer:", Date.now() - start, "ms");
});

/**
 * GET /artikelposition/:id
 * Ruft eine einzelne Artikelposition anhand der ID ab.
 */
artikelPositionRouter.get(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ArtikelPosition-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await getArtikelPositionById(req.params.id);
      res.json(result);
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  }
);

/**
 * PUT /artikelposition/:id
 * Aktualisiert eine Artikelposition.
 */
artikelPositionRouter.put(
  "/:id",
  authenticate,
  [
    param("id").isMongoId().withMessage("Ungültige ArtikelPosition-ID"),
    body("artikel")
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Artikel-ID muss ein nicht leerer String sein")
      .isMongoId()
      .withMessage("Ungültige Artikel-ID"),
    body("menge")
      .optional()
      .isNumeric()
      .withMessage("Menge muss eine Zahl sein"),
    body("einzelpreis")
      .optional()
      .isNumeric()
      .withMessage("Einzelpreis muss eine Zahl sein"),
    body("einheit")
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage("Einheit muss ein nicht leerer String sein")
      .isIn(["kg", "stück", "kiste", "karton"])
      .withMessage("Ungültige Einheit"),
    body("zerlegung")
      .optional()
      .isBoolean()
      .withMessage("Zerlegung muss ein Boolean sein"),
    body("vakuum")
      .optional()
      .isBoolean()
      .withMessage("Vakuum muss ein Boolean sein"),
    body("bemerkung").optional().isString().trim(),
  ],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await updateArtikelPosition(req.params.id, req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /artikelposition/:id
 * Löscht eine Artikelposition.
 */
artikelPositionRouter.delete(
  "/:id",
  authenticate,
  [param("id").isMongoId().withMessage("Ungültige ArtikelPosition-ID")],
  validate,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteArtikelPosition(req.params.id);
      res.json({ message: "Artikelposition gelöscht" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

export default artikelPositionRouter;
