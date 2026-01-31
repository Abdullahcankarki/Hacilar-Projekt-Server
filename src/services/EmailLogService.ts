import { EmailLog, IEmailLog } from "../model/EmailLogModel";

/**
 * Erstellt einen neuen Email-Log-Eintrag.
 */
export async function logEmail(
  data: Omit<IEmailLog, "">
): Promise<void> {
  try {
    await EmailLog.create(data);
  } catch (err) {
    // Logging darf niemals den Haupt-Flow blockieren
    console.error("[EmailLogService] Fehler beim Speichern des Email-Logs:", err);
  }
}

/**
 * Paginierte Abfrage der Email-Logs mit optionalen Filtern.
 * pdfBuffer wird aus der Liste ausgeschlossen (Performance).
 */
export async function getEmailLogs(params: {
  page?: number;
  limit?: number;
  typ?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
}): Promise<{ items: any[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const filter: any = {};

  if (params.typ) {
    filter.typ = params.typ;
  }
  if (params.status) {
    filter.status = params.status;
  }
  if (params.search) {
    const re = new RegExp(params.search, "i");
    filter.$or = [
      { empfaenger: re },
      { kundenName: re },
      { auftragNummer: re },
      { betreff: re },
    ];
  }
  if (params.from || params.to) {
    filter.createdAt = {};
    if (params.from) filter.createdAt.$gte = new Date(params.from);
    if (params.to) {
      const to = new Date(params.to);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  const [items, total] = await Promise.all([
    EmailLog.find(filter)
      .select("-pdfBase64")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EmailLog.countDocuments(filter),
  ]);

  return {
    items: items.map((i) => ({
      id: i._id?.toString(),
      empfaenger: i.empfaenger,
      betreff: i.betreff,
      typ: i.typ,
      status: i.status,
      fehler: i.fehler,
      auftragId: i.auftragId?.toString(),
      auftragNummer: i.auftragNummer,
      kundenName: i.kundenName,
      belegTyp: i.belegTyp,
      messageId: i.messageId,
      pdfFilename: i.pdfFilename,
      hasPdf: !!i.pdfFilename,
      createdAt: (i as any).createdAt?.toISOString(),
    })),
    total,
    page,
    limit,
  };
}

/**
 * Gibt die PDF-Daten eines Email-Log-Eintrags als Base64 zurück.
 */
export async function getEmailLogPdf(
  id: string
): Promise<{ base64: string; filename: string } | null> {
  const log = await EmailLog.findById(id).select("pdfBase64 pdfFilename").lean();
  if (!log || !log.pdfBase64) return null;

  return {
    base64: log.pdfBase64,
    filename: log.pdfFilename || "beleg.pdf",
  };
}
