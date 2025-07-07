import { ZerlegeAuftragModel } from '../model/ZerlegeAuftragModel';
import { LoginResource, ZerlegeauftragResource } from '../Resources';

function toResource(doc: any): ZerlegeauftragResource {
  return {
    id: doc._id.toString(),
    auftragId: doc.auftragId,
    kundenName: doc.kundenName,
    artikelPositionen: doc.artikelPositionen.map((p: any) => ({
      artikelPositionId: p.artikelPositionId,
      artikelName: p.artikelName,
      status: p.status,
      menge: p.menge,
      bemerkung: p.bemerkung,
      erledigtAm: p.erledigtAm?.toISOString()
    })),
    zerlegerId: doc.zerlegerId,
    zerlegerName: doc.zerlegerName,
    erstelltAm: doc.erstelltAm.toISOString(),
    archiviert: doc.archiviert
  };
}

export async function getAllZerlegeauftraege() {
  return (await ZerlegeAuftragModel.find()).map(toResource);
}

export async function getZerlegeauftragById(id: string) {
  return toResource(await ZerlegeAuftragModel.findById(id));
}

export async function getAllOffeneZerlegeauftraege() {
  return (await ZerlegeAuftragModel.find({
    'artikelPositionen.status': 'offen'
  })).map(toResource);
}

export async function updateZerlegeauftragStatus(
  auftragId: string,
  artikelPositionId: string,
  currentUser: LoginResource
) {
  if (!currentUser.role.includes('admin') && !currentUser.role.includes('zerleger')) {
    throw new Error('Nur Admins oder Zerleger dürfen den Status ändern.');
  }

  const auftrag = await ZerlegeAuftragModel.findById(auftragId);
  if (!auftrag) {
    throw new Error('Zerlegeauftrag nicht gefunden');
  }

  const position = auftrag.artikelPositionen.find((p: any) =>
    p.artikelPositionId.toString() === artikelPositionId
  );

  if (!position) {
    throw new Error('Artikelposition im Auftrag nicht gefunden');
  }

  if (position.status === 'erledigt') {
    position.status = 'offen';
    position.erledigtAm = undefined;
  } else {
    position.status = 'erledigt';
    position.erledigtAm = new Date();
  }

  await auftrag.save();
  return toResource(auftrag);
}

export async function deleteZerlegeauftraegeByDatum(
  currentUser: LoginResource
) {
  if (!currentUser.role.includes('admin')) {
    throw new Error('Nur Admins dürfen löschen.');
  }

  return await ZerlegeAuftragModel.deleteMany({
    'artikelPositionen.status': 'erledigt'
  });
}