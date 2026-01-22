export type MitarbeiterResource = {
  id?: string;
  name: string;
  email?: string;
  telefon?: string;
  abteilung?: string;
  rollen: MitarbeiterRolle[];
  aktiv?: boolean;
  bemerkung?: string;
  eintrittsdatum?: string;
  password?: string;
};

export type MitarbeiterRolle =
  | "admin"
  | "verkauf"
  | "kommissionierung"
  | "kontrolle"
  | "buchhaltung"
  | "wareneingang"
  | "lager"
  | "fahrer"
  | "zerleger"
  | "statistik"
  | "kunde"
  | "support";

export type KundeResource = {
  id?: string;
  name: string;
  kundenNummer?: string;
  password?: string;
  email?: string;
  adresse?: string;
  land?: string; // Land des Kunden (für MwSt-Berechnung, Standard: "Deutschland")
  telefon?: string;
  updatedAt?: string;
  lieferzeit?: string;
  ustId?: string;
  handelsregisterNr?: string;
  ansprechpartner?: string;
  website?: string;
  branchenInfo?: string;
  region?: string;
  kategorie?: string;
  isApproved: boolean;
  gewerbeDateiUrl?: string;
  zusatzDateiUrl?: string;
  // E-Mail-Empfänger für automatische Belegversand-Workflows
  emailRechnung?: string;
  emailLieferschein?: string;
  emailBuchhaltung?: string;
  emailSpedition?: string;
  bestimmteArtikel?: string[]; // erlaubte/bestimmte Artikel (ObjectIds als Strings)
  fehlmengenBenachrichtigung?: boolean; // Opt-in für Fehlmengen-Email
};

export type AuftragResource = {
  id?: string;
  auftragsnummer: string;
  kunde: string; // ID des Kunden
  kundeName?: string;
  artikelPosition: string[]; // Array von IDs der Artikelpositionen
  status: "offen" | "in Bearbeitung" | "abgeschlossen" | "storniert";
  lieferdatum?: string; // ISO-Datum als String, optional
  bemerkungen?: string; // Optionale Bemerkungen
  bearbeiter?: string;
  gewicht?: number;
  preis?: number;
  kontrolliertAm?: string;
  gesamtPaletten?: number;
  gesamtBoxen?: number;
  kommissioniertVon?: string;
  kommissioniertVonName?: string;
  kontrolliertVon?: string;
  kontrolliertVonName?: string;
  kommissioniertStatus?: "offen" | "gestartet" | "fertig";
  kontrolliertStatus?: "offen" | "in Kontrolle" | "geprüft";
  kommissioniertStartzeit?: string;
  kommissioniertEndzeit?: string;
  kontrolliertZeit?: string;
  createdAt?: string;
  updatedAt?: string;
  tourId?: string;
  tourStopId?: string;

  // ==== Belegwesen (Phase 4) ====
  lieferscheinNummer?: string;
  rechnungsNummer?: string;
  gutschriftNummern?: string[];        // mehrere Gutschriften möglich
  preisdifferenzNummern?: string[];    // mehrere Preisdifferenzen möglich

  zahlstatus?: Zahlstatus;             // offen | teilweise | bezahlt
  offenBetrag?: number;                // offener Betrag in EUR
  zahlungsDatum?: string;              // ISO-Datum, wenn bezahlt

  belegListe?: BelegResource[];        // nicht persistente Metadaten zu erzeugten Belegen
  emailLogs?: EmailLogResource[];      // Versand-Historie
};

