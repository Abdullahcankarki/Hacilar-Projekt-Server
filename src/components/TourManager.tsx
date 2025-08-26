import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragEndEvent, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dayjs from "dayjs";
import { DateRange } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";

import { TourResource, TourStopResource, TourStatus, StopStatus } from "../Resources";
import {
    getAllTours,
    createTour,
    updateTour,
    deleteTour,
    listTourStops,
    reorderTourStops,
    createTourStop,
    deleteTourStop,
    updateTourStop,
    getAllFahrzeuge,
    getAllMitarbeiter,
    getAllReihenfolgeVorlages,
    moveTourStop,
} from "../backend/api";


// ==== Aux types for lookups ====
type Fahrzeug = { id: string; name: string; kennzeichen?: string; maxGewichtKg?: number };
type Mitarbeiter = { id: string; name: string; rollen: string[] };
type ReihenfolgeVorlage = { id: string; name: string };

const renderFahrzeugLabel = (f?: Fahrzeug) =>
    f ? [f.kennzeichen, f.name].filter(Boolean).join(" · ") : "";


// ==== Utility ====
const fmtDate = (d: string | number | Date) => dayjs(d).format("DD.MM.YYYY");
const statusBadge = (s: TourStatus) =>
    ({ geplant: "secondary", laufend: "info", abgeschlossen: "success", archiviert: "dark" }[s] || "secondary");

const stopStatusVariant = (s: any) => (
    {
        offen: "secondary",
        unterwegs: "info",
        zugestellt: "success",
        teilweise: "warning",
        fehlgeschlagen: "danger",
        in_bearbeitung: "info",
        fertig: "success",
        abgebrochen: "danger",
    }[String(s)] || "secondary"
);

const stopStatusLabel = (s: any) => {
    const map: Record<string, string> = {
        in_bearbeitung: "In Bearbeitung",
    };
    const raw = String(s);
    if (map[raw]) return map[raw];
    const nice = raw.replace(/_/g, " ");
    return nice.charAt(0).toUpperCase() + nice.slice(1);
};

function cx(...classes: (string | undefined | false)[]) { return classes.filter(Boolean).join(" "); }

// Normalize values for UI & API
const toDateInput = (v: any): string => {
    if (!v) return dayjs().format("YYYY-MM-DD");
    const d = dayjs(v);
    return d.isValid() ? d.format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD");
};
// mode: 'upper' = FULL CAPS, 'capitalized' = Only first letter upper
const formatRegion = (s: string, mode: 'upper' | 'capitalized' = 'capitalized') => {
    if (!s) return s;
    const trimmed = s.trim();
    if (mode === 'upper') return trimmed.toUpperCase();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
};

// ==== Toast (Cartzilla/Bootstrap) ====
type ToastT = { type: "success" | "danger"; msg: string };
const Toast: React.FC<{ toast: ToastT | null; onClose: () => void }> = ({ toast, onClose }) => {
    if (!toast) return null;
    return (
        <div
            className={cx(
                "toast align-items-center text-bg-" + (toast.type === "success" ? "success" : "danger"),
                "border-0 position-fixed bottom-0 end-0 m-3 show"
            )}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{ zIndex: 1090 }}
        >
            <div className="d-flex">
                <div className="toast-body">{toast.msg}</div>
                <button type="button" className="btn-close btn-close-white me-2 m-auto" onClick={onClose} />
            </div>
        </div>
    );
};

// ==== Sort helpers ====
type SortKey = "datum" | "region" | "status";
const sortTours = (items: TourResource[], key: SortKey, dir: "asc" | "desc") => {
    const sorted = [...items].sort((a, b) => {
        const va = key === "datum" ? new Date(a.datum).getTime() : (a[key] as any) ?? "";
        const vb = key === "datum" ? new Date(b.datum).getTime() : (b[key] as any) ?? "";
        return va < vb ? -1 : va > vb ? 1 : 0;
    });
    return dir === "asc" ? sorted : sorted.reverse();
};

// ==== Sortable Stop Item ====
const SortableStopItem: React.FC<{ stop: TourStopResource }> = ({ stop }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id! });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        // Keep pointer cursor while dragging handles
        cursor: "grab",
    };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <StopItem stop={stop} isDragging={isDragging} />
        </div>
    );
};

const StopItem: React.FC<{
    stop: TourStopResource;
    isDragging?: boolean;
}> = ({ stop, isDragging }) => (
    <div
        className={cx(
            "card mb-2 border-0 shadow-sm",
            isDragging && "opacity-75"
        )}
        style={{ cursor: "grab" }}
    >
        <div className="card-body d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-3">
                <i className="ci-move" aria-hidden />
                <div>
                    <div className="fw-semibold">{stop.kundeName ?? `Kunde #${stop.kundeId}`}</div>
                </div>
            </div>
            <div className="d-flex align-items-center gap-2">
                <span className={`badge text-bg-${stopStatusVariant(stop.status)}`}>{stopStatusLabel(stop.status)}</span>
                <span className="badge text-bg-light d-flex align-items-center gap-1">
                    <i className="ci-scale" aria-hidden />
                    {Number(stop.gewichtKg ?? 0).toFixed(1)} kg
                </span>
            </div>
        </div>
    </div>
);

