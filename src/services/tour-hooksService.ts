// backend/src/services/tour-hooks.service.ts
// Zentrale Hooks & Helfer für die Tour-Automatik:
// - onAuftragLieferdatumSet
// - onAuftragDatumOderRegionGeaendert
// - recomputeTourWeight / updateOverCapacityFlag
// - validateRegionRuleOrThrow
// - nextPositionFromTemplate
// - removeStopAndCloseGaps
// - moveStopBetweenTours (manuelles Verschieben/Drag&Drop)

import mongoose, { ClientSession, Types } from "mongoose";
import { format } from "date-fns";
import { de } from "date-fns/locale";

// ❗️ Passen die Import-Pfade bei dir an (Model-Dateinamen können abweichen)
import { Auftrag } from "../model/AuftragModel";
import { Tour } from "../model/TourModel";
import { TourStop } from "../model/TourStopModel";
import { Fahrzeug } from "../model/FahrzeugModel";
import { RegionRule } from "../model/RegionRuleModel";
import { ReihenfolgeVorlage } from "../model/ReihenfolgeVorlageModel";
import { Kunde } from "../model/KundeModel";

// ---------------------- Public APIs ----------------------

/**
 * Wird aufgerufen, wenn ein Auftrag ein lieferdatum erhält/ändert.
 * - Prüft RegionRule (Bestelltage/Cutoff)
 * - Sucht/erstellt Standard-Tour (datum+region)
 * - Legt TourStop an ODER verschiebt bestehenden Stop in-place
 * - Aktualisiert Auftrag-Referenzen
 * - Rechnet Gewicht & OverCapacity-Flag
 */
export async function onAuftragLieferdatumSet(auftragId: string) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const a = await Auftrag.findById(auftragId).session(session);
      if (!a) throw new Error("Auftrag nicht gefunden");
      if (!a.lieferdatum) throw new Error("Lieferdatum erforderlich");

      const k = await Kunde.findById(a.kunde).session(session);
      if (!k) throw new Error("Kunde nicht gefunden");

      const region = normalizeRegion(k.region);
      await validateRegionRuleOrThrow(region, a.lieferdatum, session);

      const tour = await Tour.findOrCreateStandard(a.lieferdatum, region, { session });
      if (!tour?._id) throw new Error("Ziel-Tour konnte nicht ermittelt/erstellt werden");

      // Prüfe, ob bereits ein Stop existiert
      const existing = await TourStop.findOne({ auftragId: a._id }).session(session);

      if (existing) {
        // Bereits vorhandener Stop
        if (String(existing.tourId) === String(tour._id)) {
          // Bereits in Zieltour → Refs härten und ggf. Position neu bestimmen
          await Auftrag.updateOne(
            { _id: a._id },
            { $set: { tourId: tour._id, tourStopId: existing._id } },
            { session }
          );

          // Optional: Position nach Vorlage neu setzen (wenn Vorlage sich geändert hat)
          // const newPos = await nextPositionFromTemplate(tour._id, k._id, tour.reihenfolgeVorlageId, session);
          // if (typeof newPos === "number" && newPos !== existing.position) {
          //   await TourStop.updateOne({ _id: existing._id }, { $set: { position: newPos } }, { session });
          // }

          await recomputeTourWeight(String(tour._id), session);
          await updateOverCapacityFlag(String(tour._id), session);
          return;
        }

        // ►► In-place MOVE in die Zieltour
        const sourceTourId = String(existing.tourId);
        const oldPos = existing.position ?? 0;

        const newPos = await nextPositionFromTemplate(
          tour._id,
          k._id,
          tour.reihenfolgeVorlageId,
          session
        );
        if (typeof newPos !== "number") throw new Error("Position aus Vorlage konnte nicht ermittelt werden");

        // Zielposition ggf. Platz schaffen (Positionsverschiebung in Ziel)
        await TourStop.updateMany(
          { tourId: tour._id, position: { $gte: newPos } },
          { $inc: { position: 1 } },
          { session }
        );

        // Stop auf neue Tour und Position setzen; Meta aktualisieren
        await TourStop.updateOne(
          { _id: existing._id },
          {
            $set: {
              tourId: tour._id,
              position: newPos,
              kundeId: k._id,
              kundeName: k.name,
              gewichtKg: a.gewicht ?? null,
            },
          },
          { session }
        );

        // Lücke in Quelltour schließen
        await closeGapsAfterMove(sourceTourId, oldPos, session);

        // Refs auf Auftrag härten (tourStopId bleibt gleich)
        await Auftrag.updateOne(
          { _id: a._id },
          { $set: { tourId: tour._id, tourStopId: existing._id } },
          { session }
        );

        // Gewichte/Flags beider Touren aktualisieren
        await recomputeTourWeight(sourceTourId, session);
        await updateOverCapacityFlag(sourceTourId, session);
        await deleteTourIfEmpty(sourceTourId, session); // ggf. leere Standardtour löschen

        await recomputeTourWeight(String(tour._id), session);
        await updateOverCapacityFlag(String(tour._id), session);
        return;
      }

      // Kein Stop vorhanden → neu anlegen
      const position = await nextPositionFromTemplate(
        tour._id,
        k._id,
        tour.reihenfolgeVorlageId,
        session
      );
      if (typeof position !== "number")
        throw new Error("Position aus Vorlage konnte nicht ermittelt werden");

      const [stop] = await TourStop.create(
        [
          {
            tourId: tour._id,
            auftragId: a._id,
            kundeId: k._id,
            kundeName: k.name,
            position,
            gewichtKg: a.gewicht ?? null,
            status: "offen",
          },
        ],
        { session }
      );

      await Auftrag.updateOne(
        { _id: a._id },
        { $set: { tourId: tour._id, tourStopId: stop._id } },
        { session }
      );

      await recomputeTourWeight(String(tour._id), session);
      await updateOverCapacityFlag(String(tour._id), session);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Wird aufgerufen, wenn Lieferdatum/Region eines Auftrags nachträglich geändert wird.
 * - Prüft RegionRule
 * - Verschiebt Stop atomar in die neue (Standard-)Tour
 */