export type ArtikelPositionResource = {
  id?: string; // Eindeutige ID der Position
  artikel: string; // ID des Artikels (als String)
  auftragId?: string;
  artikelName?: string;
  artikelNummer?: string;
  menge: number; // Menge des Artikels
  einheit: "kg" | "stück" | "kiste" | "karton"; // Einheit der Menge
  einzelpreis: number; // Preis pro Gewichtseinheit für den Kunden
  zerlegung?: boolean; // Optionale Angabe, ob eine Zerlegung erfolgt
  vakuum?: boolean; // Optionale Angabe, ob das Produkt vakuumverpackt ist
  bemerkung?: string; // Optionale Bemerkungen
  zerlegeBemerkung?: string;
  gesamtgewicht: number; // Berechnetes Gesamtgewicht
  gesamtpreis: number; // Berechneter Gesamtpreis
  kommissioniertMenge?: number;
  kommissioniertEinheit?: string;
  kommissioniertBemerkung?: string;
  kommissioniertVon?: string;
  kommissioniertVonName?: string;
  kommissioniertAm?: Date;
  bruttogewicht?: number;
  leergut?: {
    leergutArt: string;
    leergutAnzahl: number;
    leergutGewicht: number;
  }[];
  nettogewicht?: number;
  chargennummern?: string[];
  erfassungsModus?: "GEWICHT" | "KARTON" | "STÜCK";
  leergutVonPositionId?: string;
};

export type ArtikelResource = {
  id?: string; // Eindeutige ID des Artikels
  bildUrl?: string;
  preis: number; // Standardpreis des Artikels
  artikelNummer: string; // Artikelnummer
  name: string; // Artikelnummer
  kategorie: string;
  gewichtProStueck?: number; // Gewicht pro Stück (optional, falls nicht immer angegeben)
  gewichtProKarton?: number; // Gewicht pro Karton (optional)
  gewichtProKiste?: number; // Gewicht pro Kiste (optional)
  ausverkauft?: boolean;
  erfassungsModus?: "GEWICHT" | "KARTON" | "STÜCK";
};

export type LoginResource = {
  id: string;
  role: MitarbeiterRolle[];
  /** Expiration time in seconds since 1.1.1970 */
  exp: number;
};

export type KundenPreisResource = {
  id?: string; // Eindeutige ID
  artikel: string; // ID des Artikels als String
  customer: string; // ID des Kunden als String
  aufpreis: number; // Aufpreis für diesen Kunden
};

// ===== Belegwesen: Enums & Ressourcen =====
export type Zahlstatus = "offen" | "teilweise" | "bezahlt";

export type BelegTyp =
  | "lieferschein"
  | "rechnung"
  | "gutschrift"
  | "preisdifferenz"
  | "auftragsbestaetigung";

export type BelegResource = {
  id?: string;
  typ: BelegTyp;                 // Art des Belegs
  nummer?: string;               // fortlaufende Nummer (falls vergeben)
  datum?: string;                // ISO-String
  betrag?: number;               // Gesamtbetrag (falls vorhanden)
  status?: "entwurf" | "final"; // Dokumentstatus
  pdfGeneriert?: boolean;        // wurde ein PDF erzeugt
  referenzBelegNummer?: string;  // z. B. Bezug auf Rechnung bei Gutschrift/Preisdifferenz
};

export type EmailLogResource = {
  id?: string;
  auftragId: string;
  belegTyp: BelegTyp;
  belegNummer?: string;
  empfaenger: string[];          // To
  cc?: string[];
  bcc?: string[];
  betreff?: string;
  status: "geplant" | "gesendet" | "fehlgeschlagen";
  fehler?: string;
  gesendetAm?: string;           // ISO-String
  messageId?: string;            // Provider-Nachweis
};

export type ZerlegeArtikelPosition = {
  artikelPositionId: string;
  artikelName: string;
  status: "offen" | "erledigt";
  menge?: number;
  bemerkung?: string;
  erledigtAm?: string;
};

export type ZerlegeauftragResource = {
  id?: string;
  auftragId: string;
  auftragsnummer: string;
  kundenName: string;
  artikelPositionen: ZerlegeArtikelPosition[];
  zerlegerId?: string;
  zerlegerName?: string;
  erstelltAm: string;
  archiviert: boolean;
};

// ===== Tourplanung: Enums & neue Ressourcen =====

export type TourStatus = "geplant" | "laufend" | "abgeschlossen" | "archiviert";
export type StopStatus = "offen" | "unterwegs" | "zugestellt" | "teilweise" | "fehlgeschlagen";

export type FehlgrundEnum =
  | "KUNDE_NICHT_ERREICHBAR"
  | "ANNAHME_VERWEIGERT"
  | "FALSCH_ADRESSE"
  | "NICHT_RECHTZEITIG"
  | "WARE_BESCHAEDIGT"
  | "SONSTIGES";

