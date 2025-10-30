// backend/src/services/AnlieferungService.ts
// import mongoose, { FilterQuery, Types } from "mongoose";
// import { AnlieferungModel } from "../../model/AnlieferungModel";
// import { ChargeModel } from "../../model/ChargeModel";
// import { ArtikelModel } from "../../model/ArtikelModel";
// import { Lieferant as LieferantModel } from "../../model/LieferantModel"; // falls vorhanden
// import { BewegungModel } from "../../model/BewegungsModel";
// import { BestandAggModel } from "../../model/BestandsAggModel";
// import {
//   AnlieferungResource,
//   BewegungResource,
//   Lagerbereich,
// } from "src/Resources";

// /* --------------------------------- Helpers -------------------------------- */

// function toISODate(d?: Date | string | null): string | undefined {
//   if (!d) return undefined;
//   const dt = typeof d === "string" ? new Date(d) : d;
//   return isNaN(dt.getTime()) ? undefined : dt.toISOString();
// }

// function parseISODateRequired(s: string): Date {
//   const d = new Date(s);
//   if (isNaN(d.getTime())) throw new Error("Ungültiges Datum: " + s);
//   return d;
// }

// function normalizeNumber(n: number): number {
//   const v = Number(n);
//   if (!isFinite(v) || v <= 0) throw new Error("Menge muss > 0 sein");
//   return v;
// }

// async function denormArtikel(artikelId: string): Promise<{
//   artikelName?: string;
//   artikelNummer?: string;
// }> {
//   const a = await ArtikelModel.findById(artikelId).select({
//     name: 1,
//     artikelNummer: 1,
//   });
//   return a
//     ? { artikelName: a.name ?? undefined, artikelNummer: a.artikelNummer ?? undefined }
//     : {};
// }

// async function denormLieferant(lieferantId?: string): Promise<{ lieferantName?: string }> {
//   if (!lieferantId) return {};
//   const l = await LieferantModel.findById(lieferantId).select({ name: 1 }).lean();
//   return l ? { lieferantName: l.name ?? undefined } : {};
// }

// function toResource(doc: any): AnlieferungResource {
//   return {
//     id: doc._id.toString(),
//     artikelId: doc.artikelId?.toString(),
//     artikelName: doc.artikelName ?? undefined,
//     artikelNummer: doc.artikelNummer ?? undefined,
//     lieferantId: doc.lieferantId ? doc.lieferantId.toString() : undefined,
//     lieferantName: doc.lieferantName ?? undefined,
//     chargeId: doc.chargeId ? doc.chargeId.toString() : undefined,
//     erwartetAm: toISODate(doc.erwartetAm)?.slice(0, 10)!, // YYYY-MM-DD
//     menge: Number(doc.menge),
//     status: doc.status,
//     createdAt: toISODate(doc.createdAt),
//     createdBy: doc.createdBy ? doc.createdBy.toString() : undefined,
//   };
// }

// async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
//   const session = await mongoose.startSession();
//   try {
//     let result!: T;
//     await session.withTransaction(async () => {
//       result = await fn(session);
//     });
//     return result;
//   } finally {
//     await session.endSession();
//   }
// }

// /** BestandAgg upsert + inkrementelle Deltas anwenden */
// async function upsertBestandAgg(
//   params: {
//     artikelId: string;
//     chargeId?: string;
//     lagerbereich: Lagerbereich;
//     deltaVerfuegbar?: number;
//     deltaReserviert?: number;
//     deltaUnterwegs?: number;
//   },
//   session: mongoose.ClientSession
// ) {
//   const { artikelId, chargeId, lagerbereich, deltaVerfuegbar = 0, deltaReserviert = 0, deltaUnterwegs = 0 } = params;

//   await BestandAggModel.updateOne(
//     { artikelId: new Types.ObjectId(artikelId), chargeId: chargeId ? new Types.ObjectId(chargeId) : null, lagerbereich },
//     {
//       $setOnInsert: {
//         artikelId: new Types.ObjectId(artikelId),
//         chargeId: chargeId ? new Types.ObjectId(chargeId) : null,
//         lagerbereich,
//       },
//       $inc: {
//         verfuegbar: deltaVerfuegbar,
//         reserviert: deltaReserviert,
//         unterwegs: deltaUnterwegs,
//       },
//       $set: { updatedAt: new Date() },
//     },
//     { upsert: true, session }
//   );
// }

// /* ---------------------------------- DTOs ---------------------------------- */