// ==== Tour Card with Stops ====
const TourColumn: React.FC<{
    tour: TourResource;
    fahrzeuge: Record<string, Fahrzeug>;
    fahrer: Record<string, Mitarbeiter>;
    vorlagen: Record<string, ReihenfolgeVorlage>;
    stops: TourStopResource[];
    onEdit: (t: TourResource) => void;
    onDelete: (t: TourResource) => void;
}> = ({ tour, fahrzeuge, fahrer, vorlagen, stops, onEdit, onDelete }) => {
    const fahrzeugName = tour.fahrzeugId ? fahrzeuge[tour.fahrzeugId]?.name : undefined;
    const fahrerName = tour.fahrerId ? fahrer[tour.fahrerId]?.name : undefined;
    const vorlageName = tour.reihenfolgeVorlageId ? vorlagen[tour.reihenfolgeVorlageId]?.name : undefined;
    const fahrzeugLabel = tour.fahrzeugId ? renderFahrzeugLabel(fahrzeuge[tour.fahrzeugId]) : "";

    const { setNodeRef: setContainerRef } = useDroppable({ id: tour.id! });

    return (
        <div id={tour.id} ref={setContainerRef} data-tour-container style={{ minHeight: 24 }}>
            <div className="card h-100 border-0 shadow-sm">
                <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
                    <div>
                        <div className="d-flex align-items-center gap-2">
                            <h5 className="mb-0">{tour.name || `Tour ${tour.region}`}</h5>
                            {tour.isStandard && <span className="badge text-bg-primary">Standard</span>}
                            {tour.overCapacityFlag && <span className="badge text-bg-danger">Überkapazität</span>}
                        </div>
                        <div className="text-muted small">
                            {fmtDate(tour.datum)} · {formatRegion(tour.region, 'capitalized')} ·
                            {" "}{fahrzeugLabel ? `Fzg: ${fahrzeugLabel}` : "Fzg: —"} ·
                            {" "}{fahrerName ? `Fahrer: ${fahrerName}` : "Fahrer: —"}
                            {tour.maxGewichtKg ? ` · Max ${tour.maxGewichtKg} kg` : ""}
                            {" "}· Belegt {tour.belegtesGewichtKg?.toFixed?.(1) ?? 0} kg
                            {vorlageName ? ` · Vorlage: ${vorlageName}` : ""}
                        </div>
                    </div>
                    <div className="btn-group">
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => onEdit(tour)}>
                            <i className="ci-edit me-1" /> Bearbeiten
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(tour)}>
                            <i className="ci-trash me-1" /> Löschen
                        </button>
                    </div>
                </div>

                <div className="card-body">
                    <SortableContext items={stops.map(s => s.id!)} strategy={verticalListSortingStrategy}>
                        {stops.map((s) => (
                            <SortableStopItem key={s.id} stop={s} />
                        ))}
                        {!stops.length && (
                            <div className="text-muted small">Keine Stopps.</div>
                        )}
                    </SortableContext>
                </div>
            </div>
        </div>
    );
};

