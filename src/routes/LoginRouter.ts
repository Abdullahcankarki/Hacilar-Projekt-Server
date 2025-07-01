import express, { Request, Response, NextFunction } from "express";
import { body, validationResult, ValidationError } from "express-validator";
import jwt from "jsonwebtoken";
import { loginKunde } from "../services/KundeService"; // Pfad ggf. anpassen
import { loginMitarbeiter } from "../services/MitarbeiterService"; // Pfad ggf. anpassen
import { LoginResource } from "../Resources"; // Pfad ggf. anpassen

const loginRouter = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

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

export default loginRouter;
