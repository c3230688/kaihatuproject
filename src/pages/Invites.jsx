import React, { useEffect, useMemo, useState } from "react";
import "../style.css";
import { useAuth } from "../components/AuthProvider";
import { listMyInvites, acceptInvite, rejectInvite } from "../lib/invites";
import { addTripMember, getTrip, upsertTripMemberProfile } from "../lib/trips";
import { db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

export default function Invites() {
  const { user, loading } = useAuth();

  const [busy, setBusy] = useState(true);
  const [invites, setInvites] = useState([]);
  const [tripTitles, setTripTitles] = useState({});

  useEffect(() => {
    (async () => {
      if (loading) return;
      if (!user) {
        setInvites([]);
        setTripTitles({});
        setBusy(false);
        return;
      }

      setBusy(true);

      let publicId = "";
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        publicId = snap.exists() ? String(snap.data()?.publicId || "") : "";
      } catch {
        publicId = "";
      }

      const key = String(publicId || "").trim() || String(user.uid);
      const list = await listMyInvites(key);
      setInvites(list);

      const uniqueTripIds = Array.from(new Set(list.map((x) => x.tripId).filter(Boolean)));
      const pairs = await Promise.all(
        uniqueTripIds.map(async (id) => {
          try {
            const t = await getTrip(id);
            const title = t?.title || t?.destination || "旅行";
            return [id, title];
          } catch {
            return [id, "旅行"];
          }
        })
      );
      setTripTitles(Object.fromEntries(pairs));

      setBusy(false);
    })();
  }, [loading, user]);

  const hasInvites = useMemo(() => invites.length > 0, [invites.length]);

  const onAccept = async (inv) => {
    if (!user) return;

    await addTripMember(inv.tripId, user.uid);

    try {
      const snap = await getDoc(doc(db, "profiles", user.uid));
      const p = snap.exists() ? snap.data() : {};
      await upsertTripMemberProfile(inv.tripId, user.uid, {
        displayName: p?.displayName || user.displayName || "ユーザー",
        publicId: p?.publicId || "",
      });
    } catch {}

    await acceptInvite(inv.id);
    setInvites((prev) => prev.filter((x) => x.id !== inv.id));
  };

  const onReject = async (inv) => {
    await rejectInvite(inv.id);
    setInvites((prev) => prev.filter((x) => x.id !== inv.id));
  };

  if (loading || busy) {
    return (
      <div className="content-top">
        <p>読み込み中…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="content-top">
        <p className="muted">ログインしてください。</p>
      </div>
    );
  }

  return (
    <div className="content-top">
      <h1>招待</h1>

      {!hasInvites && <p className="muted">招待はありません。</p>}

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {invites.map((inv) => (
          <div key={inv.id} className="saved-card" style={{ cursor: "default" }}>
            <div style={{ width: "100%" }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>
                {tripTitles[inv.tripId] || inv.tripTitle || "旅行"}
              </div>

              <div className="muted" style={{ marginTop: 6 }}>
                送信者：{inv.fromDisplayName || "不明"}
                {inv.fromPublicId ? `（@${inv.fromPublicId}）` : ""}
              </div>

              {inv.message && (
                <div className="muted" style={{ marginTop: 6 }}>
                  メッセージ：{inv.message}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => onAccept(inv)}
                  style={{ background: "#ffd08a", fontWeight: 900 }}
                >
                  承諾
                </button>
                <button type="button" onClick={() => onReject(inv)}>
                  拒否
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