export async function onAuftragDatumOderRegionGeaendert(auftragId: string) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const a = await Auftrag.findById(auftragId).session(session);
      if (!a) throw new Error("Auftrag nicht gefunden");
      if (!a.lieferdatum) throw new Error("Lieferdatum erforderlich");

      const k = await Kunde.findById(a.kunde).session(session);
      if (!k) throw new Error("Kunde nicht gefunden");

      const region = normalizeRegion(k.region);
      await validateRegionRuleOrThrow(region, a.lieferdatum, session);

      const target = await Tour.findOrCreateStandard(a.lieferdatum, region, { session });
      if (!target?._id) throw new Error("Ziel-Tour konnte nicht ermittelt/erstellt werden");

      // Alle aktuellen Stops für Auftrag (robuster als findOne)
      const currents = await TourStop.find({ auftragId: a._id }).session(session);
      const current = currents[0] ?? null;

      // Mehrfach-Zuordnungen bereinigen
      if (currents.length > 1) {
        for (let i = 1; i < currents.length; i++) {
          const r = currents[i];
          const srcId = String(r.tourId);
          await removeStopAndCloseGaps(r._id.toString(), session);
          await recomputeTourWeight(srcId, session);
          await updateOverCapacityFlag(srcId, session);
          await deleteTourIfEmpty(srcId, session);
        }
      }

      if (!current) {
        // Kein Stop → wie Erstzuordnung
        const pos = await nextPositionFromTemplate(
          target._id,
          k._id,
          target.reihenfolgeVorlageId,
          session
        );
        if (typeof pos !== "number") throw new Error("Position aus Vorlage konnte nicht ermittelt werden");

        const [stop] = await TourStop.create(
          [
            {
              tourId: target._id,
              auftragId: a._id,
              kundeId: k._id,
              kundeName: k.name,
              position: pos,
              gewichtKg: a.gewicht ?? null,
              status: "offen",
            },
          ],
          { session }
        );

        await Auftrag.updateOne(
          { _id: a._id },
          { $set: { tourId: target._id, tourStopId: stop._id } },
          { session }
        );

        await recomputeTourWeight(String(target._id), session);
        await updateOverCapacityFlag(String(target._id), session);
        return;
      }

      // Bereits in der richtigen Ziel-Tour?
      if (String(current.tourId) === String(target._id)) {
        await Auftrag.updateOne(
          { _id: a._id },
          { $set: { tourId: target._id, tourStopId: current._id } },
          { session }
        );
        // Optional: repositionieren nach Vorlage
        // const newPos = await nextPositionFromTemplate(target._id, k._id, target.reihenfolgeVorlageId, session);
        // if (typeof newPos === "number" && newPos !== current.position) {
        //   await TourStop.updateOne({ _id: current._id }, { $set: { position: newPos } }, { session });
        //   await recomputeTourWeight(String(target._id), session);
        //   await updateOverCapacityFlag(String(target._id), session);
        // }
        return;
      }

      // ►► In-place MOVE in die Ziel-Tour
      const sourceTourId = String(current.tourId);
      const oldPos = current.position ?? 0;

      const targetPos = await nextPositionFromTemplate(
        target._id,
        k._id,
        target.reihenfolgeVorlageId,
        session
      );
      if (typeof targetPos !== "number") throw new Error("Position aus Vorlage konnte nicht ermittelt werden");

      // Ziel-Tour: Platz schaffen
      await TourStop.updateMany(
        { tourId: target._id, position: { $gte: targetPos } },
        { $inc: { position: 1 } },
        { session }
      );

      // Stop umhängen
      await TourStop.updateOne(
        { _id: current._id },
        {
          $set: {
            tourId: target._id,
            position: targetPos,
            kundeId: k._id,
            kundeName: k.name,
            gewichtKg: a.gewicht ?? null,
          },
        },
        { session }
      );

      // Lücke in Quelltour schließen
      await closeGapsAfterMove(sourceTourId, oldPos, session);

      // Auftrag-Refs
      await Auftrag.updateOne(
        { _id: a._id },
        { $set: { tourId: target._id, tourStopId: current._id } },
        { session }
      );

      // Gewichte/Flags beider Touren
      await recomputeTourWeight(sourceTourId, session);
      await updateOverCapacityFlag(sourceTourId, session);
      await deleteTourIfEmpty(sourceTourId, session);

      await recomputeTourWeight(String(target._id), session);
      await updateOverCapacityFlag(String(target._id), session);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Manuelles Verschieben (z. B. Drag&Drop im Dispo-Board).
 * - Verschiebt Stop in-place in eine andere Tour oder re-ordered innerhalb derselben Tour
 * - Schließt Lücken / schafft Platz
 * - Aktualisiert Gewicht/Fahne beider Touren
 */
