import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTrip } from "../lib/trips";
import { useAuth } from "../components/AuthProvider.jsx";
import { authedFetch } from "../lib/authedFetch";
import "../style.css";

const budgets = [
    { key: "low", label: "節約" },
    { key: "standard", label: "標準" },
    { key: "high", label: "贅沢" },
];

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const makeStayOptions = () => {
    const opts = [{ nights: 0, label: "日帰り" }];
    for (let n = 1; n <= 9; n++) opts.push({ nights: n, label: `${n}泊${n + 1}日` });
    return opts;
};

function makeId() {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
    } catch {}
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function Planner() {
    const nav = useNavigate();
    const { user } = useAuth();

    const stayOptions = useMemo(makeStayOptions, []);
    const travelerOptions = useMemo(() => range(1, 10), []);

    const [form, setForm] = useState({
        title: "",
        destination: "",
        startDate: "",
        stayNights: 0,
        travelers: 1,
        budget: "standard",
        transport: "public",
    });

    const [loading, setLoading] = useState(false);

    const resolvedTitle = form.title.trim() || (form.destination ? `${form.destination}旅行` : "");
    const canCreate = form.destination.trim().length > 0;

    const handleCreate = async () => {
        if (!user) return;
        if (!canCreate || loading) return;
        setLoading(true);

        try {
            const resp = await authedFetch(`/api/createTrip`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: resolvedTitle,
                    destination: form.destination,
                    startDate: form.startDate,
                    stayNights: form.stayNights,
                    travelers: form.travelers,
                    budget: form.budget,
                    transport: form.transport,
                }),
            });

            const r = await resp.json().catch(() => ({}));

            if (!resp.ok || !r?.ok || !r?.trip) {
                console.error("API failed:", {
                    status: resp.status,
                    statusText: resp.statusText,
                    body: r,
                });
                alert(`API失敗: status=${resp.status} error=${r?.error || resp.statusText || "unknown"}`);
                return;
            }

            const id = makeId();

            const trip = {
                id,
                ...r.trip,
                ownerUid: user.uid,
                memberUids: [user.uid],
                missions: Array.isArray(r.trip?.missions) ? r.trip.missions : [],
            };

            await createTrip(trip);

            nav(`/reschedule?trip=${encodeURIComponent(id)}`);
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) {
            console.error("Create failed:", e);
            alert(`作成に失敗: ${e?.message || e}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="content-top">
            <h1>旅行日程作成</h1>

            <section className="form-grid">
                <label>
                    保存名
                    <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>

                <label>
                    行き先（必須）
                    <input
                        value={form.destination}
                        onChange={(e) => setForm({ ...form, destination: e.target.value })}
                        required
                    />
                </label>

                <label>
                    開始日
                    <input
                        type="date"
                        value={form.startDate}
                        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    />
                </label>

                <label>
                    日数
                    <select
                        value={form.stayNights}
                        onChange={(e) => setForm({ ...form, stayNights: Number(e.target.value) })}
                    >
                        {stayOptions.map((s) => (
                            <option key={s.nights} value={s.nights}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>

                <label>
                    人数
                    <select
                        value={form.travelers}
                        onChange={(e) => setForm({ ...form, travelers: Number(e.target.value) })}
                    >
                        {travelerOptions.map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </label>

                <label>
                    移動手段
                    <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                        <option value="public">公共交通機関</option>
                        <option value="car">車</option>
                    </select>
                </label>

                <label>
                    予算
                    <select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })}>
                        {budgets.map((b) => (
                            <option key={b.key} value={b.key}>
                                {b.label}
                            </option>
                        ))}
                    </select>
                </label>
            </section>

            <div className="Planner-button">
                <button type="button" onClick={handleCreate} disabled={!canCreate || loading || !user}>
                    {loading ? "作成中..." : "旅行日程を作る"}
                </button>
            </div>
        </div>
    );
}
