import React, { useState } from 'react';
import { useAuth } from '../providers/Authcontext';
import { Button, Form, Table, Alert, Spinner } from 'react-bootstrap';
import { ArtikelPositionResource, ArtikelResource } from '../Resources';
import { api } from '../backend/api';
import { FaPen } from 'react-icons/fa';

type Props = {
    positions: ArtikelPositionResource[];
    alleArtikel: ArtikelResource[];
    onChange: (positions: ArtikelPositionResource[]) => void;
    onSave: () => void;
    saving: boolean;
    auftragId: string;
};

const parseNumberInput = (value: string): number => parseFloat(value.replace(',', '.'));

const AuftragPositionenTabelle: React.FC<Props> = ({
    positions,
    alleArtikel,
    onChange,
    onSave,
    saving,
    auftragId,
}) => {
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingField, setEditingField] = useState<keyof ArtikelPositionResource | null>(null);
    const [error, setError] = useState<string | null>(null);

    const { user } = useAuth();
    const isKunde = user?.role?.includes('kunde');

    const startEdit = (index: number, field: keyof ArtikelPositionResource) => {
        setEditingIndex(index);
        setEditingField(field);
    };

    const stopEdit = () => {
        setEditingIndex(null);
        setEditingField(null);
    };
    const handleChange = (index: number, field: keyof ArtikelPositionResource, value: any) => {
        const newPositions = [...positions];
        (newPositions[index] as any)[field] = value;

        const pos = newPositions[index];

        // Artikel suchen
        const artikel = alleArtikel.find(a => a.id === pos.artikel);

        // Menge setzen
        const menge = pos.menge || 0;
        const einzelpreis = pos.einzelpreis ?? 0;

        // Standard: Gewicht
        let gewicht = 0;

        if (artikel) {
            switch (pos.einheit) {
                case 'kg':
                    gewicht = menge;
                    break;
                case 'stück':
                    gewicht = (artikel.gewichtProStueck ?? 0) * menge;
                    break;
                case 'kiste':
                    gewicht = (artikel.gewichtProKiste ?? 0) * menge;
                    break;
                case 'karton':
                    gewicht = (artikel.gewichtProKarton ?? 0) * menge;
                    break;
                default:
                    gewicht = 0;
            }
        }

        pos.gesamtgewicht = gewicht;
        pos.gesamtpreis = einzelpreis * gewicht; // Jetzt gewichtsbasiert!

        onChange(newPositions);

        // Hintergrund-Update: alle Felder aktualisieren, wenn Position eine ID hat
        const posToUpdate = newPositions[index];
        if (posToUpdate.id) {
            api.updateArtikelPosition(posToUpdate.id, {
                artikel: posToUpdate.artikel,
                menge: posToUpdate.menge,
                einheit: posToUpdate.einheit,
                einzelpreis: posToUpdate.einzelpreis,
                gesamtgewicht: posToUpdate.gesamtgewicht,
                gesamtpreis: posToUpdate.gesamtpreis,
                bemerkung: posToUpdate.bemerkung,
                zerlegung: posToUpdate.zerlegung,
                vakuum: posToUpdate.vakuum,
                zerlegeBemerkung: posToUpdate.zerlegeBemerkung,
                auftragId
            }).catch((err) => {
                console.error("Fehler beim Hintergrund-Update:", err);
            });
        }
    };

    const handleAdd = () => {
        onChange([
            ...positions,
            {
                menge: 1,
                einheit: 'stück',
                artikel: '',
                einzelpreis: 0,
                gesamtpreis: 0,
                gesamtgewicht: 0,
                zerlegung: false,
            },
        ]);
    };

    const handleDelete = async (index: number) => {
        const pos = positions[index];
        if (pos.id) {
            try {
                await api.deleteArtikelPosition(pos.id);
            } catch (err: any) {
                setError('Fehler beim Löschen: ' + (err.message || 'Unbekannter Fehler'));
                return;
            }
        }
        const updated = positions.filter((_, i) => i !== index);
        onChange(updated);
    };

    const handleArtikelChange = async (
        index: number,
        artikelId: string,
        menge: number,
        einheit: 'kg' | 'stück' | 'kiste' | 'karton',
        bemerkung?: string,
        zerlegung?: boolean,
        vakuum?: boolean
    ) => {
        const artikel = alleArtikel.find((a) => a.id === artikelId);
        if (!artikel) return;

        const updated = [...positions];
        const existingPos = updated[index];

        try {
            if (existingPos.id) {
                const aktualisiertePosition = await api.updateArtikelPosition(existingPos.id, {
                    artikel: artikelId,
                    menge,
                    einheit,
                    bemerkung,
                    zerlegung,
                    vakuum,
                    auftragId
                });

                updated[index] = {
                    ...existingPos,
                    ...aktualisiertePosition,
                };
            } else {
                const neuePosition = await api.createArtikelPosition({
                    artikel: artikelId,
                    menge,
                    einheit,
                    bemerkung,
                    zerlegung,
                    vakuum,
                    auftragId
                });

                updated[index] = {
                    id: neuePosition.id,
                    artikel: neuePosition.artikel,
                    artikelName: neuePosition.artikelName,
                    menge: neuePosition.menge,
                    einheit: neuePosition.einheit,
                    einzelpreis: neuePosition.einzelpreis,
                    gesamtgewicht: neuePosition.gesamtgewicht,
                    gesamtpreis: neuePosition.gesamtpreis,
                    bemerkung: neuePosition.bemerkung,
                    zerlegung: neuePosition.zerlegung,
                    vakuum: neuePosition.vakuum,
                };
            }

            onChange(updated);
        } catch (err: any) {
            setError('Fehler beim Speichern der Artikelposition: ' + (err.message || 'Unbekannter Fehler'));
        }
    };

    return (
        <div>
            <div className="d-flex align-items-center justify-content-between border-bottom pb-2 mb-4">
                <h2 className="h4 mb-0">Artikelpositionen</h2>
                {!isKunde && (
                    <Button variant="outline-success" className="print-hidden" onClick={handleAdd}>
                        + Neue Position
                    </Button>
                )}
            </div>

            {/* Fehleranzeige */}
            {error && (
                <Alert className="print-hidden shadow-sm border" variant="danger" onClose={() => setError(null)} dismissible>
                    {error}
                </Alert>
            )}

            <div className="card shadow-sm mb-4">
                <div className="card-body p-3">
                    <Table bordered hover responsive className="table-sm align-middle text-nowrap">
                        <thead>
                            <tr>
                                {!isKunde && <th className="d-none d-md-table-cell">Bemerkung</th>}
                                <th>Artikel</th>
                                <th className={!isKunde ? "" : "d-none"}>Menge</th>
                                <th className={!isKunde ? "" : "d-none"}>Einheit</th>
                                {!isKunde && <th className="d-none d-md-table-cell">Zerlegung</th>}
                                {!isKunde && <th className="d-none d-lg-table-cell">Zerlege-Bemerkung</th>}
                                <th className="d-none d-sm-table-cell">Einzelpreis (€)</th>
                                <th className="d-none d-sm-table-cell">Gewicht (kg)</th>
                                <th className="d-none d-lg-table-cell print-hidden">Gesamtpreis (€)</th>
                                {!isKunde && <th className="print-hidden">Aktionen</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {positions.map((pos, index) => (
                                <tr key={index}>
                                    {/* Bemerkung */}
                                    {!isKunde && (
                                        <td className="d-none d-md-table-cell" onClick={() => startEdit(index, 'bemerkung')}>
                                            {editingIndex === index && editingField === 'bemerkung' ? (
                                                <Form.Control
                                                    value={pos.bemerkung || ''}
                                                    autoFocus
                                                    onBlur={stopEdit}
                                                    onKeyDown={(e) => e.key === 'Enter' && stopEdit()}
                                                    onChange={(e) => handleChange(index, 'bemerkung', e.target.value)}
                                                    className="form-control-sm"
                                                />
                                            ) : (
                                                <div className="editable-cell">
                                                    {pos.bemerkung || '-'}
                                                    <FaPen className="edit-icon ms-1" />
                                                </div>
                                            )}
                                        </td>
                                    )}
                                    {/* Artikel */}
                                    <td>
                                        <span className="d-inline d-sm-none text-muted small">Artikel: </span>
                                        {isKunde ? (
                                            <span>
                                                {alleArtikel.find(a => a.id === pos.artikel)
                                                    ? `${alleArtikel.find(a => a.id === pos.artikel)?.name} - ${alleArtikel.find(a => a.id === pos.artikel)?.artikelNummer}`
                                                    : '-'}
                                            </span>
                                        ) : (
                                            <span
                                                onClick={() => startEdit(index, 'artikel')}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                {editingIndex === index && editingField === 'artikel' ? (
                                                    <Form.Select
                                                        value={pos.artikel}
                                                        onChange={(e) => {
                                                            handleArtikelChange(
                                                                index,
                                                                e.target.value,
                                                                pos.menge!,
                                                                pos.einheit!,
                                                                pos.bemerkung,
                                                                pos.zerlegung,
                                                                pos.vakuum
                                                            );
                                                            stopEdit();
                                                        }}
                                                        className="form-select-sm"
                                                    >
                                                        <option value="">Artikel wählen...</option>
                                                        {alleArtikel.map(a => (
                                                            <option key={a.id} value={a.id}>
                                                                {a.name} - {a.artikelNummer}
                                                            </option>
                                                        ))}
                                                    </Form.Select>
                                                ) : (
                                                    <div className="editable-cell">
                                                        {alleArtikel.find(a => a.id === pos.artikel)
                                                            ? `${alleArtikel.find(a => a.id === pos.artikel)?.name} - ${alleArtikel.find(a => a.id === pos.artikel)?.artikelNummer}`
                                                            : '-'}
                                                        <FaPen className="edit-icon ms-1" />
                                                    </div>
                                                )}
                                            </span>
                                        )}
                                    </td>
                                    {/* Menge */}
                                    {!isKunde && (
                                        <td>
                                            <span className="d-inline d-sm-none text-muted small">Menge: </span>
                                            <span
                                                onClick={() => startEdit(index, 'menge')}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                {editingIndex === index && editingField === 'menge' ? (
                                                    <Form.Control
                                                        type="number"
                                                        min="1"
                                                        value={pos.menge}
                                                        autoFocus
                                                        onBlur={stopEdit}
                                                        onKeyDown={(e) => e.key === 'Enter' && stopEdit()}
                                                        onChange={(e) => handleChange(index, 'menge', parseNumberInput(e.target.value))}
                                                        className="form-control-sm"
                                                        style={{ minWidth: '120px' }}
                                                    />
                                                ) : (
                                                    <div className="editable-cell">
                                                        {pos.menge || '-'}
                                                        <FaPen className="edit-icon ms-1" />
                                                    </div>
                                                )}
                                            </span>
                                        </td>
                                    )}
                                    {/* Einheit */}
                                    {!isKunde && (
                                        <td>
                                            <span className="d-inline d-sm-none text-muted small">Einheit: </span>
                                            <span
                                                onClick={() => startEdit(index, 'einheit')}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                {editingIndex === index && editingField === 'einheit' ? (
                                                    <Form.Select
                                                        value={pos.einheit}
                                                        onChange={(e) => {
                                                            handleChange(index, 'einheit', e.target.value);
                                                            stopEdit();
                                                        }}
                                                        autoFocus
                                                        onKeyDown={(e) => e.key === 'Enter' && stopEdit()}
                                                        className="form-control-sm"
                                                        style={{ minWidth: '120px' }}
                                                    >
                                                        <option value="kg">kg</option>
                                                        <option value="stück">stück</option>
                                                        <option value="kiste">kiste</option>
                                                        <option value="karton">karton</option>
                                                    </Form.Select>
                                                ) : (
                                                    <div className="editable-cell">
                                                        {pos.einheit}
                                                        <FaPen className="edit-icon ms-1" />
                                                    </div>
                                                )}
                                            </span>
                                        </td>
                                    )}
                                    {/* Zerlegung */}
                                    {!isKunde && (
                                        <td className="d-none d-md-table-cell">
                                            <input
                                                type="checkbox"
                                                checked={!!pos.zerlegung}
                                                onChange={(e) => handleChange(index, 'zerlegung', e.target.checked)}
                                                className="form-check-input"
                                                style={{ cursor: 'pointer' }}
                                            />
                                        </td>
                                    )}
                                    {/* Zerlege-Bemerkung */}
                                    {!isKunde && (
                                        <td className="d-none d-lg-table-cell">
                                            {pos.zerlegung ? (
                                                <Form.Control
                                                    type="text"
                                                    className="form-control-sm"
                                                    placeholder="Zerlege-Bemerkung"
                                                    value={pos.zerlegeBemerkung || ''}
                                                    onChange={(e) => handleChange(index, 'zerlegeBemerkung', e.target.value)}
                                                />
                                            ) : (
                                                ''
                                            )}
                                        </td>
                                    )}
                                    {/* Einzelpreis */}
                                    <td className="d-none d-sm-table-cell">
                                        {(pos.einzelpreis ?? 0).toFixed(2)} €
                                    </td>
                                    {/* Gewicht */}
                                    <td className="d-none d-sm-table-cell">
                                        {(pos.gesamtgewicht ?? 0).toFixed(2)} kg
                                    </td>
                                    {/* Gesamtpreis */}
                                    <td className="d-none d-lg-table-cell print-hidden">
                                        {(pos.gesamtpreis ?? 0).toFixed(2)} €
                                    </td>
                                    {/* Aktionen */}
                                    {!isKunde && (
                                        <td className="print-hidden">
                                            <Button variant="danger" size="sm" title="Löschen" onClick={() => handleDelete(index)}>
                                                <i className="ci-trash"></i>
                                            </Button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            </div>
            {!isKunde && positions.length > 0 && (
                <div className="text-center mt-4">
                    <Button className="print-hidden" variant="primary" onClick={onSave} disabled={saving}>
                        {saving ? (
                            <>
                                <Spinner animation="border" size="sm" className="me-2" />
                                Speichern...
                            </>
                        ) : (
                            'Alle Positionen speichern'
                        )}
                    </Button>
                </div>
            )}
        </div>
    );
};

export default AuftragPositionenTabelle;