import React, { useEffect, useMemo, useRef, useState } from "react";
import "../style.css";
import { createInvite } from "../lib/invites";
import { getUidByPublicId, isValidPublicId } from "../lib/user";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { upsertTripMemberProfile } from "../lib/trips";

export default function TripMembers({ trip, tripId, meUid, allowInvite = true, canInvite }) {
  const inviteEnabled = typeof canInvite === "boolean" ? canInvite : allowInvite;

  const [open, setOpen] = useState(false);
  const [pid, setPid] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [profiles, setProfiles] = useState({});
  const [meProfile, setMeProfile] = useState(null);

  const syncedMeRef = useRef(false);

  const members = useMemo(() => {
    return Array.isArray(trip?.memberUids) ? trip.memberUids : [];
  }, [trip?.memberUids]);

  useEffect(() => {
    syncedMeRef.current = false;
  }, [tripId, meUid]);

  useEffect(() => {
    if (!meUid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "profiles", meUid));
        if (snap.exists()) setMeProfile(snap.data() || {});
        else setMeProfile({});
      } catch {
        setMeProfile({});
      }
    })();
  }, [meUid]);

  useEffect(() => {
    if (!tripId || !meUid) return;
    if (!meProfile) return;
    if (syncedMeRef.current) return;

    const dn = String(meProfile?.displayName || "").trim();
    const pid2 = String(meProfile?.publicId || "").trim().toLowerCase();
    if (!dn && !pid2) {
      syncedMeRef.current = true;
      return;
    }

    (async () => {
      try {
        await upsertTripMemberProfile(tripId, meUid, { displayName: dn, publicId: pid2 });
      } catch {}
      syncedMeRef.current = true;
    })();
  }, [tripId, meUid, meProfile]);

  useEffect(() => {
    if (!members.length) {
      setProfiles({});
      return;
    }

    (async () => {
      const map = {};
      await Promise.all(
        members.map(async (uid) => {
          if (!uid) return;
          try {
            const snap = await getDoc(doc(db, "profiles", String(uid)));
            if (snap.exists()) map[String(uid)] = snap.data() || {};
          } catch {}
        })
      );
      setProfiles(map);
    })();
  }, [members]);

  const displayNameOf = (uid) => {
    const id = String(uid || "");
    if (!id) return "メンバー";
    if (id === meUid) return "あなた";

    const mp = trip?.memberProfiles?.[id];
    const mpName = String(mp?.displayName || "").trim();
    if (mpName) return mpName;
    const mpPid = String(mp?.publicId || "").trim();
    if (mpPid) return `@${mpPid}`;

    const p = profiles[id];
    const name = String(p?.displayName || "").trim();
    if (name) return name;

    const pid2 = String(p?.publicId || "").trim();
    if (pid2) return `@${pid2}`;

    return id.slice(0, 6);
  };

  const onInvite = async () => {
    const v = pid.trim().toLowerCase();
    setMsg("");

    if (!tripId || !meUid) return;

    if (!isValidPublicId(v)) {
      setMsg("IDは小文字・数字・_のみで、3〜20文字にしてください");
      return;
    }

    const myPublicId = String(meProfile?.publicId || "").trim().toLowerCase();
    if (myPublicId && v === myPublicId) {
      setMsg("自分自身は招待できません");
      return;
    }

    setBusy(true);
    try {
      const toUid = await getUidByPublicId(v);

      if (toUid && String(toUid) === String(meUid)) {
        setMsg("自分自身は招待できません");
        return;
      }

      await createInvite({
        tripId,
        fromUid: meUid,
        toPublicId: v,
        toUid: toUid || null,
        message: inviteMessage.trim(),
        fromDisplayName: String(meProfile?.displayName || "").trim(),
        fromPublicId: String(meProfile?.publicId || "").trim().toLowerCase(),
        tripTitle: String(trip?.title || trip?.destination || "").trim(),
      });

      setMsg("招待を送信しました");
      setPid("");
      setInviteMessage("");
      setOpen(false);
    } catch (e) {
      const s = String(e?.message || e);
      if (s.includes("invite_already_pending")) {
        setMsg("同じ旅行への招待がすでに送信されています（承諾待ち）");
      } else if (s.includes("Missing or insufficient permissions") || s.includes("permission")) {
        setMsg("権限エラーのため招待できませんでした（Firestoreルールを確認してください）");
      } else {
        setMsg(`招待に失敗しました: ${s}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      style={{
        marginTop: 12,
        background: "#fff",
        borderRadius: 14,
        padding: 12,
        boxShadow: "0 2px 6px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.16)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>メンバー</div>
        {inviteEnabled && (
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: "#ffd08a", fontWeight: 900 }}>
            メンバー追加
          </button>
        )}
      </div>

      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {members.length === 0 ? (
          <span className="muted">メンバーがいません</span>
        ) : (
          members.map((uid) => (
            <span
              key={String(uid)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: "#efe5c6",
                border: "1px solid var(--line)",
                fontSize: 13,
              }}
            >
              {displayNameOf(uid)}
            </span>
          ))
        )}
      </div>

      {inviteEnabled && open && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <input value={pid} onChange={(e) => setPid(e.target.value)} placeholder="アカウントID" disabled={busy} />

          <textarea
            value={inviteMessage}
            onChange={(e) => setInviteMessage(e.target.value)}
            placeholder="メッセージ（任意）"
            disabled={busy}
            rows={3}
            style={{
              width: "100%",
              borderRadius: 12,
              border: "1px solid var(--line)",
              padding: "10px 12px",
              background: "#fff",
              resize: "vertical",
            }}
          />

          <button type="button" onClick={onInvite} disabled={busy} style={{ fontWeight: 900 }}>
            {busy ? "送信中…" : "招待する"}
          </button>
        </div>
      )}

      {msg && (
        <div className="muted" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
          {msg}
        </div>
      )}
    </section>
  );
}
