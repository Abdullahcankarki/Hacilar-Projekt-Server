/**
 * FehlmengenScheduler.ts
 *
 * Verwaltet die verzögerte Fehlmengen-Benachrichtigung.
 * - Sammelt Fehlmengen pro Auftrag
 * - Sendet 1 Stunde nach der letzten Kommissionierung die E-Mail
 */

import { Auftrag } from "../model/AuftragModel";
import { Kunde } from "../model/KundeModel";
import { sendFehlmengenEmail } from "./EmailService";
import { generateBelegPdf } from "./BelegService";

// Speicher für ausstehende Fehlmengen-Benachrichtigungen
// Key: auftragId, Value: { timer, positionen }
interface FehlmengenEntry {
  timer: NodeJS.Timeout;
  positionen: Array<{
    positionId: string;
    artikelName: string;
    bestellteMenge: number;
    gelieferteMenge: number;
    einheit: string;
    differenz: number;
  }>;
}

const pendingNotifications = new Map<string, FehlmengenEntry>();

// Verzögerung: 1 Stunde in Millisekunden
const DELAY_MS = 60 * 60 * 1000; // 1 Stunde

/**
 * Prüft ob eine Fehlmenge vorliegt (30% Abweichung)
 * @param bestellteMenge - ursprünglich bestellte Menge
 * @param gelieferteMenge - tatsächlich kommissionierte Menge (kommissioniertMenge oder nettogewicht)
 * @returns true wenn Fehlmenge > 30%
 */
export function hasFehlmenge(bestellteMenge: number, gelieferteMenge: number): boolean {
  if (bestellteMenge <= 0) return false;
  const differenz = bestellteMenge - gelieferteMenge;
  const prozent = (differenz / bestellteMenge) * 100;
  return prozent >= 30;
}

/**
 * Registriert eine Fehlmenge für einen Auftrag.
 * Startet/resettet den Timer für die E-Mail-Benachrichtigung.
 */
export async function registerFehlmenge(
  auftragId: string,
  positionId: string,
  artikelName: string,
  bestellteMenge: number,
  gelieferteMenge: number,
  einheit: string
): Promise<void> {
  const differenz = bestellteMenge - gelieferteMenge;

  // Prüfe ob Auftrag existiert und Kunde die Benachrichtigung aktiviert hat
  const auftrag = await Auftrag.findById(auftragId);
  if (!auftrag) return;

  const kunde = await Kunde.findById(auftrag.kunde);
  if (!kunde) return;

  // Prüfe ob Kunde die Fehlmengen-Benachrichtigung aktiviert hat
  if (!kunde.fehlmengenBenachrichtigung) return;

  const positionData = {
    positionId,
    artikelName,
    bestellteMenge,
    gelieferteMenge,
    einheit,
    differenz,
  };

  // Bestehenden Timer löschen falls vorhanden
  const existing = pendingNotifications.get(auftragId);
  if (existing) {
    clearTimeout(existing.timer);

    // Position aktualisieren oder hinzufügen
    const idx = existing.positionen.findIndex(p => p.positionId === positionId);
    if (idx >= 0) {
      existing.positionen[idx] = positionData;
    } else {
      existing.positionen.push(positionData);
    }

    // Neuen Timer starten
    existing.timer = setTimeout(() => sendFehlmengenNotification(auftragId), DELAY_MS);
  } else {
    // Neuen Eintrag erstellen
    const timer = setTimeout(() => sendFehlmengenNotification(auftragId), DELAY_MS);
    pendingNotifications.set(auftragId, {
      timer,
      positionen: [positionData],
    });
  }
}

/**
 * Entfernt eine Position aus der Fehlmengen-Liste
 * (z.B. wenn die Menge korrigiert wurde)
 */
export function removeFehlmenge(auftragId: string, positionId: string): void {
  const existing = pendingNotifications.get(auftragId);
  if (!existing) return;

  existing.positionen = existing.positionen.filter(p => p.positionId !== positionId);

  if (existing.positionen.length === 0) {
    // Keine Fehlmengen mehr → Timer abbrechen
    clearTimeout(existing.timer);
    pendingNotifications.delete(auftragId);
  }
}

/**
 * Sendet die Fehlmengen-Benachrichtigung
 */
async function sendFehlmengenNotification(auftragId: string): Promise<void> {
  const entry = pendingNotifications.get(auftragId);
  if (!entry || entry.positionen.length === 0) {
    pendingNotifications.delete(auftragId);
    return;
  }

  try {
    const auftrag = await Auftrag.findById(auftragId);
    if (!auftrag) {
      pendingNotifications.delete(auftragId);
      return;
    }

    const kunde = await Kunde.findById(auftrag.kunde);
    if (!kunde || !kunde.email) {
      pendingNotifications.delete(auftragId);
      return;
    }

    // Nochmal prüfen ob Kunde die Benachrichtigung noch aktiviert hat
    if (!kunde.fehlmengenBenachrichtigung) {
      pendingNotifications.delete(auftragId);
      return;
    }

    // Lieferschein-PDF generieren
    const pdfBuffer = await generateBelegPdf(auftragId, "lieferschein");

    // E-Mail senden
    await sendFehlmengenEmail({
      kundenEmail: kunde.email,
      kundenName: kunde.name,
      auftragNummer: auftrag.auftragsnummer,
      positionen: entry.positionen.map(p => ({
        artikelName: p.artikelName,
        bestellteMenge: p.bestellteMenge,
        gelieferteMenge: p.gelieferteMenge,
        einheit: p.einheit,
        differenz: p.differenz,
      })),
      pdfBuffer,
    });
  } catch {
    // Fehler beim Senden ignorieren
  } finally {
    pendingNotifications.delete(auftragId);
  }
}

/**
 * Gibt die Anzahl ausstehender Benachrichtigungen zurück (für Debugging/Monitoring)
 */
export function getPendingCount(): number {
  return pendingNotifications.size;
}

/**
 * Löscht alle ausstehenden Benachrichtigungen (für Tests/Shutdown)
 */
export function clearAll(): void {
  for (const [, entry] of pendingNotifications) {
    clearTimeout(entry.timer);
  }
  pendingNotifications.clear();
}
