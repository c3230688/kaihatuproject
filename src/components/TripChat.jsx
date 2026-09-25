import React, { useEffect, useMemo, useRef, useState } from "react";
import "../style.css";
import { db } from "../firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

export default function TripChat({ tripId, meUid, memberProfiles }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([]);
  const [meProfile, setMeProfile] = useState(null);
  const [nameMap, setNameMap] = useState({});

  const listRef = useRef(null);

  useEffect(() => {
    if (!meUid) {
      setMeProfile(null);
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, "profiles", meUid));
        setMeProfile(snap.exists() ? snap.data() || {} : {});
      } catch {
        setMeProfile({});
      }
    })();
  }, [meUid]);

  useEffect(() => {
    if (!tripId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, "trips", String(tripId), "messages"),
      orderBy("createdAt", "asc"),
      limit(200)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMessages(list);
      },
      () => {
        setMessages([]);
      }
    );

    return () => unsub();
  }, [tripId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const uids = Array.from(
      new Set(
        (messages || [])
          .map((m) => String(m?.uid || "").trim())
          .filter(Boolean)
      )
    );

    const need = uids.filter((uid) => {
      if (uid === String(meUid || "")) return false;
      if (nameMap[uid]?.displayName || nameMap[uid]?.publicId) return false;
      const mp = memberProfiles?.[uid] || null;
      const mpName = String(mp?.displayName || "").trim();
      const mpPid = String(mp?.publicId || "").trim();
      if (mpName || mpPid) return false;
      const inMsg = messages.some((m) => String(m?.uid || "") === uid && String(m?.displayName || "").trim());
      if (inMsg) return false;
      return true;
    });

    if (need.length === 0) return;

    (async () => {
      const next = {};
      await Promise.all(
        need.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "profiles", uid));
            if (snap.exists()) {
              const p = snap.data() || {};
              next[uid] = {
                displayName: String(p?.displayName || "").trim(),
                publicId: String(p?.publicId || "").trim().toLowerCase(),
              };
            } else {
              next[uid] = { displayName: "", publicId: "" };
            }
          } catch {
            next[uid] = { displayName: "", publicId: "" };
          }
        })
      );
      setNameMap((prev) => ({ ...prev, ...next }));
    })();
  }, [messages, meUid, memberProfiles, nameMap]);

  const canSend = useMemo(() => text.trim().length > 0 && !sending, [text, sending]);

  const displayNameOf = (m) => {
    const uid = String(m?.uid || "").trim();
    if (uid && meUid && uid === meUid) return "あなた";

    const dnInMsg = String(m?.displayName || "").trim();
    const pidInMsg = String(m?.publicId || "").trim();
    if (dnInMsg) return dnInMsg;
    if (pidInMsg) return `@${pidInMsg}`;

    const mp = memberProfiles?.[uid] || null;
    const mpName = String(mp?.displayName || "").trim();
    const mpPid = String(mp?.publicId || "").trim();
    if (mpName) return mpName;
    if (mpPid) return `@${mpPid}`;

    const nm = nameMap[uid] || null;
    const dn = String(nm?.displayName || "").trim();
    const pid = String(nm?.publicId || "").trim();
    if (dn) return dn;
    if (pid) return `@${pid}`;

    if (uid) return uid.slice(0, 6);
    return "メンバー";
  };

  const isMine = (m) => String(m?.uid || "") === String(meUid || "");

  const onSend = async () => {
    const t = text.trim();
    if (!t || sending || !tripId || !meUid) return;

    setSending(true);
    setText("");

    try {
      await addDoc(collection(db, "trips", String(tripId), "messages"), {
        uid: String(meUid),
        text: t,
        displayName: String(meProfile?.displayName || "").trim() || "ユーザー",
        publicId: String(meProfile?.publicId || "").trim().toLowerCase(),
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      alert(`送信に失敗しました: ${String(e?.message || e)}`);
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
      <div style={{ fontSize: 20, fontWeight: 900 }}>チャット</div>

      <div
        ref={listRef}
        style={{
          marginTop: 10,
          maxHeight: 220,
          overflowY: "auto",
          display: "grid",
          gap: 10,
          padding: 10,
          border: "1px solid var(--line)",
          borderRadius: 12,
          background: "#fff",
        }}
      >
        {messages.length === 0 && <div className="muted">まだメッセージはありません。</div>}

        {messages.map((m) => {
          const mine = isMine(m);
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "88%", display: "grid", gap: 6 }}>
                <div className="muted" style={{ fontSize: 12, textAlign: mine ? "right" : "left" }}>
                  {displayNameOf(m)}
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 14,
                    background: mine ? "#ffd08a" : "#efe5c6",
                    color: "#222",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.45,
                    wordBreak: "break-word",
                  }}
                >
                  {String(m?.text || "")}
                </div>
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
          placeholder="メッセージを送る"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={sending || !tripId || !meUid}
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
          onClick={onSend}
          disabled={!canSend || !tripId || !meUid}
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
          {sending ? "送信中…" : "送信"}
        </button>
      </div>
    </section>
  );
}
