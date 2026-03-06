/**
 * Seed-Script: Geflügel-Lieferanten und Zerleger aus der Excel importieren.
 *
 * Ausführen: npx ts-node src/seed-gefluegel.ts
 *
 * ACHTUNG: Erstellt nur neue Einträge, überschreibt keine bestehenden (skipDuplicates).
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { GefluegelLieferant } from "./model/GefluegelLieferantModel";
import { GefluegelZerleger } from "./model/GefluegelZerlegerModel";

const LIEFERANTEN = [
  { name: "Landgeflügel", sollProzent: 0.685, ekProKg: 1.94, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 0 },
  { name: "Sprehe",       sollProzent: 0.665, ekProKg: 1.86, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 1 },
  { name: "Stolle",       sollProzent: 0.70,  ekProKg: 1.98, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 2 },
  { name: "B-Ware",       sollProzent: 0.68,  ekProKg: 1.90, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 3 },
  { name: "AiA",          sollProzent: 0.655, ekProKg: 1.65, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 4 },
  { name: "Drobimex",     sollProzent: 0.68,  ekProKg: 1.80, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 5 },
  { name: "Animex",       sollProzent: 0.66,  ekProKg: 1.80, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 6 },
  { name: "Bizim",        sollProzent: 0.63,  ekProKg: 2.65, zerlegungskostenProKiste: 1.5, kistenGewichtKg: 10, aktiv: true, reihenfolge: 7 },
];

// Reihenfolge wie in der Excel-Tabelle
const ZERLEGER = [
  "Amir", "Karadayi", "Arslan", "Cabbar", "Devrim", "Dilman", "Erkan",
  "Göksel", "Antep", "Ismail", "Piotri", "Türker", "Tuncer", "Baran",
  "Irfan", "Sedat", "Bünyamin", "Ugur", "SHAH", "Murat", "Leis",
  "Salih", "Senol", "Sadiq", "Osman", "Bülent", "Emin", "Sinan",
  "Ali", "LUKAS", "MEHMETCAN", "Aziz", "Hanifi", "Tiras", "Celal",
  "Yasin", "Ibrahim",
  // Nicht in Excel, aber im System:
  "Agit", "Coskun", "MAHMUT", "Rokhan",
];

async function main() {
  const dbUrl = process.env.DB_CONNECTION_STRING;
  if (!dbUrl) {
    console.error("DB_CONNECTION_STRING nicht gesetzt!");
    process.exit(1);
  }

  await mongoose.connect(dbUrl);
  console.log("DB verbunden.");

  // Lieferanten
  let createdL = 0;
  for (const l of LIEFERANTEN) {
    const exists = await GefluegelLieferant.findOne({ name: l.name });
    if (!exists) {
      await GefluegelLieferant.create(l);
      createdL++;
      console.log(`  Lieferant angelegt: ${l.name}`);
    } else {
      console.log(`  Lieferant existiert: ${l.name} (übersprungen)`);
    }
  }
  console.log(`${createdL} Lieferanten angelegt.`);

  // Zerleger
  let createdZ = 0;
  for (let i = 0; i < ZERLEGER.length; i++) {
    const name = ZERLEGER[i];
    const exists = await GefluegelZerleger.findOne({ name });
    if (!exists) {
      await GefluegelZerleger.create({ name, aktiv: true, reihenfolge: i });
      createdZ++;
      console.log(`  Zerleger angelegt: ${name} (Reihenfolge: ${i})`);
    } else {
      await GefluegelZerleger.updateOne({ name }, { $set: { reihenfolge: i } });
      console.log(`  Zerleger existiert: ${name} (Reihenfolge aktualisiert: ${i})`);
    }
  }
  console.log(`${createdZ} Zerleger angelegt.`);

  await mongoose.disconnect();
  console.log("Fertig!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
