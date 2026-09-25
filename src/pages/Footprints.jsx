import React, { useEffect, useMemo, useRef, useState } from "react";
import { listTripsForUser, getTrip, createTrip } from "../lib/trips";
import { useAuth } from "../components/AuthProvider.jsx";
import TripMembers from "../components/TripMembers.jsx";
import TripChat from "../components/TripChat.jsx";
import { authedFetch } from "../lib/authedFetch.js";
import clearMark from "../img/clearMark.png";
import "../style.css";

function mapsUrlFrom(item) {
    const q = (item?.mapsQuery || item?.address || item?.place || "").trim();
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

function nowISO() {
    return new Date().toISOString();
}

function makeId() {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
    } catch {}
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function fileToDataUrlResized(file, maxLongEdge = 1280, quality = 0.82) {
    const srcDataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("file_read_failed"));
        r.onload = () => resolve(String(r.result || ""));
        r.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("image_load_failed"));
        i.src = srcDataUrl;
    });

    const w0 = img.width || 1;
    const h0 = img.height || 1;

    const longEdge = Math.max(w0, h0);
    const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;

    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    return canvas.toDataURL("image/jpeg", quality);
}

export default function Footprints() {
    const { user, loading: authLoading } = useAuth();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [trips, setTrips] = useState([]);
    const [selectedId, setSelectedId] = useState("");
    const [trip, setTrip] = useState(null);

    const [viewMode, setViewMode] = useState("itinerary");

    const [uploadingByMission, setUploadingByMission] = useState({});
    const [uploadingAlbum, setUploadingAlbum] = useState(false);

    const fileInputRef = useRef(null);
    const pickTargetRef = useRef({ kind: "", missionId: "" });

    const [viewer, setViewer] = useState({ open: false, src: "", title: "" });

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
        if (authLoading) return;
        if (!user) return;

        (async () => {
            if (!selectedId) {
                setTrip(null);
                setViewMode("itinerary");
                return;
            }
            try {
                const t = await getTrip(selectedId);
                setTrip(t);
            } catch (e) {
                setTrip(null);
                setError(String(e?.message || e));
            }
        })();
    }, [authLoading, user, selectedId]);

    const sortedTrips = useMemo(() => [...trips], [trips]);

    const missions = useMemo(() => {
        const arr = Array.isArray(trip?.missions) ? trip.missions : [];
        return [...arr].sort((a, b) => {
            const da = Number(a?.day) || 0;
            const db = Number(b?.day) || 0;
            if (da !== db) return da - db;
            return (Number(a?.segIndex) || 0) - (Number(b?.segIndex) || 0);
        });
    }, [trip?.missions]);

    const albumUploads = useMemo(() => {
        const arr = Array.isArray(trip?.albumUploads) ? trip.albumUploads : [];
        return [...arr].sort((a, b) => {
            const ta = String(a?.createdAt || "");
            const tb = String(b?.createdAt || "");
            return tb.localeCompare(ta);
        });
    }, [trip?.albumUploads]);

    const isMissionCleared = (m) => {
        const st = String(m?.status || "").trim();
        if (st === "達成") return true;
        const j = m?.judge || null;
        if (j && j.status === "done" && j.pass === true) return true;
        return false;
    };

    const missionPhotos = useMemo(() => {
        return missions
            .map((m) => {
                const url = String(m?.photoDataUrl || "").trim();
                if (!url) return null;
                return {
                    id: String(m?.id || ""),
                    title: String(m?.title || "ミッション"),
                    dataUrl: url,
                    cleared: isMissionCleared(m),
                };
            })
            .filter(Boolean);
    }, [missions]);

    const openViewer = (src, title = "") => {
        const s = String(src || "").trim();
        if (!s) return;
        setViewer({ open: true, src: s, title: String(title || "").trim() });
    };

    const closeViewer = () => setViewer({ open: false, src: "", title: "" });

    const pickMissionPhotoFor = (missionId) => {
        const mid = String(missionId || "").trim();
        if (!mid) return;
        pickTargetRef.current = { kind: "mission", missionId: mid };
        const el = fileInputRef.current;
        if (!el) return;
        el.value = "";
        el.click();
    };

    const pickAlbumUpload = () => {
        pickTargetRef.current = { kind: "album", missionId: "" };
        const el = fileInputRef.current;
        if (!el) return;
        el.value = "";
        el.click();
    };

    const callJudge = async (m, photoDataUrl) => {
        const resp = await authedFetch(`/api/judgeMission`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                missionTitle: m?.title || "",
                missionDesc: m?.desc || "",
                missionKeywords: m?.keywords || "",
                missionName: m?.missionName || "",
                fromPlace: m?.fromPlace || "",
                toPlace: m?.toPlace || "",
                imageDataUrl: photoDataUrl,
            }),
        });

        const raw = await resp.text();
        let r = {};
        try {
            r = raw ? JSON.parse(raw) : {};
        } catch {
            r = { ok: false, error: "invalid_json", raw };
        }

        if (!resp.ok || !r?.ok) {
            const msg = `判定に失敗しました。(status=${resp.status} / error=${r?.error || "unknown"})`;
            return { ok: false, error: msg };
        }
        return { ok: true, judge: r.judge };
    };

    const normalizeStatusLabel = (v) => {
        const s = String(v || "").trim();
        if (s === "判定中" || s === "達成" || s === "未達成") return s;
        if (s === "judging") return "判定中";
        if (s === "done") return "達成";
        return "未達成";
    };

    const judgeReasonOf = (m) => {
        const j = m?.judge || null;
        if (!j || String(j.status || "") === "") return "";
        if (j.status === "judging") return "判定中…";
        if (j.status === "error") return String(j.reason || "判定に失敗しました");
        if (j.status === "done") {
            const r = String(j.reason || "").trim();
            return r || "判定が完了しました。";
        }
        return "";
    };

    const missionTitleOf = (m) => {
        const t = String(m?.title || "").trim();
        return t || "ミッション";
    };

    const deleteMissionPhoto = async (missionId) => {
        if (!user) return;
        if (!trip || !selectedId) return;
        const mid = String(missionId || "").trim();
        if (!mid) return;

        if (!window.confirm("このミッション画像を削除しますか？（達成状況も未達成に戻ります）")) return;

        try {
            const nextMissions = missions.map((m) => {
                if (String(m?.id) !== mid) return m;
                return {
                    ...m,
                    status: "未達成",
                    photoDataUrl: "",
                    photoUpdatedAt: "",
                    judge: {
                        status: "",
                        pass: null,
                        reason: "",
                        judgedAt: "",
                    },
                };
            });

            const updatedTrip = { ...trip, id: selectedId, missions: nextMissions };
            await createTrip(updatedTrip);
            setTrip(updatedTrip);
        } catch (e) {
            alert(`削除に失敗しました: ${String(e?.message || e)}`);
        }
    };

    const deleteAlbumUpload = async (uploadId) => {
        if (!user) return;
        if (!trip || !selectedId) return;
        const id = String(uploadId || "").trim();
        if (!id) return;

        if (!window.confirm("この画像を削除しますか？")) return;

        try {
            const next = (Array.isArray(trip?.albumUploads) ? trip.albumUploads : []).filter(
                (x) => String(x?.id || "") !== id,
            );
            const updatedTrip = { ...trip, id: selectedId, albumUploads: next };
            await createTrip(updatedTrip);
            setTrip(updatedTrip);
        } catch (e) {
            alert(`削除に失敗しました: ${String(e?.message || e)}`);
        }
    };

    const saveMissionPhoto = async (missionId, file) => {
        if (!user) return;
        if (!trip || !selectedId) return;
        const mid = String(missionId || "").trim();
        if (!mid || !file) return;

        setUploadingByMission((p) => ({ ...p, [mid]: true }));
        try {
            const photoDataUrl = await fileToDataUrlResized(file, 600, 0.45);

            const nextMissionsJudging = missions.map((m) => {
                if (String(m?.id) !== mid) return m;
                return {
                    ...m,
                    status: "判定中",
                    photoDataUrl,
                    photoUpdatedAt: nowISO(),
                    judge: {
                        status: "judging",
                        pass: null,
                        reason: "",
                        judgedAt: "",
                    },
                };
            });

            const judgingTrip = { ...trip, id: selectedId, missions: nextMissionsJudging };
            await createTrip(judgingTrip);
            setTrip(judgingTrip);

            const target = nextMissionsJudging.find((m) => String(m?.id) === mid) || null;

            const judged = await callJudge(target, photoDataUrl);

            const nextMissionsFinal = nextMissionsJudging.map((m) => {
                if (String(m?.id) !== mid) return m;

                if (!judged.ok) {
                    return {
                        ...m,
                        status: "未達成",
                        judge: {
                            status: "error",
                            pass: null,
                            reason: String(judged.error || "判定に失敗しました"),
                            judgedAt: nowISO(),
                        },
                    };
                }

                const pass = judged.judge?.pass === true;
                const reason = String(judged.judge?.reason || "").trim();

                return {
                    ...m,
                    status: pass ? "達成" : "未達成",
                    judge: {
                        status: "done",
                        pass,
                        reason,
                        judgedAt: nowISO(),
                    },
                };
            });

            const updatedTrip = { ...judgingTrip, missions: nextMissionsFinal };
            await createTrip(updatedTrip);
            setTrip(updatedTrip);
        } catch (e) {
            alert(`アップロードに失敗しました: ${String(e?.message || e)}`);
        } finally {
            setUploadingByMission((p) => ({ ...p, [mid]: false }));
        }
    };

    const addAlbumUpload = async (file) => {
        if (!user) return;
        if (!trip || !selectedId) return;
        if (!file) return;

        setUploadingAlbum(true);
        try {
            const dataUrl = await fileToDataUrlResized(file, 600, 0.45);

            const next = Array.isArray(trip?.albumUploads) ? [...trip.albumUploads] : [];
            next.unshift({
                id: makeId(),
                dataUrl,
                createdAt: nowISO(),
                byUid: String(user.uid || ""),
            });

            const updatedTrip = {
                ...trip,
                id: selectedId,
                albumUploads: next,
            };

            await createTrip(updatedTrip);
            setTrip(updatedTrip);
        } catch (e) {
            alert(`アップロードに失敗しました: ${String(e?.message || e)}`);
        } finally {
            setUploadingAlbum(false);
        }
    };

    const onFileSelected = async (e) => {
        const file = e.target.files?.[0] || null;
        const tgt = pickTargetRef.current || { kind: "", missionId: "" };
        pickTargetRef.current = { kind: "", missionId: "" };
        if (!file) return;

        if (tgt.kind === "mission") {
            await saveMissionPhoto(tgt.missionId, file);
            return;
        }
        if (tgt.kind === "album") {
            await addAlbumUpload(file);
            return;
        }
    };

    const missionBtnLabel = viewMode === "missions" ? "旅行日程へ戻る" : "ミッションを見る";
    const albumBtnLabel = viewMode === "album" ? "旅行日程へ戻る" : "アルバム";

    const onToggleMissions = () => {
        setViewMode((v) => (v === "missions" ? "itinerary" : "missions"));
    };

    const onToggleAlbum = () => {
        setViewMode((v) => (v === "album" ? "itinerary" : "album"));
    };

    const XBtnPlain = ({ onClick, color = "#fff" }) => (
        <button
            type="button"
            onClick={onClick}
            aria-label="削除"
            style={{
                position: "absolute",
                top: 8,
                right: 8,
                width: 34,
                height: 34,
                border: "none",
                background: "transparent",
                color,
                fontSize: 30,
                fontWeight: 900,
                lineHeight: "34px",
                cursor: "pointer",
                textShadow: "0 2px 10px rgba(0,0,0,0.65)",
                padding: 0,
            }}
        >
            ×
        </button>
    );

    const SquareThumb = ({ src, title, onClick, showClear, showDelete, onDelete }) => {
        const s = String(src || "").trim();
        if (!s) return null;

        return (
            <div
                style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    position: "relative",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#eee",
                    border: "1px solid var(--line)",
                    cursor: onClick ? "pointer" : "default",
                }}
                onClick={(e) => {
                    if (!onClick) return;
                    onClick();
                }}
                role={onClick ? "button" : undefined}
                tabIndex={onClick ? 0 : undefined}
                onKeyDown={(e) => {
                    if (!onClick) return;
                    if (e.key === "Enter") onClick();
                }}
            >
                <img
                    src={s}
                    alt=""
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                    }}
                />

                {showDelete && (
                    <div
                        style={{ position: "absolute", inset: 0 }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete?.();
                        }}
                    >
                        <XBtnPlain onClick={() => onDelete?.()} />
                    </div>
                )}

                {showClear && (
                    <img
                        src={clearMark}
                        alt=""
                        style={{
                            position: "absolute",
                            right: 8,
                            bottom: 8,
                            width: "42%",
                            maxWidth: 120,
                            height: "auto",
                            pointerEvents: "none",
                            userSelect: "none",
                        }}
                    />
                )}
            </div>
        );
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
                <h1>あしあと</h1>

                {error && (
                    <div
                        style={{
                            marginTop: 12,
                            background: "#fff6e6",
                            border: "1px solid #f1d2a3",
                            borderRadius: 12,
                            padding: 12,
                        }}
                    >
                        <div style={{ fontWeight: 900 }}>エラー</div>
                        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{error}</div>
                    </div>
                )}

                {!sortedTrips.length && (
                    <p className="muted" style={{ marginTop: 12 }}>
                        まだ保存された旅行はありません。
                    </p>
                )}

                <ul className="pick-list">
                    {sortedTrips.map((t) => (
                        <li key={t.id}>
                            <button className="trip-pick" onClick={() => setSelectedId(t.id)}>
                                <div className="trip-pick_title">{t.title || t.destination || "旅行"}</div>
                                <div className="trip-pick_meta">
                                    {[t.destination, t.startDate, t.travelers ? `${t.travelers}名` : ""]
                                        .filter(Boolean)
                                        .join(" / ")}
                                </div>
                                <div className="trip-pick_date">{t.startDate || ""}</div>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <div className="content-top">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileSelected}
                style={{ display: "none" }}
            />

            {viewer.open && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.72)",
                        zIndex: 9999,
                        display: "grid",
                        placeItems: "center",
                        padding: 16,
                    }}
                    onClick={closeViewer}
                >
                    <div
                        style={{
                            position: "relative",
                            maxWidth: "92vw",
                            maxHeight: "84vh",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={closeViewer}
                            aria-label="閉じる"
                            style={{
                                position: "absolute",
                                top: -10,
                                right: -10,
                                width: 42,
                                height: 42,
                                borderRadius: 999,
                                border: "none",
                                background: "rgba(0,0,0,0.6)",
                                color: "#fff",
                                fontSize: 24,
                                fontWeight: 900,
                                cursor: "pointer",
                            }}
                        >
                            ×
                        </button>

                        <img
                            src={viewer.src}
                            alt=""
                            style={{
                                maxWidth: "92vw",
                                maxHeight: "84vh",
                                width: "auto",
                                height: "auto",
                                display: "block",
                                borderRadius: 14,
                                boxShadow: "0 10px 40px rgba(0,0,0,0.45)",
                            }}
                        />
                        {viewer.title && (
                            <div
                                style={{
                                    marginTop: 10,
                                    color: "#fff",
                                    fontWeight: 900,
                                    textShadow: "0 2px 10px rgba(0,0,0,0.6)",
                                }}
                            >
                                {viewer.title}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="toolbar">
                <div className="toolbar-row">
                    <button className="back-btn" onClick={() => setSelectedId("")}>
                        ← 旅行を選び直す
                    </button>

                    <div className="toolbar-actions">
                        <button
                            type="button"
                            className="back-btn"
                            onClick={onToggleMissions}
                            style={{ fontWeight: 900 }}
                        >
                            {missionBtnLabel}
                        </button>
                        <button type="button" className="back-btn" onClick={onToggleAlbum} style={{ fontWeight: 900 }}>
                            {albumBtnLabel}
                        </button>
                    </div>
                </div>

                <h1 className="toolbar-title">{trip?.title || trip?.destination || "旅行"}</h1>
            </div>

            {error && (
                <div
                    style={{
                        marginTop: 12,
                        background: "#fff6e6",
                        border: "1px solid #f1d2a3",
                        borderRadius: 12,
                        padding: 12,
                    }}
                >
                    <div style={{ fontWeight: 900 }}>エラー</div>
                    <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{error}</div>
                </div>
            )}

            {viewMode === "itinerary" && (
                <>
                    <TripMembers trip={trip} tripId={selectedId} meUid={user.uid} canInvite={false} />

                    <section style={{ marginTop: 8 }}>
                        <div className="it-view">
                            {(trip?.itinerary?.days || []).map((d) => (
                                <div
                                    key={d.day}
                                    style={{
                                        marginTop: 14,
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
                                        }}
                                    >
                                        Day {d.day}
                                        {d.date ? `（${d.date}）` : ""}
                                    </div>

                                    {(d.items || []).map((x, i) => {
                                        const url = mapsUrlFrom(x);
                                        return (
                                            <div key={i} className="itin-seg" style={{ alignItems: "flex-start" }}>
                                                <div style={{ width: "100%" }}>
                                                    <div style={{ display: "grid", gap: 6 }}>
                                                        <div>
                                                            <span className="itin-timechip">
                                                                {x.start}〜{x.end}
                                                            </span>
                                                        </div>

                                                        <div style={{ fontWeight: 800, fontSize: 18 }}>{x.place}</div>

                                                        {url && (
                                                            <div style={{ marginTop: 6 }}>
                                                                <a
                                                                    className="icon-btn map-btn"
                                                                    href={url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    style={{
                                                                        textDecoration: "none",
                                                                        width: "fit-content",
                                                                    }}
                                                                >
                                                                    🗺️地図
                                                                </a>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {x.address && (
                                                        <div className="muted" style={{ marginTop: 8 }}>
                                                            📍 {x.address}
                                                        </div>
                                                    )}
                                                    {x.description && (
                                                        <div style={{ marginTop: 6, color: "#444" }}>
                                                            💡 {x.description}
                                                        </div>
                                                    )}
                                                    <Yen value={x.feeYen} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </section>

                    <TripChat tripId={selectedId} meUid={user.uid} memberProfiles={trip?.memberProfiles || {}} />
                </>
            )}

            {viewMode === "missions" && (
                <section style={{ marginTop: 12 }}>
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
                                fontSize: 22,
                                fontWeight: 900,
                                margin: 0,
                                borderBottom: "1px solid var(--line)",
                                paddingBottom: 8,
                            }}
                        >
                            ミッション
                        </div>

                        {!missions.length && (
                            <div className="muted" style={{ marginTop: 10 }}>
                                ミッションがありません。
                            </div>
                        )}

                        {!!missions.length && (
                            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                                {missions.map((m) => {
                                    const mid = String(m?.id || "");
                                    const busy = Boolean(uploadingByMission[mid]);
                                    const photoDataUrl = String(m?.photoDataUrl || "").trim();

                                    const statusText = normalizeStatusLabel(m?.status);
                                    const judgeReason = judgeReasonOf(m);
                                    const titleText = missionTitleOf(m);
                                    const descText = String(m?.desc || "").trim();
                                    const cleared = isMissionCleared(m);

                                    return (
                                        <div key={mid} className="saved-card" style={{ cursor: "default" }}>
                                            <div style={{ width: "100%" }}>
                                                <div style={{ fontWeight: 900, fontSize: 18 }}>{titleText}</div>

                                                {descText && (
                                                    <div
                                                        style={{
                                                            marginTop: 8,
                                                            color: "#444",
                                                            whiteSpace: "pre-wrap",
                                                            lineHeight: 1.45,
                                                        }}
                                                    >
                                                        {descText}
                                                    </div>
                                                )}

                                                <div className="muted" style={{ marginTop: 10 }}>
                                                    ステータス: {statusText}
                                                </div>

                                                {judgeReason && (
                                                    <div
                                                        className="muted"
                                                        style={{ marginTop: 6, whiteSpace: "pre-wrap" }}
                                                    >
                                                        判定: {judgeReason}
                                                    </div>
                                                )}

                                                {photoDataUrl && (
                                                    <div style={{ marginTop: 10, maxWidth: 360 }}>
                                                        <SquareThumb
                                                            src={photoDataUrl}
                                                            title={titleText}
                                                            onClick={() => openViewer(photoDataUrl, titleText)}
                                                            showClear={cleared}
                                                            showDelete={true}
                                                            onDelete={() => deleteMissionPhoto(mid)}
                                                        />
                                                    </div>
                                                )}

                                                <div style={{ marginTop: 10 }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => pickMissionPhotoFor(mid)}
                                                        disabled={busy}
                                                        style={{
                                                            width: "100%",
                                                            padding: "12px 14px",
                                                            borderRadius: 12,
                                                            background: "#2f76ff",
                                                            color: "#fff",
                                                            fontWeight: 900,
                                                            border: "none",
                                                            cursor: busy ? "not-allowed" : "pointer",
                                                            opacity: busy ? 0.7 : 1,
                                                        }}
                                                    >
                                                        {busy ? "アップロード中..." : "写真をアップロード"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </section>
            )}

            {viewMode === "album" && (
                <section style={{ marginTop: 12 }}>
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
                                fontSize: 22,
                                fontWeight: 900,
                                margin: 0,
                                borderBottom: "1px solid var(--line)",
                                paddingBottom: 8,
                            }}
                        >
                            アルバム
                        </div>

                        <div style={{ marginTop: 12 }}>
                            <div style={{ fontWeight: 900, fontSize: 16 }}>ミッション画像</div>

                            {missionPhotos.length === 0 ? (
                                <div className="muted" style={{ marginTop: 8 }}>
                                    まだミッション画像はありません。
                                </div>
                            ) : (
                                <div className="photo-grid" style={{ marginTop: 10 }}>
                                    {missionPhotos.map((p) => (
                                        <div key={p.id} style={{ display: "grid", gap: 6 }}>
                                            <SquareThumb
                                                src={p.dataUrl}
                                                title={p.title}
                                                onClick={() => openViewer(p.dataUrl, p.title)}
                                                showClear={p.cleared}
                                                showDelete={false}
                                            />
                                            <div className="muted" style={{ fontSize: 12 }}>
                                                {p.title}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: 18 }}>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: 10,
                                }}
                            >
                                <div style={{ fontWeight: 900, fontSize: 16 }}>アップロード画像</div>
                                <button
                                    type="button"
                                    onClick={pickAlbumUpload}
                                    disabled={uploadingAlbum}
                                    style={{ background: "#ffd08a", fontWeight: 900, whiteSpace: "nowrap" }}
                                >
                                    {uploadingAlbum ? "アップロード中..." : "アップロード"}
                                </button>
                            </div>

                            {albumUploads.length === 0 ? (
                                <div className="muted" style={{ marginTop: 8 }}>
                                    まだアップロード画像はありません。
                                </div>
                            ) : (
                                <div className="photo-grid" style={{ marginTop: 10 }}>
                                    {albumUploads.map((p) => {
                                        const url = String(p?.dataUrl || "").trim();
                                        if (!url) return null;
                                        const pid = String(p?.id || "");
                                        return (
                                            <div key={pid} style={{ position: "relative" }}>
                                                <SquareThumb
                                                    src={url}
                                                    title=""
                                                    onClick={() => openViewer(url, "")}
                                                    showClear={false}
                                                    showDelete={true}
                                                    onDelete={() => deleteAlbumUpload(pid)}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}