export async function moveStopBetweenTours(params: {
  stopId: string;
  targetTourId: string;
  targetPosition?: number; // wenn leer → ans Ende
}) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const stop = await TourStop.findById(params.stopId).session(session);
      if (!stop) throw new Error("Stop nicht gefunden");

      const sourceTourId = String(stop.tourId);
      const targetTourId = String(params.targetTourId);

      // Re-Order innerhalb derselben Tour
      if (sourceTourId === targetTourId) {
        await reorderWithinSameTour(stop, params.targetPosition, session);
        await recomputeTourWeight(sourceTourId, session);
        await updateOverCapacityFlag(sourceTourId, session);
        return;
      }

      // Cross-Tour: Platz in Ziel schaffen
      let targetPos = params.targetPosition ?? 0;
      if (!targetPos || targetPos < 1) {
        const last = await TourStop.find({ tourId: targetTourId })
          .session(session)
          .sort({ position: -1 })
          .limit(1);
        targetPos = (last[0]?.position ?? 0) + 1;
      } else {
        await TourStop.updateMany(
          { tourId: targetTourId, position: { $gte: targetPos } },
          { $inc: { position: 1 } },
          { session }
        );
      }

      const oldPos = stop.position ?? 0;

      // Stop umhängen
      await TourStop.updateOne(
        { _id: stop._id },
        { $set: { tourId: new Types.ObjectId(targetTourId), position: targetPos } },
        { session }
      );

      // Lücke Quelle schließen
      await closeGapsAfterMove(sourceTourId, oldPos, session);

      // Auftrag-Referenzen aktualisieren (tourStopId bleibt identisch)
      await Auftrag.updateOne(
        { _id: stop.auftragId },
        { $set: { tourId: targetTourId, tourStopId: stop._id } },
        { session }
      );

      // Gewichte/Flags
      await recomputeTourWeight(sourceTourId, session);
      await updateOverCapacityFlag(sourceTourId, session);
      await deleteTourIfEmpty(sourceTourId, session);

      await recomputeTourWeight(targetTourId, session);
      await updateOverCapacityFlag(targetTourId, session);
    });
  } finally {
    session.endSession();
  }
}