// export type CreateAnlieferungDTO = {
//   artikelId: string;
//   erwartetAm: string;     // ISO YYYY-MM-DD
//   menge: number;
//   chargeId?: string;      // falls bekannt
//   lieferantId?: string;
// };

// export type ListAnlieferungenParams = {
//   status?: "ANGEKUENDIGT" | "TEILGELIEFERT" | "ERLEDIGT";
//   erwartetFrom?: string;
//   erwartetTo?: string;
//   artikelId?: string;
//   lieferantId?: string;
//   q?: string;             // artikelName/Nummer/LieferantName
//   page?: number;
//   limit?: number;
// };

// export type CompleteWareneingangDTO = {
//   anlieferungId?: string; // optional, falls aus Anlieferung gebucht wird
//   artikelId: string;
//   menge: number;
//   lagerbereich: Lagerbereich; // "TK" | "NON_TK"
//   charge: {
//     id?: string;          // vorhandene Charge verwenden ODER
//     mhd: string;          // neue Charge anlegen (erforderlich)
//     isTK: boolean;
//     schlachtDatum?: string;
//     lieferantId?: string; // optional, wenn neue Charge
//   };
//   notiz?: string;
//   userId?: string;
// };

// /* ---------------------------------- CRUD ---------------------------------- */

// /** Anlieferung erfassen (Status: ANGEKUENDIGT) */
// export async function createAnlieferung(
//   data: CreateAnlieferungDTO,
//   userId?: string
// ): Promise<AnlieferungResource> {
//   const menge = normalizeNumber(data.menge);
//   const erwartetAm = parseISODateRequired(data.erwartetAm);
//   const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);
//   const { lieferantName } = await denormLieferant(data.lieferantId);

//   const doc = await new AnlieferungModel({
//     artikelId: new Types.ObjectId(data.artikelId),
//     artikelName,
//     artikelNummer,
//     lieferantId: data.lieferantId ? new Types.ObjectId(data.lieferantId) : undefined,
//     lieferantName,
//     chargeId: data.chargeId ? new Types.ObjectId(data.chargeId) : undefined,
//     erwartetAm,
//     menge,
//     status: "ANGEKUENDIGT",
//     createdBy: userId ? new Types.ObjectId(userId) : undefined,
//   }).save();

//   // Optional: unterwegs++ auf Artikel-Level (ohne Charge)
//   // Wenn du das willst, entkommentieren:
//   // await upsertBestandAgg({ artikelId: data.artikelId, lagerbereich: "NON_TK", deltaUnterwegs: menge }, ???)

//   return toResource(doc);
// }

// /** Anlieferungen listen mit Filtern & Pagination */
// export async function listAnlieferungen(
//   params?: ListAnlieferungenParams
// ): Promise<{ items: AnlieferungResource[]; total: number; page: number; limit: number }> {
//   const page = Math.max(1, params?.page ?? 1);
//   const totalDocsAll = await AnlieferungModel.estimatedDocumentCount();
//   const limit =
//     params?.limit !== undefined
//       ? Math.min(200, Math.max(1, params?.limit ?? 50))
//       : totalDocsAll;
//   const skip = (page - 1) * limit;

//   const filter: FilterQuery<any> = {};
//   if (params?.status) filter.status = params.status;
//   if (params?.artikelId) filter.artikelId = params.artikelId;
//   if (params?.lieferantId) filter.lieferantId = params.lieferantId;

//   if (params?.erwartetFrom || params?.erwartetTo) {
//     filter.erwartetAm = {};
//     if (params.erwartetFrom) filter.erwartetAm.$gte = parseISODateRequired(params.erwartetFrom);
//     if (params.erwartetTo) {
//       const end = new Date(params.erwartetTo);
//       end.setHours(23, 59, 59, 999);
//       filter.erwartetAm.$lte = end;
//     }
//   }

//   if (params?.q) {
//     const q = params.q.trim();
//     filter.$or = [
//       { artikelName: { $regex: q, $options: "i" } },
//       { artikelNummer: { $regex: q, $options: "i" } },
//       { lieferantName: { $regex: q, $options: "i" } },
//     ];
//   }

//   const [docs, total] = await Promise.all([
//     AnlieferungModel.find(filter)
//       .sort({ erwartetAm: 1, createdAt: 1 })
//       .skip(skip)
//       .limit(limit),
//     AnlieferungModel.countDocuments(filter),
//   ]);