export type FahrzeugResource = {
  id?: string;
  kennzeichen: string;
  name?: string;
  maxGewichtKg: number;
  aktiv: boolean;
  regionen?: string[];        // optionale Einsatzgebiete (Freitext)
  samsaraVehicleId?: string;  // optionales Mapping zu Samsara
  bemerkung?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TourResource = {
  id?: string;
  datum: Date;                 // als Date gespeichert
  datumIso?: string;           // zusätzlich als YYYY-MM-DD String für Filter
  region: string;             // Freitext (normalisiert)
  name?: string;              // z. B. "Berlin #2"
  fahrzeugId?: string;        // Verweis auf FahrzeugResource.id
  fahrerId?: string;          // Verweis auf MitarbeiterResource.id (rolle: "fahrer")
  maxGewichtKg?: number;      // wenn leer -> vom Fahrzeug übernehmen (UI-Anzeige)
  belegtesGewichtKg: number;  // vom Server berechnet
  status: TourStatus;
  reihenfolgeVorlageId?: string;
  isStandard?: boolean;       // Vorschlagstour pro Tag/Region
  overCapacityFlag?: boolean; // nur für UI-Warnung (kein Server-Block)
  parentTourId?: string;      // bei Tour-Split: Parent-Verweis
  splitIndex?: number;        // 1..N (Sortierhilfe bei Splits)
  archiviertAm?: string;      // gesetzt bei Archivierung
  createdAt?: string;
  updatedAt?: string;
};

export type TourStopResource = {
  id?: string;
  tourId: string;             // Verweis auf TourResource.id
  auftragId: string;          // Verweis auf AuftragResource.id (1 Auftrag = 1 Stop)
  kundeId: string;            // denormalisiert für schnelle Customer-Sicht
  kundeName?: string;
  kundeAdress?: string;
  position: number;           // Reihenfolge in der Tour (1..n)
  gewichtKg?: number;         // Summe aus Auftrag (Fallback)
  status: StopStatus;
  fehlgrund?: {               // Katalog + Freitext
    code?: FehlgrundEnum;
    text?: string;
  };
  // Rechtlich relevanter Zustellnachweis (ohne Fotos):
  signaturPngBase64?: string; // digitale Unterschrift als Base64-PNG
  signTimestampUtc?: string;  // Server-Zeitstempel (UTC)
  signedByName?: string;      // Name des Unterzeichners (Freitext)

  // Leergut-Mitnahme auf Stop-Ebene (separat von artikelbezogenem Leergut):
  leergutMitnahme?: {
    art: string;
    anzahl: number;
    gewichtKg?: number;
  }[];

  bemerkung?: string;         // Anweisungen/Bemerkungen für Fahrer (Talimat)
  abgeschlossenAm?: string;
  updatedAt?: string;
};

export type ReihenfolgeVorlageResource = {
  id?: string;
  region: string;             // Freitext
  name: string;               // z. B. "Berlin Nord-Ost"
  kundenIdsInReihenfolge: string[]; // Kunden-IDs in fixierter Reihenfolge
  createdAt?: string;
  updatedAt?: string;
};

export type RegionRuleResource = {
  id?: string;
  region: string;             // Freitext, wie in KundeResource.region
  allowedWeekdays: number[];  // 1=Mo ... 7=So
  orderCutoff?: string;       // "HH:mm" (Europe/Berlin)
  exceptionDates?: string[];  // ISO YYYY-MM-DD
  isActive: boolean;
};

export type TourSplitLog = {
  id?: string;
  parentTourId: string;
  childTourIds: string[];
  createdAt: string;
  createdBy: string;          // Mitarbeiter-ID
  mode: "plz_bucket" | "capacity" | "round_robin";
  note?: string;
};

// ===== Bestandsmodul: neue Ressourcen & Enums =====

// Lagerbereiche: aktuell nur TK / Nicht-TK
export type Lagerbereich = "TK" | "NON_TK";

// Charge (Chargenstammdaten)
export type ChargeResource = {
  id?: string;
  artikelId: string;            // Verweis auf ArtikelResource.id
  // Denormalisierte Felder für Klarheit
  artikelName?: string;
  artikelNummer?: string;
  lieferantId?: string;         // optionaler Verweis auf Lieferant
  mhd: string;                  // ISO-Datum YYYY-MM-DD
  schlachtDatum?: string;       // ISO-Datum
  isTK: boolean;                // muss zum Lagerbereich passen (nur Warnung)
  createdAt?: string;
  updatedAt?: string;
};

// Reservierungen (nicht chargengebunden, Charge erst bei Kommissionierung)
export type ReservierungStatus = "AKTIV" | "ERFUELLT" | "AUFGELOEST";

export type ReservierungResource = {
  id?: string;
  artikelId: string;            // Verweis auf ArtikelResource.id
  // Denormalisierte Felder für Klarheit
  artikelName?: string;
  artikelNummer?: string;
  kundeName?: string;
  lieferDatumText?: string;
  chargeId?: string;            // optional, falls vorgebunden
  auftragId: string;            // Verweis auf AuftragResource.id
  lieferDatum: string;          // ISO-Datum
  menge: number;                // reservierte Menge
  status: ReservierungStatus;
  createdAt?: string;
  createdBy?: string;           // Mitarbeiter-ID
};

// Anlieferung (Unterwegs)
export type AnlieferungStatus = "ANGEKUENDIGT" | "TEILGELIEFERT" | "ERLEDIGT";

export type AnlieferungResource = {
  id?: string;
  artikelId: string;            // Verweis auf ArtikelResource.id
  // Denormalisierte Felder für Klarheit
  artikelName?: string;
  artikelNummer?: string;
  lieferantName?: string;
  chargeId?: string;            // falls bereits bekannt/angelegt
  lieferantId?: string;
  erwartetAm: string;           // ISO-Datum
  menge: number;
  status: AnlieferungStatus;
  createdAt?: string;
  createdBy?: string;           // Mitarbeiter-ID
};

// Bewegungsjournal (Single Source of Truth)
export type BewegungsTyp =
  | "WARENEINGANG"
  | "WARENAUSGANG"
  | "RESERVIERUNG"
  | "RESERVIERUNG_AUFLOESEN"
  | "KOMMISSIONIERUNG"
  | "MULL"
  | "INVENTUR_KORREKTUR"
  | "UMBUCHUNG_HIN"
  | "UMBUCHUNG_WEG"
  | "RUECKLIEFERUNG_KUNDE"
  | "RUECKLIEFERUNG_LIEFERANT"
  | "ANLIEFERUNG_ERFASST"
  | "ANLIEFERUNG_ERLEDIGT";

export type BewegungResource = {
  id?: string;
  timestamp: string;            // ISO-String mit Uhrzeit
  userId?: string;              // Mitarbeiter-ID, der die Buchung ausgelöst hat
  typ: BewegungsTyp;
  artikelId: string;
  // Denormalisierte Felder für Klarheit
  artikelName?: string;
  artikelNummer?: string;
  kundeName?: string;
  lieferDatum?: string;
  chargeId?: string;            // z. B. bei Abgang/Kommissionierung
  menge: number;                // positiv/negativ wird aus Typ abgeleitet
  lagerbereich: Lagerbereich;   // "TK" | "NON_TK"
  auftragId?: string;           // Belegbezüge
  lieferscheinId?: string;
  gutschriftId?: string;
  notiz?: string;
  // optionale Metadaten (insb. bei Eingängen/Zerlegungserzeugnissen)
  mhd?: string;
  schlachtDatum?: string;
  isTK?: boolean;
};

// Materialisierte Sicht für schnelle Abfragen in der UI
export type BestandAggResource = {
  id?: string;
  artikelId: string;
  // Denormalisierte Felder für Klarheit
  artikelName?: string;
  artikelNummer?: string;
  chargeId?: string;
  lagerbereich: Lagerbereich;
  verfuegbar: number;           // physisch verfügbar
  reserviert: number;           // insgesamt reserviert (summe aller Reservierungen)
  unterwegs: number;            // noch nicht eingetroffen
  updatedAt?: string;
};
