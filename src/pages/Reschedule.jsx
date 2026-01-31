import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { createTrip, deleteTripWithMessages, getTrip, listTripsForUser, removeTripMember } from "../lib/trips";
import ConciergeChat from "../components/ConciergeChat.jsx";
import TripMembers from "../components/TripMembers.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { authedFetch } from "../lib/authedFetch";
import "../style.css";

import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";

function useQuery() {
    return new URLSearchParams(useLocation().search);
}

function makeId() {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch {}
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function mapsUrlFrom(item) {
    const q = (item?.mapsQuery || item?.place || "").trim();
    if (!q) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function Yen({ value }) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return (
        <div className="muted" style={{ marginTop: 6 }}>
            🎫 入場料目安：¥{n.toLocaleString()}
        </div>
    );
}

function clampItems(items) {
    const arr = Array.isArray(items) ? items : [];
    return arr.slice(0, 8).map((x) => ({
        id: String(x?.id || "").trim() || makeId(),
        start: String(x?.start || "09:00"),
        end: String(x?.end || "10:00"),
        place: String(x?.place || "予定"),
        address: String(x?.address || ""),
        description: String(x?.description || ""),
        feeYen: x?.feeYen === null || x?.feeYen === undefined || x?.feeYen === "" ? null : Number(x?.feeYen),
        mapsQuery: String(x?.mapsQuery || ""),
    }));
}

function ensureDayShape(dayObj, dayNum) {
    const src = dayObj || {};
    const items = clampItems(src.items);
    return {
        day: dayNum,
        date: String(src?.date || ""),
        items: items.length
            ? items.map((it) => ({
                  ...it,
                  address: String(it.address || ""),
                  mapsQuery: String(it.mapsQuery || it.place || "予定"),
              }))
            : [
                  {
                      id: makeId(),
                      start: "09:00",
                      end: "10:00",
                      place: "予定",
                      address: "",
                      description: "",
                      feeYen: null,
                      mapsQuery: "予定",
                  },
              ],
    };
}

function SortableItemCard({ dayNum, item, onChange, onRemove, disabled, sortMode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: String(item?.id || ""),
        disabled: !sortMode,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.85 : 1,
        background: "#fff",
        borderRadius: 14,
        border: "1px solid var(--line)",
        padding: sortMode ? 10 : 12,
        boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
        touchAction: sortMode ? "none" : "auto",
        userSelect: sortMode ? "none" : "auto",
        WebkitUserSelect: sortMode ? "none" : "auto",
        WebkitTouchCallout: sortMode ? "none" : "default",
    };

    const url = mapsUrlFrom(item);
    const placeTitle = String(item?.place || "").trim() || "予定";
    const timeLine = `${String(item?.start || "09:00")}〜${String(item?.end || "10:00")}`;

    return (
        <div ref={setNodeRef} style={style} {...(sortMode ? { ...attributes, ...listeners } : {})}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    paddingBottom: sortMode ? 0 : 10,
                    borderBottom: sortMode ? "none" : "1px solid var(--line)",
                    marginBottom: sortMode ? 0 : 10,
                }}
            >
                <div style={{ minWidth: 0 }}>
                    <div
                        style={{
                            fontWeight: 900,
                            fontSize: sortMode ? 14 : 16,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {placeTitle}
                    </div>
                    <div className="muted" style={{ fontWeight: 800, fontSize: sortMode ? 12 : 13, marginTop: 2 }}>
                        {timeLine}
                    </div>
                </div>

                {!sortMode && (
                    <button
                        type="button"
                        onClick={() => onRemove(dayNum, item.id)}
                        disabled={disabled}
                        style={{
                            background: "#ffd08a",
                            fontWeight: 900,
                            borderRadius: 12,
                            padding: "8px 10px",
                            opacity: disabled ? 0.7 : 1,
                            whiteSpace: "nowrap",
                            flex: "0 0 auto",
                        }}
                    >
                        削除
                    </button>
                )}
            </div>

            {!sortMode && (
                <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <label style={{ display: "grid", gap: 6 }}>
                            開始
                            <input type="time" value={String(item.start || "09:00")} onChange={(e) => onChange(dayNum, item.id, "start", e.target.value)} disabled={disabled} />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                            終了
                            <input type="time" value={String(item.end || "10:00")} onChange={(e) => onChange(dayNum, item.id, "end", e.target.value)} disabled={disabled} />
                        </label>
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                        場所
                        <input value={String(item.place || "")} onChange={(e) => onChange(dayNum, item.id, "place", e.target.value)} disabled={disabled} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                        詳細
                        <textarea
                            value={String(item.description || "")}
                            onChange={(e) => onChange(dayNum, item.id, "description", e.target.value)}
                            rows={3}
                            disabled={disabled}
                            style={{
                                width: "100%",
                                borderRadius: 12,
                                border: "1px solid var(--line)",
                                padding: "10px 12px",
                                background: "#fff",
                                resize: "vertical",
                                opacity: disabled ? 0.8 : 1,
                            }}
                        />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                        入場料目安（円）
                        <input
                            type="number"
                            inputMode="numeric"
                            value={item.feeYen === null || item.feeYen === undefined ? "" : String(item.feeYen)}
                            onChange={(e) => {
                                const v = e.target.value;
                                const n = v === "" ? null : Number(v);
                                onChange(dayNum, item.id, "feeYen", Number.isFinite(n) ? n : null);
                            }}
                            disabled={disabled}
                        />
                    </label>

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        {url ? (
                            <a className="icon-btn map-btn" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", width: "fit-content" }}>
                                🗺️地図
                            </a>
                        ) : (
                            <span className="muted">場所を入力すると地図リンクが出ます</span>
                        )}
                        <Yen value={item.feeYen} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Reschedule() {
    const { user, loading: authLoading } = useAuth();

    const queryStr = useQuery();
    const tripIdFromQuery = queryStr.get("trip");

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [trips, setTrips] = useState([]);
    const [selectedId, setSelectedId] = useState(tripIdFromQuery || "");
    const [trip, setTrip] = useState(null);

    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);

    const [sortMode, setSortMode] = useState(false);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }));

    useEffect(() => {
        if (authLoading) return;
        if (!user) return;

        (async () => {
            setLoading(true);
            setError("");
            try {
                const ts = await listTripsForUser(user.uid);
                setTrips(ts);
            } catch (e) {
                setTrips([]);
                setError(String(e?.message || e));
            } finally {
                setLoading(false);
            }
        })();
    }, [authLoading, user]);

    useEffect(() => {
        if (tripIdFromQuery && tripIdFromQuery !== selectedId) {
            setSelectedId(tripIdFromQuery);
        }
    }, [tripIdFromQuery, selectedId]);

    useEffect(() => {
        if (authLoading) return;
        if (!user) return;

        (async () => {
            if (!selectedId) {
                setTrip(null);
                return;
            }
            try {
                const t = await getTrip(selectedId);
                if (!t) {
                    setTrip(null);
                    return;
                }

                const nights = Number(t?.stayNights) || 0;
                const daysCount = Math.max(1, nights + 1) || 1;

                const days = Array.isArray(t?.itinerary?.days) ? t.itinerary.days : [];
                const fixedDays = [];
                for (let d = 1; d <= daysCount; d++) {
                    const src = days.find((x) => Number(x?.day) === d) || {};
                    fixedDays.push(ensureDayShape(src, d));
                }

                const nextTrip = {
                    ...t,
                    itinerary: { days: fixedDays },
                    missions: Array.isArray(t?.missions) ? t.missions : [],
                };

                setTrip(nextTrip);
            } catch (e) {
                setTrip(null);
                setError(String(e?.message || e));
            }
        })();
    }, [authLoading, user, selectedId]);

    useEffect(() => {
        if (!sortMode) return;
        const onEsc = (e) => {
            if (e.key === "Escape") setSortMode(false);
        };
        window.addEventListener("keydown", onEsc);
        return () => window.removeEventListener("keydown", onEsc);
    }, [sortMode]);

    const sortedTrips = useMemo(() => [...trips], [trips]);

    const applyTrip = async (updatedTrip) => {
        if (!user) return;
        setSaving(true);
        try {
            setTrip(updatedTrip);
            await createTrip(updatedTrip);
            const ts = await listTripsForUser(user.uid);
            setTrips(ts);
        } finally {
            setSaving(false);
        }
    };

    const membersCount = useMemo(() => {
        const arr = Array.isArray(trip?.memberUids) ? trip.memberUids : [];
        return arr.length;
    }, [trip?.memberUids]);

    const leaveOrDeleteLabel = membersCount >= 2 ? "脱退" : "削除";

    const onLeaveOrDelete = async () => {
        if (!user || !selectedId) return;

        const title = trip?.title || trip?.destination || "旅行";
        const confirmText = membersCount >= 2 ? `「${title}」から脱退しますか？` : `「${title}」を削除しますか？（元に戻せません）`;

        if (!window.confirm(confirmText)) return;

        setError("");
        try {
            if (membersCount >= 2) {
                await removeTripMember(selectedId, user.uid);
                setSelectedId("");
                setTrip(null);
                const ts = await listTripsForUser(user.uid);
                setTrips(ts);
            } else {
                await deleteTripWithMessages(selectedId);
                setSelectedId("");
                setTrip(null);
                const ts = await listTripsForUser(user.uid);
                setTrips(ts);
            }
        } catch (e) {
            setError(String(e?.message || e));
        }
    };

    const updateItem = (dayNum, itemId, key, value) => {
        setTrip((prev) => {
            if (!prev?.itinerary?.days) return prev;
            const days = prev.itinerary.days.map((d) => {
                if (Number(d?.day) !== Number(dayNum)) return d;
                const items = clampItems(d.items);
                const nextItems = items.map((it) => {
                    if (String(it.id) !== String(itemId)) return it;

                    const prevAuto = String(it.place || "").trim();
                    const next = { ...it, [key]: value };

                    if (key === "place") {
                        const mq = String(next.mapsQuery || "").trim();
                        if (!mq || mq === prevAuto) {
                            next.mapsQuery = String(next.place || "").trim() || "予定";
                        }
                    }

                    return next;
                });
                return { ...d, items: nextItems };
            });
            return { ...prev, itinerary: { ...prev.itinerary, days } };
        });
    };

    const addItem = (dayNum) => {
        setTrip((prev) => {
            if (!prev?.itinerary?.days) return prev;
            const days = prev.itinerary.days.map((d) => {
                if (Number(d?.day) !== Number(dayNum)) return d;
                const items = clampItems(d.items);
                if (items.length >= 8) return d;
                const nextItems = [
                    ...items,
                    {
                        id: makeId(),
                        start: "09:00",
                        end: "10:00",
                        place: "予定",
                        address: "",
                        description: "",
                        feeYen: null,
                        mapsQuery: "予定",
                    },
                ];
                return { ...d, items: nextItems };
            });
            return { ...prev, itinerary: { ...prev.itinerary, days } };
        });
    };

    const removeItem = (dayNum, itemId) => {
        setTrip((prev) => {
            if (!prev?.itinerary?.days) return prev;
            const days = prev.itinerary.days.map((d) => {
                if (Number(d?.day) !== Number(dayNum)) return d;
                const items = clampItems(d.items);
                const next = items.filter((it) => String(it.id) !== String(itemId));
                return { ...d, items: next.length ? next : ensureDayShape(d, dayNum).items };
            });
            return { ...prev, itinerary: { ...prev.itinerary, days } };
        });
    };

    const onDragEndDay = (dayNum, event) => {
        const { active, over } = event;
        if (!over) return;
        const a = String(active?.id || "");
        const b = String(over?.id || "");
        if (!a || !b || a === b) return;

        setTrip((prev) => {
            if (!prev?.itinerary?.days) return prev;
            const days = prev.itinerary.days.map((d) => {
                if (Number(d?.day) !== Number(dayNum)) return d;
                const items = clampItems(d.items);
                const oldIndex = items.findIndex((x) => String(x.id) === a);
                const newIndex = items.findIndex((x) => String(x.id) === b);
                if (oldIndex < 0 || newIndex < 0) return d;
                const next = arrayMove(items, oldIndex, newIndex);
                return { ...d, items: next };
            });
            return { ...prev, itinerary: { ...prev.itinerary, days } };
        });
    };

    const saveEdits = async () => {
        if (!trip) return;
        setError("");
        try {
            await applyTrip({ ...trip, id: selectedId });
        } catch (e) {
            setError(String(e?.message || e));
        }
    };

    const hasMissions = useMemo(() => Array.isArray(trip?.missions) && trip.missions.length > 0, [trip?.missions]);

    const statusLabel = (v) => {
        const s = String(v || "").trim();
        if (s === "判定中" || s === "達成" || s === "未達成") return s;
        if (s === "judging") return "判定中";
        if (s === "done") return "達成";
        return "未達成";
    };

    const missionsByDay = useMemo(() => {
        const arr = Array.isArray(trip?.missions) ? trip.missions : [];
        const m = new Map();
        for (const x of arr) {
            const d = Number(x?.day);
            if (!Number.isFinite(d)) continue;
            if (!m.has(d)) m.set(d, []);
            m.get(d).push(x);
        }
        for (const [d, list] of m.entries()) {
            list.sort((a, b) => (Number(a?.segIndex) || 0) - (Number(b?.segIndex) || 0));
            m.set(d, list);
        }
        return m;
    }, [trip?.missions]);

    const onGenerateMissions = async () => {
        if (!trip || generating) return;
        setGenerating(true);
        setError("");
        try {
            const resp = await authedFetch(`/api/generateMissions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    trip: {
                        title: trip?.title,
                        destination: trip?.destination,
                        startDate: trip?.startDate,
                        stayNights: trip?.stayNights,
                        travelers: trip?.travelers,
                        budget: trip?.budget,
                        missionCount: trip?.missionCount,
                        itinerary: trip?.itinerary,
                    },
                }),
            });

            const raw = await resp.text();
            let r = {};
            try {
                r = raw ? JSON.parse(raw) : {};
            } catch {
                r = { ok: false, error: "invalid_json", raw };
            }

            if (!resp.ok || !r?.ok || !Array.isArray(r?.missions)) {
                setError(`ミッション生成に失敗しました。(status=${resp.status} / error=${r?.error || "unknown"})`);
                return;
            }

            const updatedTrip = { ...trip, id: selectedId, missions: r.missions };
            await applyTrip(updatedTrip);
        } catch (e) {
            setError(String(e?.message || e));
        } finally {
            setGenerating(false);
        }
    };

    if (authLoading || loading) {
        return (
            <div className="content-top">
                <p>読み込み中…</p>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="content-top">
                <p>ログインしてください。</p>
            </div>
        );
    }

    if (!selectedId) {
        return (
            <div className="content-top">
                <h1>日程再調整</h1>

                {error && (
                    <div style={{ marginTop: 12, background: "#fff6e6", border: "1px solid #f1d2a3", borderRadius: 12, padding: 12 }}>
                        <div style={{ fontWeight: 900 }}>エラー</div>
                        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{error}</div>
                    </div>
                )}

                {!sortedTrips.length && (
                    <p className="muted" style={{ marginTop: 12 }}>
                        まだ表示できる旅行はありません。
                    </p>
                )}

                <ul className="pick-list">
                    {sortedTrips.map((t) => (
                        <li key={t.id}>
                            <button className="trip-pick" onClick={() => setSelectedId(t.id)}>
                                <div className="trip-pick_title">{t.title || t.destination || "旅行"}</div>
                                <div className="trip-pick_meta">{[t.destination, t.startDate, t.travelers ? `${t.travelers}名` : ""].filter(Boolean).join(" / ")}</div>
                                <div className="trip-pick_date">{t.startDate || ""}</div>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    const disableEdit = saving || generating || sortMode;

    return (
        <div className="content-top">
            <div className="toolbar">
                <div className="toolbar-row">
                    <button className="back-btn" onClick={() => setSelectedId("")} disabled={sortMode}>
                        ← 旅行を選び直す
                    </button>

                    <div className="toolbar-actions" style={{ display: "flex", gap: 8 }}>
                        <button
                            type="button"
                            className="back-btn"
                            onClick={saveEdits}
                            disabled={disableEdit || !trip}
                            style={{
                                background: "#ffd08a",
                                fontWeight: 900,
                                opacity: disableEdit ? 0.8 : 1,
                            }}
                        >
                            {saving ? "保存中…" : sortMode ? "並べ替え中…" : "変更を保存"}
                        </button>

                        <button
                            type="button"
                            className="back-btn"
                            onClick={onLeaveOrDelete}
                            disabled={disableEdit}
                            style={{
                                background: membersCount >= 2 ? "#efe5c6" : "#ffd08a",
                                fontWeight: 900,
                                opacity: disableEdit ? 0.8 : 1,
                            }}
                        >
                            {leaveOrDeleteLabel}
                        </button>
                    </div>
                </div>

                <h1 className="toolbar-title">{trip?.title || trip?.destination || "旅行"}</h1>
            </div>

            <TripMembers trip={trip} tripId={selectedId} meUid={user.uid} canInvite={true} />

            {error && (
                <div style={{ marginTop: 12, background: "#fff6e6", border: "1px solid #f1d2a3", borderRadius: 12, padding: 12 }}>
                    <div style={{ fontWeight: 900 }}>エラー</div>
                    <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{error}</div>
                </div>
            )}

            {trip?.itinerary?.days && (
                <div className="it-view" style={{ marginTop: 12 }}>
                    {(trip?.itinerary?.days || []).map((d) => {
                        const items = clampItems(d.items);
                        const ids = items.map((x) => String(x.id));

                        return (
                            <div
                                key={d.day}
                                style={{
                                    marginTop: 16,
                                    background: "#fff",
                                    borderRadius: 14,
                                    padding: 12,
                                    boxShadow: "0 2px 6px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.16)",
                                }}
                            >
                                <div
                                    className="itin-day-title"
                                    style={{
                                        fontSize: 22,
                                        fontWeight: 900,
                                        margin: "0 0 10px",
                                        borderBottom: "1px solid var(--line)",
                                        paddingBottom: 8,
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 10,
                                        alignItems: "center",
                                    }}
                                >
                                    <div>
                                        Day {d.day}
                                        {d.date ? `（${d.date}）` : ""}
                                    </div>

                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button
                                            type="button"
                                            onClick={() => setSortMode((v) => !v)}
                                            disabled={saving || generating}
                                            style={{
                                                background: "#efe5c6",
                                                fontWeight: 900,
                                                whiteSpace: "nowrap",
                                                opacity: saving || generating ? 0.8 : 1,
                                            }}
                                        >
                                            {sortMode ? "詳細を編集" : "順番を入替"}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => addItem(d.day)}
                                            disabled={disableEdit}
                                            style={{
                                                background: "#efe5c6",
                                                fontWeight: 900,
                                                whiteSpace: "nowrap",
                                                opacity: disableEdit ? 0.8 : 1,
                                            }}
                                        >
                                            予定を追加
                                        </button>
                                    </div>
                                </div>

                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={(e) => onDragEndDay(d.day, e)}
                                    modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                                >
                                    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                                        <div style={{ display: "grid", gap: sortMode ? 8 : 12 }}>
                                            {items.map((x) => (
                                                <SortableItemCard
                                                    key={String(x.id)}
                                                    dayNum={d.day}
                                                    item={x}
                                                    onChange={updateItem}
                                                    onRemove={removeItem}
                                                    disabled={saving || generating}
                                                    sortMode={sortMode}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            </div>
                        );
                    })}
                </div>
            )}

            <section style={{ marginTop: 14 }}>
                <div
                    style={{
                        background: "#fff",
                        borderRadius: 14,
                        padding: 12,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.16)",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "center",
                            borderBottom: "1px solid var(--line)",
                            paddingBottom: 8,
                        }}
                    >
                        <div style={{ fontSize: 20, fontWeight: 900 }}>ミッション</div>

                        <button
                            type="button"
                            onClick={onGenerateMissions}
                            disabled={!trip || generating || saving || sortMode}
                            style={{
                                background: "#2f76ff",
                                color: "#fff",
                                fontWeight: 900,
                                border: "none",
                                borderRadius: 12,
                                padding: "10px 12px",
                                cursor: generating || saving || sortMode ? "not-allowed" : "pointer",
                                opacity: generating || saving || sortMode ? 0.8 : 1,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {generating ? "生成中…" : "ミッション生成"}
                        </button>
                    </div>

                    {!hasMissions && (
                        <div className="muted" style={{ marginTop: 10 }}>
                            まだミッションがありません。
                        </div>
                    )}

                    {hasMissions && (
                        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                            {(trip?.itinerary?.days || []).map((d) => {
                                const list = missionsByDay.get(Number(d.day)) || [];
                                if (!list.length) return null;

                                return (
                                    <div key={`mday_${d.day}`} style={{ background: "#fff", borderRadius: 12, border: "1px solid var(--line)", padding: 10 }}>
                                        <div style={{ fontWeight: 900, fontSize: 16 }}>
                                            Day {d.day}
                                            {d.date ? `（${d.date}）` : ""}
                                        </div>

                                        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                                            {list.map((m) => {
                                                const title = String(m?.title || "").trim() || "ミッション";
                                                const desc = String(m?.desc || "").trim();
                                                const st = statusLabel(m?.status);

                                                return (
                                                    <div key={m.id} className="saved-card" style={{ cursor: "default", marginBottom: 0 }}>
                                                        <div style={{ width: "100%" }}>
                                                            <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
                                                            {desc && <div style={{ marginTop: 8, color: "#444", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{desc}</div>}
                                                            <div className="muted" style={{ marginTop: 8 }}>
                                                                ステータス：{st}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>

            <ConciergeChat trip={trip} tripId={selectedId} onApplyTrip={applyTrip} />
        </div>
    );
}