// ---------------------- Helfer/Util ----------------------

export async function recomputeTourWeight(tourId: string, session?: mongoose.ClientSession) {
  // Summiert robust: konvertiert Strings -> double; onError/onNull => 0
  const agg = await TourStop.aggregate([
    { $match: { tourId: new mongoose.Types.ObjectId(tourId) } },
    {
      $group: {
        _id: null,
        sum: {
          $sum: {
            $convert: { input: "$gewichtKg", to: "double", onError: 0, onNull: 0 }
          }
        }
      }
    }
  ]).session(session || null);

  const sum = typeof agg?.[0]?.sum === "number" ? agg[0].sum : 0;

  await Tour.updateOne(
    { _id: new mongoose.Types.ObjectId(tourId) },
    { $set: { belegtesGewichtKg: sum } },
    { session }
  );
}

export async function updateOverCapacityFlag(tourId: string, session?: mongoose.ClientSession) {
  const tour = await Tour.findById(tourId).session(session || null);
  if (!tour) return;
  let max = tour.maxGewichtKg ?? null;
  if (!max && tour.fahrzeugId) {
    const f = await Fahrzeug.findById(tour.fahrzeugId).session(session || null);
    max = f?.maxGewichtKg ?? null;
  }
  const over = max ? tour.belegtesGewichtKg > max : false;
  if (tour.overCapacityFlag !== over) {
    await Tour.updateOne({ _id: tour._id }, { $set: { overCapacityFlag: over } }, { session });
  }
}

async function validateRegionRuleOrThrow(region: string, lieferdatum: Date, session: mongoose.ClientSession) {
  const rule = await RegionRule.findOne({ region: region, aktiv: true }).session(session);
  if (!rule) return; // keine Regel -> alles erlaubt

  // weekday als deutscher Name (z. B. "Montag")
  const weekdayDe = format(new Date(lieferdatum), "EEEE", { locale: de });
  const erlaubt = rule.erlaubteTage?.includes(weekdayDe);
  if (!erlaubt) {
    // FIX: fehlendes Template-Literal
    throw new Error(`Für Region ${region} sind Bestellungen an ${weekdayDe} nicht erlaubt.`);
  }
}

async function nextPositionFromTemplate(
  tourId: Types.ObjectId,
  kundeId: Types.ObjectId,
  reihenfolgeVorlageId?: Types.ObjectId | null,
  session?: mongoose.ClientSession
): Promise<number> {
  if (reihenfolgeVorlageId) {
    const v = await ReihenfolgeVorlage.findById(reihenfolgeVorlageId).session(session || null);
    const idx = v?.kundenReihenfolge?.findIndex((x) => String(x.kundeId) === String(kundeId));
    if (typeof idx === "number" && idx >= 0) {
      return idx + 1; // 1-basiert
    }
  }

  // ans Ende anhängen
  const last = await TourStop.find({ tourId }).session(session || null).sort({ position: -1 }).limit(1);
  return (last[0]?.position ?? 0) + 1;
}

/**
 * Entfernt einen TourStop, schließt die Lücke in der Quell‑Tour,
 * rechnet Gewicht/OverCapacity neu.
 * (Auto-Löschen der Tour ist separat über deleteTourIfEmpty)
 */
async function removeStopAndCloseGaps(stopId: string, session: mongoose.ClientSession) {
  const stop = await TourStop.findById(stopId).session(session);
  if (!stop) return;
  const { tourId, position } = stop;

  await TourStop.deleteOne({ _id: stop._id }).session(session);

  if (typeof position === "number") {
    await TourStop.updateMany(
      { tourId, position: { $gt: position } },
      { $inc: { position: -1 } },
      { session }
    );
  }

  await recomputeTourWeight(String(tourId), session);
  await updateOverCapacityFlag(String(tourId), session);
}