// ==== Create / Edit Modal ====
const TourModal: React.FC<{
    show: boolean;
    onClose: () => void;
    onSubmit: (data: Partial<TourResource>) => Promise<void>;
    initial?: Partial<TourResource>;
    fahrzeuge: Fahrzeug[];
    fahrer: Mitarbeiter[];
    vorlagen: ReihenfolgeVorlage[];
}> = ({ show, onClose, onSubmit, initial, fahrzeuge, fahrer, vorlagen }) => {
    const [form, setForm] = useState<Partial<TourResource>>({
        datum: toDateInput(initial?.datum ?? dayjs().format("YYYY-MM-DD")),
        region: initial?.region ?? "",
        name: initial?.name ?? "",
        fahrzeugId: initial?.fahrzeugId,
        fahrerId: initial?.fahrerId,
        reihenfolgeVorlageId: initial?.reihenfolgeVorlageId,
        maxGewichtKg: initial?.maxGewichtKg,
        status: initial?.status ?? "geplant",
        isStandard: initial?.isStandard ?? false,
    });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (show) {
            const base: Partial<TourResource> = {
                datum: toDateInput(initial?.datum ?? dayjs().format("YYYY-MM-DD")),
                region: initial?.region ?? "",
                name: initial?.name ?? "",
                fahrzeugId: initial?.fahrzeugId,
                fahrerId: initial?.fahrerId,
                reihenfolgeVorlageId: initial?.reihenfolgeVorlageId,
                maxGewichtKg: initial?.maxGewichtKg,
                status: initial?.status ?? "geplant",
                isStandard: initial?.isStandard ?? false,
            };
            // Falls kein explizites Maxgewicht gesetzt ist, versuche vom ausgewählten Fahrzeug zu übernehmen
            if ((base.maxGewichtKg === undefined || base.maxGewichtKg === null) && base.fahrzeugId) {
                const veh = fahrzeuge.find(f => f.id === base.fahrzeugId);
                if (veh?.maxGewichtKg !== undefined) {
                    base.maxGewichtKg = veh.maxGewichtKg;
                }
            }
            setForm(base);
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
    }, [show, initial, fahrzeuge]);

    if (!show) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await onSubmit(form);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return createPortal(
        <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" style={{ zIndex: 1055 }}>
            <div className="modal-dialog modal-lg modal-dialog-centered" role="document">
                <div className="modal-content border-0 shadow-lg">
                    <div className="modal-header">
                        <h5 className="modal-title">{initial?.id ? "Tour bearbeiten" : "Neue Tour erstellen"}</h5>
                        <button type="button" className="btn-close" onClick={onClose} aria-label="Schließen" />
                    </div>

                    <form onSubmit={handleSubmit}>
                        <div className="modal-body">
                            <div className="row g-3">
                                <div className="col-md-4">
                                    <label className="form-label">Datum</label>
                                    <input
                                        type="date"
                                        className="form-control"
                                        value={form.datum ?? ""}
                                        onChange={(e) => setForm({ ...form, datum: e.target.value })}
                                        required
                                    />

                                </div>

                                <div className="col-md-4">
                                    <label className="form-label">Region</label>
                                    <input
                                        className="form-control"
                                        placeholder="z. B. Berlin"
                                        value={form.region ?? ""}
                                        onChange={(e) => setForm({ ...form, region: e.target.value })}
                                        onBlur={(e) => setForm({ ...form, region: formatRegion(e.target.value, 'capitalized') })}
                                        required
                                    />
                                </div>

                                <div className="col-md-4">
                                    <label className="form-label">Name</label>
                                    <input
                                        className="form-control"
                                        placeholder='z. B. "Berlin #2"'
                                        value={form.name ?? ""}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    />
                                </div>

                                <div className="col-md-6">
                                    <label className="form-label">Fahrzeug</label>
                                    <select
                                        className="form-select"
                                        value={form.fahrzeugId ?? ""}
                                        onChange={(e) => {
                                            const id = e.target.value || undefined;
                                            const veh = fahrzeuge.find(f => f.id === id);
                                            setForm((prev) => ({
                                                ...prev,
                                                fahrzeugId: id,
                                                // Immer vom gewählten Fahrzeug übernehmen (oder leeren, wenn keins gewählt)
                                                maxGewichtKg: veh?.maxGewichtKg ?? undefined,
                                            }));
                                        }}
                                    >
                                    <option value="">—</option>
                                    {fahrzeuge.map((f) => (
                                        <option key={f.id} value={f.id}>{renderFahrzeugLabel(f)}</option>
                                    ))}
                                </select>
                                {form.fahrzeugId && (
                                    <div className="form-text">
                                        Max. Gewicht: {fahrzeuge.find(f => f.id === form.fahrzeugId)?.maxGewichtKg ?? "—"} kg
                                    </div>
                                )}
                            </div>

                            <div className="col-md-6">
                                <label className="form-label">Fahrer (nur Rolle „fahrer“)</label>
                                <select
                                    className="form-select"
                                    value={form.fahrerId ?? ""}
                                    onChange={(e) => setForm({ ...form, fahrerId: e.target.value || undefined })}
                                >
                                    <option value="">—</option>
                                    {fahrer.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="col-md-6">
                                <label className="form-label">Reihenfolgevorlage</label>
                                <select
                                    className="form-select"
                                    value={form.reihenfolgeVorlageId ?? ""}
                                    onChange={(e) => setForm({ ...form, reihenfolgeVorlageId: e.target.value || undefined })}
                                >
                                    <option value="">—</option>
                                    {vorlagen.map((v) => (
                                        <option key={v.id} value={v.id}>{v.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="col-md-3">
                                <label className="form-label">Max. Gewicht (kg)</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="form-control"
                                    placeholder="vom Fzg. übernehmen"
                                    value={form.maxGewichtKg ?? ""}
                                    onChange={(e) => setForm({ ...form, maxGewichtKg: e.target.value ? Number(e.target.value) : undefined })}
                                />
                            </div>

                            <div className="col-md-3">
                                <label className="form-label">Status</label>
                                <select
                                    className="form-select"
                                    value={form.status ?? "geplant"}
                                    onChange={(e) => setForm({ ...form, status: e.target.value as TourStatus })}
                                >
                                    <option value="geplant">geplant</option>
                                    <option value="laufend">laufend</option>
                                    <option value="abgeschlossen">abgeschlossen</option>
                                    <option value="archiviert">archiviert</option>
                                </select>
                            </div>

                            <div className="col-12">
                                <div className="form-check">
                                    <input
                                        className="form-check-input"
                                        type="checkbox"
                                        id="isStandard"
                                        checked={!!form.isStandard}
                                        onChange={(e) => setForm({ ...form, isStandard: e.target.checked })}
                                    />
                                    <label htmlFor="isStandard" className="form-check-label">Standardtour</label>
                                </div>
                            </div>
                        </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Abbrechen</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? "Speichern…" : "Speichern"}
                    </button>
                </div>
            </form>
        </div>
            </div >
    {/* Backdrop removed */ }
        </div >,
    document.body
    );
};

// ==== Delete Modal ====
const ConfirmModal: React.FC<{ show: boolean; onClose: () => void; onConfirm: () => Promise<void>; title: string; body?: string }> = ({ show, onClose, onConfirm, title, body }) => {
    const [busy, setBusy] = useState(false);
    useEffect(() => { document.body.style.overflow = show ? "hidden" : ""; }, [show]);
    if (!show) return null;

    const handle = async () => {
        setBusy(true);
        try { await onConfirm(); onClose(); } finally { setBusy(false); }
    };

    return createPortal(
        <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true" style={{ zIndex: 1055 }}>
            <div className="modal-dialog modal-dialog-centered" role="document">
                <div className="modal-content border-0 shadow-lg">
                    <div className="modal-header">
                        <h5 className="modal-title">{title}</h5>
                        <button type="button" className="btn-close" onClick={onClose} aria-label="Schließen" />
                    </div>
                    <div className="modal-body">
                        <p className="mb-0">{body ?? "Diese Aktion kann nicht rückgängig gemacht werden."}</p>
                    </div>
                    <div className="modal-footer">
                        <button className="btn btn-outline-secondary" onClick={onClose}>Abbrechen</button>
                        <button className="btn btn-danger" onClick={handle} disabled={busy}>{busy ? "Löschen…" : "Löschen"}</button>
                    </div>
                </div>
            </div>
            {/* Backdrop removed */}
        </div>,
        document.body
    );
};

// ==== Main Manager ====
export const TourManager: React.FC = () => {
    const [tours, setTours] = useState<TourResource[]>([]);
    const [stopsByTour, setStopsByTour] = useState<Record<string, TourStopResource[]>>({});
    const [fahrzeuge, setFahrzeuge] = useState<Fahrzeug[]>([]);
    const [fahrer, setFahrer] = useState<Mitarbeiter[]>([]);
    const [vorlagen, setVorlagen] = useState<ReihenfolgeVorlage[]>([]);
    const [toast, setToast] = useState<ToastT | null>(null);

    const [sortKey, setSortKey] = useState<SortKey>("datum");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    const [q, setQ] = useState("");

    // Advanced filters (mirror backend listTours params)
    const [dateFrom, setDateFrom] = useState<string>("");
    const [dateTo, setDateTo] = useState<string>("");
    const [region, setRegion] = useState<string>("");
    const [statusSel, setStatusSel] = useState<TourStatus[]>([]); // multi-select
    const [fahrzeugIdFilter, setFahrzeugIdFilter] = useState<string>("");
    const [fahrerIdFilter, setFahrerIdFilter] = useState<string>("");
    const [isStandardFilter, setIsStandardFilter] = useState<boolean | "">("");
    const [sortServer, setSortServer] = useState<"datumAsc" | "datumDesc" | "createdDesc">("datumAsc");
    const [page, setPage] = useState<number>(1);
    const [limit, setLimit] = useState<number>(20);
    const [total, setTotal] = useState<number>(0);
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [availableRegions, setAvailableRegions] = useState<string[]>([]);

    const [showRange, setShowRange] = useState(false);
    const rangeWrapRef = useRef<HTMLDivElement | null>(null);
    // Responsive months count for DateRange
    const rangeBtnRef = useRef<HTMLButtonElement | null>(null);
    const rangePanelRef = useRef<HTMLDivElement | null>(null);
    const [rangePos, setRangePos] = useState<{ top: number; left: number } | null>(null);
    const [monthsCount, setMonthsCount] = useState<number>(window.innerWidth < 576 ? 1 : 2);
    useEffect(() => {
        const onResize = () => setMonthsCount(window.innerWidth < 576 ? 1 : 2);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowRange(false); };
        const onClick = (e: MouseEvent) => {
            const target = e.target as Node;
            const wrap = rangeWrapRef.current;
            const panel = rangePanelRef.current;
            if (wrap && wrap.contains(target)) return;   // clicks on the trigger area
            if (panel && panel.contains(target)) return; // clicks inside the popup
            setShowRange(false);
        };
        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onClick);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("mousedown", onClick);
        };
    }, []);

    useEffect(() => {
        document.body.style.overflow = showFilterModal ? "hidden" : "";
    }, [showFilterModal]);

    // ---- UX helpers for filters ----
    const resetFilters = () => {
        setDateFrom("");
        setDateTo("");
        setRegion("");
        setStatusSel([]);
        setFahrzeugIdFilter("");
        setFahrerIdFilter("");
        setIsStandardFilter("");
        setQ("");
        setSortServer("datumAsc");
        setPage(1);
    };

    const toggleStatus = (s: TourStatus) => {
        setPage(1);
        setStatusSel((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    };

    // Date presets
    const setToday = () => {
        const d = dayjs().format("YYYY-MM-DD");
        setPage(1); setDateFrom(d); setDateTo(d);
    };
    const setThisWeek = () => {
        const start = dayjs().startOf("week").format("YYYY-MM-DD");
        const end = dayjs().endOf("week").format("YYYY-MM-DD");
        setPage(1); setDateFrom(start); setDateTo(end);
    };
    const setThisMonth = () => {
        const start = dayjs().startOf("month").format("YYYY-MM-DD");
        const end = dayjs().endOf("month").format("YYYY-MM-DD");
        setPage(1); setDateFrom(start); setDateTo(end);
    };

    const fahrzeugeMap = useMemo(() => Object.fromEntries(fahrzeuge.map(f => [f.id, f])), [fahrzeuge]);
    const fahrerMap = useMemo(() => Object.fromEntries(fahrer.map(m => [m.id, m])), [fahrer]);
    const vorlagenMap = useMemo(() => Object.fromEntries(vorlagen.map(v => [v.id, v])), [vorlagen]);

    // DnD sensors
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } })
    );

    // selections for modals
    const [showCreate, setShowCreate] = useState(false);
    const [editing, setEditing] = useState<TourResource | null>(null);
    const [deleting, setDeleting] = useState<TourResource | null>(null);

    // DnD overlay state
    const [activeStop, setActiveStop] = useState<TourStopResource | null>(null);

    const load = async () => {
        const params: any = {
            // dates only if set
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            region: region || undefined,
            status: statusSel.length ? statusSel : undefined,
            fahrzeugId: fahrzeugIdFilter || undefined,
            fahrerId: fahrerIdFilter || undefined,
            isStandard: isStandardFilter === "" ? undefined : isStandardFilter,
            q: q || undefined,
            page,
            limit,
            sort: sortServer,
        };

        const [toursResp, f, m, v] = await Promise.all([
            getAllTours(params),
            getAllFahrzeuge(),
            getAllMitarbeiter(),
            getAllReihenfolgeVorlages(),
        ]);

        // handle both array and paginated {items: []} responses for all
        const t = (Array.isArray(toursResp) ? toursResp : (toursResp.items ?? [])) as TourResource[];
        const fItems = (Array.isArray(f) ? f : (f.items ?? [])) as Fahrzeug[];
        const mItems = (Array.isArray(m) ? m : ((m as any).items ?? [])) as Mitarbeiter[];
        const vItems = (Array.isArray(v) ? v : (v.items ?? [])) as ReihenfolgeVorlage[];

        // pagination info if provided
        if (!Array.isArray(toursResp)) {
            setTotal((toursResp as any).total ?? t.length);
            setPage((toursResp as any).page ?? page);
            setLimit((toursResp as any).limit ?? limit);
        } else {
            setTotal(t.length);
        }

        setTours(sortTours(t, sortKey, sortDir));
        setFahrzeuge(fItems);
        setFahrer(mItems.filter(x => Array.isArray(x.rollen) && x.rollen.includes("fahrer")));
        setVorlagen(vItems);
        // Regions ableiten (eindeutig, sortiert)
        const regions = Array.from(
            new Set(
                t.map(x => formatRegion((x.region || ''), 'capitalized')).filter(Boolean)
            )
        ).sort((a, b) => a.localeCompare(b));
        setAvailableRegions(regions);

        // load stops for each tour
        const entries = await Promise.all(
            t.map(async (tour) => [tour.id!, await listTourStops({ tourId: tour.id! })] as const)
        );
        const dict: Record<string, TourStopResource[]> = {};
        for (const [id, stops] of entries) {
            dict[id] = [...stops].sort((a, b) => a.position - b.position);
        }
        setStopsByTour(dict);
    };

    useEffect(() => { load().catch(() => setToast({ type: "danger", msg: "Fehler beim Laden" })); }, []);

    // reload when filters/pagination change
    useEffect(() => {
        load().catch(() => setToast({ type: "danger", msg: "Fehler beim Laden" }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateFrom, dateTo, region, JSON.stringify(statusSel), fahrzeugIdFilter, fahrerIdFilter, isStandardFilter, sortServer, page, limit, q]);

    // resort when sort changes
    useEffect(() => {
        setTours((prev) => sortTours(prev, sortKey, sortDir));
    }, [sortKey, sortDir]);

    const filteredTours = useMemo(() => {
        const t = q
            ? tours.filter(t => (t.region + " " + (t.name ?? "")).toLowerCase().includes(q.toLowerCase()))
            : tours;
        return sortTours(t, sortKey, sortDir);
    }, [tours, q, sortKey, sortDir]);

    // Create / Update handlers (optimistic)
    const handleCreate = async (data: Partial<TourResource>) => {
        // build payload matching API contract (datum & region required)
        const payload = {
            datum: toDateInput(data.datum ?? dayjs().format("YYYY-MM-DD")),
            region: formatRegion(String(data.region ?? ""), 'capitalized'),
            name: data.name,
            fahrzeugId: data.fahrzeugId,
            fahrerId: data.fahrerId,
            maxGewichtKg: data.maxGewichtKg,
            status: data.status as TourStatus | undefined,
            reihenfolgeVorlageId: data.reihenfolgeVorlageId,
            isStandard: data.isStandard,
            parentTourId: data.parentTourId,
            splitIndex: data.splitIndex,
        };
        const created = await createTour(payload);
        setTours((prev) => sortTours([created, ...prev], sortKey, sortDir));
        setStopsByTour((prev) => ({ ...prev, [created.id!]: [] }));
        setToast({ type: "success", msg: "Tour erstellt." });
    };

    const handleUpdate = async (id: string, data: Partial<TourResource>) => {
        const prev = tours;
        const idx = prev.findIndex(t => t.id === id);
        if (idx < 0) return;

        const optimistic = { ...prev[idx], ...data };
        setTours(sortTours(prev.map((t, i) => (i === idx ? optimistic : t)), sortKey, sortDir));

        try {
            const normalized = {
                ...data,
                ...(data.datum !== undefined ? { datum: toDateInput(data.datum) } : {}),
                ...(data.region !== undefined ? { region: formatRegion(String(data.region), 'capitalized') } : {}),
            } as Partial<TourResource>;
            const saved = await updateTour(id, normalized);
            setTours((curr) => sortTours(curr.map(t => (t.id === id ? { ...t, ...saved } : t)), sortKey, sortDir));
            setToast({ type: "success", msg: "Tour aktualisiert." });
        } catch {
            setTours(prev); // rollback
            setToast({ type: "danger", msg: "Aktualisierung fehlgeschlagen." });
        }
    };

    const handleDelete = async (id: string) => {
        const prevTours = tours;
        const prevStops = stopsByTour;
        setTours((current) => current.filter(t => t.id !== id));
        setStopsByTour((current) => {
            const copy = { ...current };
            delete copy[id];
            return copy;
        });
        try {
            await deleteTour(id);
            setToast({ type: "success", msg: "Tour gelöscht." });
        } catch {
            setTours(prevTours);
            setStopsByTour(prevStops);
            setToast({ type: "danger", msg: "Löschen fehlgeschlagen." });
        }
    };

    // ==== Drag & Drop logic (within and across tours) ====
    const findStopById = (stopId: string) => {
        for (const tid of Object.keys(stopsByTour)) {
            const s = stopsByTour[tid].find(st => st.id === stopId);
            if (s) return s;
        }
        return null;
    };

    const onDragStart = (e: any) => {
        const stopId = e.active?.id as string | undefined;
        if (!stopId) return;
        const stop = findStopById(stopId);
        setActiveStop(stop);
    };

    const onDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveStop(null);
        if (!over) return;

        const activeId = String(active.id);
        const overId = String(over.id);

        // over can be a stop or a tour container
        const fromTourId = Object.keys(stopsByTour).find(tid => stopsByTour[tid].some(s => s.id === activeId));
        if (!fromTourId) return;

        const isOverStop = Object.values(stopsByTour).some(list => list.some(s => s.id === overId));
        const toTourId = isOverStop
            ? Object.keys(stopsByTour).find(tid => stopsByTour[tid].some(s => s.id === overId))!
            : overId; // when using containers keyed by tourId

        if (!toTourId) return;

        const fromList = stopsByTour[fromTourId];
        const activeIndex = fromList.findIndex(s => s.id === activeId);

        if (fromTourId === toTourId) {
            // Reorder within same tour
            const toIndex = isOverStop
                ? stopsByTour[toTourId].findIndex(s => s.id === overId)
                : fromList.length;

            // Guard: normalize invalid index and avoid no-op updates
            const safeToIndex = toIndex < 0 ? fromList.length - 1 : toIndex;
            if (safeToIndex === activeIndex) return;

            const newList = arrayMove(fromList, activeIndex, safeToIndex);
            // fix positions locally
            const withPos = newList.map((s, i) => ({ ...s, position: i + 1 }));
            setStopsByTour({ ...stopsByTour, [fromTourId]: withPos });

            try {
                const ids = withPos.map(s => s.id).filter(Boolean) as string[];
                if (!ids.length) return; // nothing to update
                await reorderTourStops(fromTourId, ids);
            } catch (e) {
                console.error("reorderTourStops failed", e);
                // reload on failure
                await load();
                setToast({ type: "danger", msg: "Neuordnung fehlgeschlagen." });
            }
            // REPLACE: nur der else-Block (Move across tours)
        } else {
            // Nutze *Kopien*, nicht die State-Arrays direkt
            const fromListOrig = stopsByTour[fromTourId] ?? [];
            const toListOrig = stopsByTour[toTourId] ?? [];
            const fromList = [...fromListOrig];
            const toList = [...toListOrig];

            const rawToIndex = isOverStop ? toList.findIndex(s => s.id === overId) : toList.length;
            const targetIndex = rawToIndex < 0 ? toList.length : rawToIndex;

            // 1) Lokal: aus Quelle nehmen, in Ziel (Client) einfügen
            const [moved] = fromList.splice(activeIndex, 1);
            const updatedMoved: TourStopResource = { ...moved, tourId: toTourId };
            const newFrom = fromList.map((s, i) => ({ ...s, position: i + 1 }));
            // Für die UI fügen wir „virtuell“ an targetIndex ein
            const newToVirtual = [
                ...toList.slice(0, targetIndex),
                updatedMoved,
                ...toList.slice(targetIndex),
            ].map((s, i) => ({ ...s, position: i + 1 }));

            setStopsByTour({ ...stopsByTour, [fromTourId]: newFrom, [toTourId]: newToVirtual });

            try {
                // Atomarer Move über die neue Backend-Route
                await moveTourStop(activeId, { toTourId, targetIndex });
                await load();
            } catch (e) {
                console.error("move across tours failed", e);
                await load(); // rollback auf Serverzustand
                setToast({ type: "danger", msg: "Verschieben fehlgeschlagen." });
            }
        }
    };

    return (
        <div className="container py-3">
            {/* Header */}
            <div className="d-flex align-items-center justify-content-between mb-3">
                <div>
                    <h2 className="h4 mb-1">Tourenverwaltung</h2>
                    <div className="text-muted small">{tours.length} Touren gesamt</div>
                </div>
                <div className="d-flex gap-2">
                    <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                        <i className="ci-plus me-2" /> Tour erstellen
                    </button>
                </div>
            </div>

            {/* Filters / Sorting */}
            <div className="card shadow-sm border-0 mb-3">
                {/* Filters Toolbar */}
                <div className="d-flex align-items-center justify-content-between mb-3">
                    <div className="text-muted small d-flex flex-wrap gap-2">
                        {dateFrom && <span className="badge text-bg-light">Von {dayjs(dateFrom).format("DD.MM.YYYY")}</span>}
                        {dateTo && <span className="badge text-bg-light">Bis {dayjs(dateTo).format("DD.MM.YYYY")}</span>}
                        {region && <span className="badge text-bg-light">Region: {region}</span>}
                        {!!statusSel.length && <span className="badge text-bg-light">Status: {statusSel.join(", ")}</span>}
                        {fahrzeugIdFilter && <span className="badge text-bg-light">Fahrzeug</span>}
                        {fahrerIdFilter && <span className="badge text-bg-light">Fahrer</span>}
                        {isStandardFilter !== "" && <span className="badge text-bg-light">{isStandardFilter ? "Standard" : "Nicht-Standard"}</span>}
                        {q && <span className="badge text-bg-light">q: “{q}”</span>}
                    </div>
                    <div className="d-flex gap-2">
                        <button className="btn btn-outline-dark" onClick={() => setShowFilterModal(true)}>
                            <i className="ci-filter me-2" /> Filtern & Sortieren
                        </button>
                        <button className="btn btn-outline-secondary" onClick={resetFilters}>
                            Zurücksetzen
                        </button>
                    </div>
                </div>

                {showFilterModal && createPortal(
                    <>
                        <div
                            className="offcanvas offcanvas-start show"
                            tabIndex={-1}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="filterOffcanvasLabel"
                            style={{ visibility: "visible", width: "min(90vw, 560px)", zIndex: 1055 }}
                        >
                            <div className="offcanvas-header">
                                <h5 className="offcanvas-title" id="filterOffcanvasLabel">Filtern & Sortieren</h5>
                                <button type="button" className="btn-close text-reset" aria-label="Schließen" onClick={() => setShowFilterModal(false)} />
                            </div>
                            <div className="offcanvas-body">
                                <div className="accordion" id="filterAcc">
                                    {/* Zeitraum */}
                                    <div className="accordion-item">
                                        <h2 className="accordion-header" id="acc-date-h">
                                            <button className="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#acc-date" aria-expanded="true" aria-controls="acc-date">
                                                Zeitraum auswählen
                                            </button>
                                        </h2>
                                        <div id="acc-date" className="accordion-collapse collapse show" aria-labelledby="acc-date-h" data-bs-parent="#filterAcc">
                                            <div className="accordion-body">
                                                <div className="row g-3 align-items-end">
                                                    <div className="col-12" ref={rangeWrapRef}>
                                                        <label className="form-label">Zeitraum</label>
                                                        <div className="position-relative">
                                                            <button
                                                                type="button"
                                                                className="btn btn-outline-secondary d-flex align-items-center gap-2"
                                                                ref={rangeBtnRef}
                                                                onClick={() => {
                                                                    const btn = rangeBtnRef.current;
                                                                    if (btn) {
                                                                        const r = btn.getBoundingClientRect();
                                                                        setRangePos({ top: r.bottom + window.scrollY + 8, left: r.left + window.scrollX });
                                                                    }
                                                                    setShowRange((s) => !s);
                                                                }}
                                                            >
                                                                <i className="ci-calendar" />
                                                                {dateFrom ? dayjs(dateFrom).format("DD.MM.YYYY") : "Start"} – {dateTo ? dayjs(dateTo).format("DD.MM.YYYY") : "Ende"}
                                                            </button>

                                                            {showRange && rangePos && createPortal(
                                                                <div
                                                                    ref={rangePanelRef}
                                                                    className="shadow border bg-white rounded-3 p-2"
                                                                    onWheel={(e) => e.stopPropagation()}
                                                                    onTouchMove={(e) => e.stopPropagation()}
                                                                    style={{
                                                                        position: "fixed",
                                                                        top: Math.min(rangePos.top, window.innerHeight - 24),
                                                                        left: Math.min(
                                                                            rangePos.left,
                                                                            window.innerWidth - (monthsCount === 1 ? 380 : 740)
                                                                        ),
                                                                        zIndex: 2000,
                                                                        maxHeight: "min(80vh, 720px)",
                                                                        overflow: "auto",
                                                                        WebkitOverflowScrolling: "touch" as any,
                                                                        overscrollBehavior: "contain" as any,
                                                                    }}
                                                                >
                                                                    <DateRange
                                                                        onChange={(ranges: any) => {
                                                                            const sel = ranges.selection || ranges[0] || ranges;
                                                                            const s = dayjs(sel.startDate).format("YYYY-MM-DD");
                                                                            const e = dayjs(sel.endDate).format("YYYY-MM-DD");
                                                                            setPage(1);
                                                                            setDateFrom(s);
                                                                            setDateTo(e);
                                                                        }}
                                                                        moveRangeOnFirstSelection={false}
                                                                        editableDateInputs
                                                                        ranges={[{
                                                                            startDate: dateFrom ? new Date(dateFrom) : (dateTo ? new Date(dateTo) : new Date()),
                                                                            endDate: dateTo ? new Date(dateTo) : (dateFrom ? new Date(dateFrom) : new Date()),
                                                                            key: "selection",
                                                                        }]}
                                                                        months={monthsCount}
                                                                        direction="horizontal"
                                                                        weekdayDisplayFormat="EE"
                                                                        rangeColors={["#0d6efd"]}
                                                                    />
                                                                    <div className="d-flex justify-content-end gap-2 px-2 pb-1">
                                                                        <button className="btn btn-sm btn-outline-dark" onClick={() => { setPage(1); setDateFrom(""); setDateTo(""); }}>Leeren</button>
                                                                        <button className="btn btn-sm btn-primary" onClick={() => setShowRange(false)}>OK</button>
                                                                    </div>
                                                                </div>,
                                                                document.body
                                                            )}
                                                        </div>
                                                        <div className="form-text">Ziehe den Bereich im Kalender – oder nutze die Presets unten.</div>
                                                    </div>

                                                    <div className="col-12 d-flex flex-wrap gap-2 mt-2">
                                                        <button className="btn btn-outline-secondary" onClick={() => { const d = dayjs(); setPage(1); setDateFrom(d.format("YYYY-MM-DD")); setDateTo(d.format("YYYY-MM-DD")); }}>Heute</button>
                                                        <button className="btn btn-outline-secondary" onClick={() => { const d = dayjs().add(1, "day"); setPage(1); setDateFrom(d.format("YYYY-MM-DD")); setDateTo(d.format("YYYY-MM-DD")); }}>Morgen</button>
                                                        <button className="btn btn-outline-secondary" onClick={() => { const s = dayjs().startOf("week"), e = dayjs().endOf("week"); setPage(1); setDateFrom(s.format("YYYY-MM-DD")); setDateTo(e.format("YYYY-MM-DD")); }}>Diese Woche</button>
                                                        <button className="btn btn-outline-secondary" onClick={() => { const s = dayjs().add(1, "week").startOf("week"), e = dayjs().add(1, "week").endOf("week"); setPage(1); setDateFrom(s.format("YYYY-MM-DD")); setDateTo(e.format("YYYY-MM-DD")); }}>Nächste Woche</button>
                                                        <button className="btn btn-outline-secondary" onClick={() => { const s = dayjs().startOf("month"), e = dayjs().endOf("month"); setPage(1); setDateFrom(s.format("YYYY-MM-DD")); setDateTo(e.format("YYYY-MM-DD")); }}>Dieser Monat</button>
                                                        <button className="btn btn-outline-secondary" onClick={() => { const s = dayjs().add(1, "month").startOf("month"), e = dayjs().add(1, "month").endOf("month"); setPage(1); setDateFrom(s.format("YYYY-MM-DD")); setDateTo(e.format("YYYY-MM-DD")); }}>Nächster Monat</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Basis-Filter */}
                                    <div className="accordion-item mt-2">
                                        <h2 className="accordion-header" id="acc-basic-h">
                                            <button className="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#acc-basic" aria-expanded="false" aria-controls="acc-basic">
                                                Basis-Filter
                                            </button>
                                        </h2>
                                        <div id="acc-basic" className="accordion-collapse collapse" aria-labelledby="acc-basic-h" data-bs-parent="#filterAcc">
                                            <div className="accordion-body">
                                                <div className="row g-3">
                                                    <div className="col-12">
                                                        <label className="form-label">Region</label>
                                                        <select className="form-select" value={region} onChange={(e) => { setPage(1); setRegion(e.target.value); }}>
                                                            <option value="">Alle</option>
                                                            {availableRegions.map((r) => <option key={r} value={r}>{r}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="col-12">
                                                        <label className="form-label">Fahrzeug</label>
                                                        <select className="form-select" value={fahrzeugIdFilter} onChange={(e) => { setPage(1); setFahrzeugIdFilter(e.target.value); }}>
                                                            <option value="">Alle</option>
                                                            {fahrzeuge.map((f) => (<option key={f.id} value={f.id}>{renderFahrzeugLabel(f)}</option>))}
                                                        </select>
                                                    </div>
                                                    <div className="col-12">
                                                        <label className="form-label">Fahrer</label>
                                                        <select className="form-select" value={fahrerIdFilter} onChange={(e) => { setPage(1); setFahrerIdFilter(e.target.value); }}>
                                                            <option value="">Alle</option>
                                                            {fahrer.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
                                                        </select>
                                                    </div>
                                                    <div className="col-12">
                                                        <label className="form-label d-block">Status</label>
                                                        <div className="btn-group flex-wrap" role="group" aria-label="Status">
                                                            {(["geplant", "laufend", "abgeschlossen", "archiviert"] as TourStatus[]).map((s) => (
                                                                <React.Fragment key={s}>
                                                                    <input type="checkbox" className="btn-check" id={`st-md-${s}`} autoComplete="off" checked={statusSel.includes(s)} onChange={() => toggleStatus(s)} />
                                                                    <label className="btn btn-outline-secondary" htmlFor={`st-md-${s}`}>{s}</label>
                                                                </React.Fragment>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="col-12">
                                                        <label className="form-label">Name (q)</label>
                                                        <input className="form-control" placeholder="z. B. Tour-Name" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
                                                    </div>
                                                    <div className="col-6">
                                                        <label className="form-label">Standardtour</label>
                                                        <select className="form-select" value={isStandardFilter === "" ? "" : (isStandardFilter ? "true" : "false")} onChange={(e) => { const v = e.target.value; setPage(1); setIsStandardFilter(v === "" ? "" : v === "true"); }}>
                                                            <option value="">Alle</option>
                                                            <option value="true">Ja</option>
                                                            <option value="false">Nein</option>
                                                        </select>
                                                    </div>
                                                    <div className="col-6">
                                                        <label className="form-label">Sortierung</label>
                                                        <select className="form-select" value={sortServer} onChange={(e) => { setPage(1); setSortServer(e.target.value as any); }}>
                                                            <option value="datumAsc">Datum ↑</option>
                                                            <option value="datumDesc">Datum ↓</option>
                                                            <option value="createdDesc">Neueste erstellt</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Anzeige */}
                                        <div className="accordion-item mt-2">
                                            <h2 className="accordion-header" id="acc-pag-h">
                                                <button className="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#acc-pag" aria-expanded="false" aria-controls="acc-pag">
                                                    Anzeige
                                                </button>
                                            </h2>
                                            <div id="acc-pag" className="accordion-collapse collapse" aria-labelledby="acc-pag-h" data-bs-parent="#filterAcc">
                                                <div className="accordion-body">
                                                    <div className="row g-3">
                                                        <div className="col-6">
                                                            <label className="form-label">Pro Seite</label>
                                                            <select className="form-select" value={limit} onChange={(e) => { setPage(1); setLimit(Number(e.target.value)); }}>
                                                                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="col-6 d-flex align-items-end">
                                                            <div className="text-muted small">{total} Einträge</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="offcanvas-footer d-flex gap-2 p-3 border-top">
                                    <button className="btn btn-outline-secondary flex-fill" onClick={() => setShowFilterModal(false)}>Schließen</button>
                                    <button className="btn btn-primary flex-fill" onClick={() => { setPage(1); load(); setShowFilterModal(false); }}>Anwenden</button>
                                </div>
                            </div>
                        </div>
                        <div className="offcanvas-backdrop fade show" onClick={() => setShowFilterModal(false)} style={{ zIndex: 1050 }} />
                    </>,
                    document.body
                )}

            </div>

            {/* Board */}
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
                <div className="row g-3">
                    {filteredTours.map((tour) => (
                        <div className="col-12 col-lg-6" key={tour.id}>
                            <div data-tour-container>
                                <TourColumn
                                    tour={tour}
                                    fahrzeuge={fahrzeugeMap}
                                    fahrer={fahrerMap}
                                    vorlagen={vorlagenMap}
                                    stops={stopsByTour[tour.id!] ?? []}
                                    onEdit={(t) => setEditing(t)}
                                    onDelete={(t) => setDeleting(t)}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Drag Overlay */}
                <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
                    {activeStop ? <div style={{ transform: CSS.Translate.toString({ x: 0, y: 0, scaleX: 1, scaleY: 1 }) }}><StopItem stop={activeStop} isDragging /></div> : null}
                </DragOverlay>
            </DndContext>

            {/* Pagination */}
            <div className="card-footer bg-transparent d-flex justify-content-between align-items-center">
                <div className="text-muted small">
                    {total} Einträge · Seite {page} von {Math.max(1, Math.ceil(total / Math.max(1, limit)))}
                </div>
                <div className="btn-group">
                    <button className="btn btn-outline-secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                        ← Zurück
                    </button>
                    <button className="btn btn-outline-secondary" disabled={page * limit >= total} onClick={() => setPage(p => p + 1)}>
                        Weiter →
                    </button>
                </div>
            </div>

            {/* Modals */}
            <TourModal
                show={showCreate}
                onClose={() => setShowCreate(false)}
                onSubmit={handleCreate}
                fahrzeuge={fahrzeuge}
                fahrer={fahrer}
                vorlagen={vorlagen}
            />
            <TourModal
                show={!!editing}
                onClose={() => setEditing(null)}
                initial={editing ?? undefined}
                onSubmit={(data) => handleUpdate(editing!.id!, data)}
                fahrzeuge={fahrzeuge}
                fahrer={fahrer}
                vorlagen={vorlagen}
            />
            <ConfirmModal
                show={!!deleting}
                onClose={() => setDeleting(null)}
                title="Tour löschen?"
                body={`Möchten Sie die Tour "${deleting?.name ?? deleting?.region}" wirklich löschen?`}
                onConfirm={() => handleDelete(deleting!.id!)}
            />

            <Toast toast={toast} onClose={() => setToast(null)} />
        </div>
    );
};
