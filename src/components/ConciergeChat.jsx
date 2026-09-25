import React, { useEffect, useMemo, useRef, useState } from "react";
import "../style.css";
import { authedFetch } from "../lib/authedFetch";

export default function ConciergeChat({ trip, tripId, onApplyTrip }) {
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);

    const [messages, setMessages] = useState(() => [{ role: "assistant", content: "日程の修正内容を送ってください。" }]);

    const listRef = useRef(null);

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    const canSend = useMemo(() => text.trim().length > 0 && !sending, [text, sending]);

    const replaceLastAssistant = (content) => {
        setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]?.role === "assistant") {
                    next[i] = { role: "assistant", content };
                    return next;
                }
            }
            next.push({ role: "assistant", content });
            return next;
        });
    };

    const handleSend = async () => {
        const t = text.trim();
        if (!t || sending) return;

        setText("");
        setSending(true);

        setMessages((prev) => [...prev, { role: "user", content: t }, { role: "assistant", content: "調整中…" }]);

        try {
            const resp = await authedFetch(`/api/concierge`, {
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
                    message: t,
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
                replaceLastAssistant(`すみません、失敗しました。\n(status=${resp.status} ${resp.statusText || ""} / error=${r?.error || "unknown"})`);
                return;
            }

            if (r?.trip?.itinerary) {
                const updatedTrip = { id: tripId, ...r.trip };
                await onApplyTrip(updatedTrip);
            }

            replaceLastAssistant(String(r?.reply || "調整しました。"));
        } catch (e) {
            replaceLastAssistant(`すみません、通信に失敗しました。\n(${String(e?.message || e)})`);
        } finally {
            setSending(false);
        }
    };

    return (
        <section
            style={{
                marginTop: 16,
                background: "#fff",
                borderRadius: 14,
                padding: 14,
                boxShadow: "0 2px 6px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.16)",
            }}
        >
            <div style={{ fontSize: 20, fontWeight: 900 }}>AIコンシェルジュ</div>

            <div
                ref={listRef}
                style={{
                    marginTop: 10,
                    maxHeight: 180,
                    overflowY: "auto",
                    display: "grid",
                    gap: 8,
                    padding: 10,
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    background: "#fff",
                }}
            >
                {messages.map((m, idx) => {
                    const isUser = m.role === "user";
                    return (
                        <div
                            key={idx}
                            style={{
                                display: "flex",
                                justifyContent: isUser ? "flex-end" : "flex-start",
                            }}
                        >
                            <div
                                style={{
                                    maxWidth: "85%",
                                    padding: "8px 12px",
                                    borderRadius: 14,
                                    background: isUser ? "#ffd08a" : "#efe5c6",
                                    color: "#222",
                                    whiteSpace: "pre-wrap",
                                    lineHeight: 1.45,
                                }}
                            >
                                {m.content}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div
                style={{
                    marginTop: 10,
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 10,
                    alignItems: "center",
                }}
            >
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="旅行の修正をお願いしよう"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    disabled={sending}
                    style={{
                        width: "100%",
                        borderRadius: 12,
                        border: "1px solid var(--line)",
                        padding: "10px 12px",
                        background: "#fff",
                    }}
                />

                <button
                    type="button"
                    onClick={handleSend}
                    disabled={!canSend}
                    style={{
                        borderRadius: 12,
                        padding: "10px 14px",
                        fontWeight: 900,
                        background: "#efe5c6",
                        border: "1px solid #eadfbe",
                        color: "#3a2f1a",
                        whiteSpace: "nowrap",
                    }}
                >
                    {sending ? "調整中…" : "送信"}
                </button>
            </div>
        </section>
    );
}
