export type VerkaeuferResource = {
    id?: string
    name: string
    admin: boolean
    password?: string
}

export type KundeResource = {
    id?: string
    name: string
    kundenNummer: string
    password?: string
    email?: string
    adresse?: string
    telefon?: string
    updatedAt?: string
}

export type AuftragResource = {
    id?: string;
    kunde: string;                    // ID des Kunden
    kundeName?: string;
    artikelPosition: string[];        // Array von IDs der Artikelpositionen
    status: 'offen' | 'in Bearbeitung' | 'abgeschlossen' | 'storniert';
    lieferdatum?: string;             // ISO-Datum als String, optional
    bemerkungen?: string;             // Optionale Bemerkungen
    createdAt?: string;               // Erstellungsdatum als ISO-String
    updatedAt?: string;               // Aktualisierungsdatum als ISO-String
    gewicht?: number;
    preis?: number;
}

export type ArtikelPositionResource = {
    id?: string;                              // Eindeutige ID der Position
    artikel: string;                          // ID des Artikels (als String)
    artikelName?: string
    menge: number;                            // Menge des Artikels
    einheit: 'kg' | 'stück' | 'kiste' | 'karton'; // Einheit der Menge
    einzelpreis: number;                       // Preis pro Gewichtseinheit für den Kunden
    zerlegung?: boolean;                       // Optionale Angabe, ob eine Zerlegung erfolgt
    vakuum?: boolean;                          // Optionale Angabe, ob das Produkt vakuumverpackt ist
    bemerkung?: string;                        // Optionale Bemerkungen
    gesamtgewicht: number;                     // Berechnetes Gesamtgewicht
    gesamtpreis: number;                       // Berechneter Gesamtpreis
};

export type ArtikelResource = {
    id?: string;             // Eindeutige ID des Artikels
    bildUrl?: string;
    preis: number;           // Standardpreis des Artikels
    artikelNummer: string;   // Artikelnummer
    name: string;   // Artikelnummer
    kategorie: string;
    gewichtProStueck?: number;  // Gewicht pro Stück (optional, falls nicht immer angegeben)
    gewichtProKarton?: number;  // Gewicht pro Karton (optional)
    gewichtProKiste?: number;   // Gewicht pro Kiste (optional)
};

export type LoginResource = {
    id: string
    role: "a"|"u"|"v"
    /** Expiration time in seconds since 1.1.1970 */
    exp: number
}

export type KundenPreisResource = {
    id?: string;         // Eindeutige ID
    artikel: string;     // ID des Artikels als String
    customer: string;    // ID des Kunden als String
    aufpreis: number;    // Aufpreis für diesen Kunden
  };