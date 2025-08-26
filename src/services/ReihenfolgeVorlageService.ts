// backend/src/services/ReihenfolgeVorlageService.ts
import { Types } from "mongoose";
import { ReihenfolgeVorlage } from "../model/ReihenfolgeVorlageModel"; // Pfad anpassen
import { ReihenfolgeVorlageResource } from "src/Resources";


export async function createReihenfolgeVorlage(
  data: Omit<ReihenfolgeVorlageResource, "id" | "createdAt" | "updatedAt">
): Promise<ReihenfolgeVorlageResource> {
  const newDoc = new ReihenfolgeVorlage({
    region: data.region.trim(),
    name: data.name.trim(),
    kundenReihenfolge: data.kundenIdsInReihenfolge.map((id, idx) => ({
      kundeId: new Types.ObjectId(id),
      position: idx + 1,
    })),
  });

  const saved = await newDoc.save();

  return {
    id: saved._id.toString(),
    region: saved.region,
    name: saved.name,
    kundenIdsInReihenfolge: saved.kundenReihenfolge.map((x) =>
      x.kundeId.toString()
    ),
    createdAt: saved.createdAt?.toISOString(),
    updatedAt: saved.updatedAt?.toISOString(),
  };
}

export async function getReihenfolgeVorlageById(
  id: string
): Promise<ReihenfolgeVorlageResource | null> {
  const doc = await ReihenfolgeVorlage.findById(id);
  if (!doc) return null;

  return {
    id: doc._id.toString(),
    region: doc.region,
    name: doc.name,
    kundenIdsInReihenfolge: doc.kundenReihenfolge.map((x) =>
      x.kundeId.toString()
    ),
    createdAt: doc.createdAt?.toISOString(),
    updatedAt: doc.updatedAt?.toISOString(),
  };
}

export async function listReihenfolgeVorlagen(params?: {
  region?: string;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<{ total: number; items: ReihenfolgeVorlageResource[] }> {
  const filter: any = {};
  if (params?.region) {
    filter.region = { $regex: new RegExp(params.region, "i") };
  }
  if (params?.q) {
    filter.name = { $regex: new RegExp(params.q, "i") };
  }

  const page = params?.page ?? 1;
  const limit = params?.limit ?? 50;
  const skip = (page - 1) * limit;

  const [total, docs] = await Promise.all([
    ReihenfolgeVorlage.countDocuments(filter),
    ReihenfolgeVorlage.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
  ]);

  return {
    total,
    items: docs.map((doc) => ({
      id: doc._id.toString(),
      region: doc.region,
      name: doc.name,
      kundenIdsInReihenfolge: doc.kundenReihenfolge.map((x) =>
        x.kundeId.toString()
      ),
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    })),
  };
}

export async function updateReihenfolgeVorlage(
  id: string,
  data: Partial<Omit<ReihenfolgeVorlageResource, "id" | "createdAt" | "updatedAt">>
): Promise<ReihenfolgeVorlageResource> {
  const updateData: any = {};
  if (data.region !== undefined) updateData.region = data.region.trim();
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.kundenIdsInReihenfolge !== undefined) {
    updateData.kundenReihenfolge = data.kundenIdsInReihenfolge.map((cid, idx) => ({
      kundeId: new Types.ObjectId(cid),
      position: idx + 1,
    }));
  }

  const updated = await ReihenfolgeVorlage.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true }
  );

  if (!updated) {
    throw new Error("ReihenfolgeVorlage nicht gefunden");
  }

  return {
    id: updated._id.toString(),
    region: updated.region,
    name: updated.name,
    kundenIdsInReihenfolge: updated.kundenReihenfolge.map((x) =>
      x.kundeId.toString()
    ),
    createdAt: updated.createdAt?.toISOString(),
    updatedAt: updated.updatedAt?.toISOString(),
  };
}

export async function deleteReihenfolgeVorlage(id: string): Promise<void> {
  const deleted = await ReihenfolgeVorlage.findByIdAndDelete(id);
  if (!deleted) {
    throw new Error("ReihenfolgeVorlage nicht gefunden");
  }
}

export async function deleteAllReihenfolgeVorlagen(): Promise<void> {
  await ReihenfolgeVorlage.deleteMany({});
}