//   return {
//     items: docs.map(toResource),
//     total,
//     page,
//     limit,
//   };
// }

// /* --------------------------- Wareneingang buchen --------------------------- */
// /**
//  * Wareneingang buchen:
//  * - nutzt vorhandene Charge (charge.id) ODER legt eine neue Charge an
//  * - schreibt Bewegung (WARENEINGANG)
//  * - aktualisiert BestandAgg (verfügbar +, unterwegs - optional, wenn anlieferungId gegeben)
//  * - setzt Anlieferung.status -> ERLEDIGT (falls anlieferungId)
//  */
// export async function completeWareneingang(
//   data: CompleteWareneingangDTO
// ): Promise<BewegungResource> {
//   const menge = normalizeNumber(data.menge);

//   return await withTransaction<BewegungResource>(async (session) => {
//     // 1) Charge ermitteln/erstellen
//     let chargeId: Types.ObjectId;

//     if (data.charge.id) {
//       chargeId = new Types.ObjectId(data.charge.id);
//       const exists = await ChargeModel.exists({ _id: chargeId }).session(session);
//       if (!exists) throw new Error("Charge nicht gefunden");
//     } else {
//       // neue Charge anlegen
//       const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);
//       const { lieferantName } = await denormLieferant(data.charge.lieferantId);

//       const newCharge = await new ChargeModel({
//         artikelId: new Types.ObjectId(data.artikelId),
//         artikelName,
//         artikelNummer,
//         lieferantId: data.charge.lieferantId ? new Types.ObjectId(data.charge.lieferantId) : undefined,
//         mhd: parseISODateRequired(data.charge.mhd),
//         schlachtDatum: data.charge.schlachtDatum ? parseISODateRequired(data.charge.schlachtDatum) : undefined,
//         isTK: !!data.charge.isTK,
//         lieferantName, // falls im Model vorhanden
//       }).save({ session });

//       chargeId = newCharge._id;
//     }

//     // 2) Bewegung schreiben (WARENEINGANG)
//     const { artikelName, artikelNummer } = await denormArtikel(data.artikelId);
//     const bewegung = await new BewegungModel({
//       timestamp: new Date(),
//       userId: data.userId ? new Types.ObjectId(data.userId) : undefined,
//       typ: "WARENEINGANG",
//       artikelId: new Types.ObjectId(data.artikelId),
//       artikelName,
//       artikelNummer,
//       chargeId,
//       menge,
//       lagerbereich: data.lagerbereich,
//       notiz: data.notiz ?? undefined,
//       mhd: parseISODateRequired(data.charge.mhd),
//       schlachtDatum: data.charge.schlachtDatum ? parseISODateRequired(data.charge.schlachtDatum) : undefined,
//       isTK: !!data.charge.isTK,
//     }).save({ session });

//     // 3) BestandAgg aktualisieren (verfügbar +)
//     await upsertBestandAgg(
//       {
//         artikelId: data.artikelId,
//         chargeId: chargeId.toString(),
//         lagerbereich: data.lagerbereich,
//         deltaVerfuegbar: menge,
//       },
//       session
//     );

//     // 4) (Optional) Unterwegs reduzieren & Anlieferung abschließen
//     if (data.anlieferungId) {
//       const anl = await AnlieferungModel.findById(data.anlieferungId).session(session);
//       if (anl) {
//         anl.status = "ERLEDIGT";
//         anl.chargeId = chargeId;
//         await anl.save({ session });

//         // wenn du unterwegs trackst: unterwegs - menge
//         await upsertBestandAgg(
//           {
//             artikelId: data.artikelId,
//             chargeId: undefined, // unterwegs meist artikel-level; hier neutral
//             lagerbereich: data.lagerbereich,
//             deltaUnterwegs: -menge,
//           },
//           session
//         );
//       }
//     }

//     // 5) Ergebnis als Resource zurück
//     const res: BewegungResource = {
//       id: bewegung._id.toString(),
//       timestamp: bewegung.timestamp.toISOString(),
//       typ: "WARENEINGANG",
//       artikelId: data.artikelId,
//       artikelName,
//       artikelNummer,
//       chargeId: chargeId.toString(),
//       menge,
//       lagerbereich: data.lagerbereich,
//       notiz: data.notiz ?? undefined,
//       mhd: toISODate(data.charge.mhd)?.slice(0, 10),
//       schlachtDatum: data.charge.schlachtDatum,
//       isTK: data.charge.isTK,
//     };
//     return res;
//   });
// }