/**
 * Schließt die Positionslücke nach einem in-place Move
 */
async function closeGapsAfterMove(
  sourceTourId: string,
  oldPos: number,
  session: mongoose.ClientSession
) {
  await TourStop.updateMany(
    { tourId: sourceTourId, position: { $gt: oldPos } },
    { $inc: { position: -1 } },
    { session }
  );
}

async function reorderWithinSameTour(
  stop: any,
  targetPosition: number | undefined,
  session: mongoose.ClientSession
) {
  const tourId = String(stop.tourId);

  if (!targetPosition || targetPosition < 1) {
    // ans Ende
    const last = await TourStop.find({ tourId }).session(session).sort({ position: -1 }).limit(1);
    targetPosition = (last[0]?.position ?? 0) + 1;
  }

  if (targetPosition === stop.position) return;

  if (targetPosition > stop.position) {
    // nach unten: alles zwischen (stop.position+1 .. targetPosition) -1
    await TourStop.updateMany(
      { tourId, position: { $gt: stop.position, $lte: targetPosition } },
      { $inc: { position: -1 } },
      { session }
    );
  } else {
    // nach oben: alles zwischen (targetPosition .. stop.position-1) +1
    await TourStop.updateMany(
      { tourId, position: { $gte: targetPosition, $lt: stop.position } },
      { $inc: { position: 1 } },
      { session }
    );
  }

  // stop auf Ziel-Position setzen
  await TourStop.updateOne({ _id: stop._id }, { $set: { position: targetPosition } }, { session });
  // Gewichte/Flags unverändert; Reihenfolge betrifft sie nicht
}

async function deleteTourIfEmpty(tourId: string, session: mongoose.ClientSession) {
  if (!tourId) return;

  // Prüfen, ob noch Stops existieren
  const count = await TourStop.countDocuments({ tourId }).session(session);
  if (count > 0) return;

  // Tour holen
  const t = await Tour.findById(tourId).session(session).lean();
  if (!t) return;

  // Nur "Standard-/auto-generierte" Touren löschen (Sicherheitsnetz)
  const isAuto =
    (t as any).typ === "standard" ||
    (t as any).autoGenerated === true ||
    (t as any).isStandard === true;

  if (!isAuto) return;

  await Tour.deleteOne({ _id: tourId }, { session });
}

function normalizeRegion(input?: string | null): string {
  return (input || "").trim();
}

// entfernt alle TourStops eines Auftrags inkl. Lücken schließen / Recompute / Autodelete
export async function removeAllStopsForAuftrag(auftragId: string, session: ClientSession) {
  const stops = await TourStop.find({ auftragId }).session(session);
  if (!stops.length) return;

  // Touren -> betroffene Positionen merken
  const byTour = new Map<string, number[]>(); // tourId -> [positions]
  for (const s of stops) {
    const tId = String(s.tourId);
    const pos = typeof s.position === "number" ? s.position : 0;
    if (!byTour.has(tId)) byTour.set(tId, []);
    byTour.get(tId)!.push(pos);
  }

  // Stops löschen
  await TourStop.deleteMany({ auftragId }).session(session);

  // pro Tour: Lücken schließen, neu rechnen, ggf. löschen
  for (const [tourId, positions] of byTour.entries()) {
    // Lücke schließen: wir können einmalig alle >minPos dekrementieren,
    // oder mehrmals; hier einmalig der Einfachheit halber für jede Position:
    positions.sort((a, b) => a - b); // von klein nach groß
    for (const oldPos of positions) {
      if (typeof oldPos === "number" && oldPos > 0) {
        await closeGapsAfterRemoval(tourId, oldPos, session);
      }
    }
    await recomputeTourWeight(tourId, session);
    await updateOverCapacityFlag(tourId, session);
    await deleteTourIfEmpty(tourId, session); // nur Standard-Touren
  }
}

// schließt die Lücke in der Quell-Tour, nachdem ein Stop entfernt wurde
async function closeGapsAfterRemoval(tourId: string, oldPos: number, session: ClientSession) {
  await TourStop.updateMany(
    { tourId, position: { $gt: oldPos } },
    { $inc: { position: -1 } },
    { session }
  );
}
