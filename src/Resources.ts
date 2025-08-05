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
};

export type ArtikelPositionResource = {
  id?: string; // Eindeutige ID der Position
  artikel: string; // ID des Artikels (als String)
  artikelName?: string;
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
