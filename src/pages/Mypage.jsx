import React, { useEffect, useMemo, useState } from "react";
import { signOut, updateProfile } from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { ensureUser, updateDisplayName, updatePublicId } from "../lib/user";
import { useAuth } from "../components/AuthProvider";
import { listMyInvites, acceptInvite, rejectInvite } from "../lib/invites";
import { addTripMember, getTrip, upsertTripMemberProfile } from "../lib/trips";
import "../style.css";

export default function Mypage() {
  const { user, loading: authLoading } = useAuth();

  const [profile, setProfile] = useState(null);

  const [name, setName] = useState("");
  const [pid, setPid] = useState("");
  const [saving, setSaving] = useState(false);

  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invites, setInvites] = useState([]);
  const [inviteBusy, setInviteBusy] = useState(false);

  const [tripTitleMap, setTripTitleMap] = useState({});

  useEffect(() => {
    if (!user) return;

    (async () => {
      const baseId = user.uid.slice(0, 6).toLowerCase();

      const data = await ensureUser(user.uid, {
        displayName: user.displayName || "ユーザー",
        publicId: baseId,
        email: user.email,
      });

      setProfile(data);
      setName(data.displayName || "ユーザー");
      setPid(data.publicId || baseId);
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      if (authLoading) return;
      if (!user) {
        setInvites([]);
        setInvitesLoading(false);
        return;
      }

      setInvitesLoading(true);

      let publicId = "";
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        publicId = snap.exists() ? String(snap.data()?.publicId || "") : "";
      } catch {
        publicId = "";
      }

      const key = publicId || user.uid;
      const list = await listMyInvites(key);
      setInvites(list);

      const uniqueTripIds = Array.from(new Set(list.map((x) => x.tripId).filter(Boolean)));
      const pairs = await Promise.all(
        uniqueTripIds.map(async (id) => {
          try {
            const t = await getTrip(id);
            const title = String(t?.title || t?.destination || "").trim();
            return [id, title];
          } catch {
            return [id, ""];
          }
        })
      );
      setTripTitleMap(Object.fromEntries(pairs));

      setInvitesLoading(false);
    })();
  }, [authLoading, user, profile?.publicId]);

  const titleName = useMemo(() => {
    if (!profile) return "マイページ";
    return "マイページ";
  }, [profile]);

  if (authLoading) {
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

  if (!profile) {
    return (
      <div className="content-top">
        <p>読み込み中…</p>
      </div>
    );
  }

  const saveName = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await updateDisplayName(user.uid, name.trim());
    await updateProfile(user, { displayName: name.trim() });
    setProfile({ ...profile, displayName: name.trim() });
    setSaving(false);
  };

  const savePid = async () => {
    if (!pid.trim()) return;
    setSaving(true);
    try {
      await updatePublicId(user.uid, profile.publicId, pid.trim().toLowerCase());
      setProfile({ ...profile, publicId: pid.trim().toLowerCase() });
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("publicId_invalid")) {
        alert("IDは小文字・数字・_のみで、3〜20文字にしてください");
      } else {
        alert("そのIDはすでに使われています");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptInvite = async (inv) => {
    if (!user || inviteBusy) return;
    setInviteBusy(true);
    try {
      await addTripMember(inv.tripId, user.uid);

      await upsertTripMemberProfile(inv.tripId, user.uid, {
        displayName: profile?.displayName || name || user.displayName || "ユーザー",
        publicId: profile?.publicId || pid || "",
      });

      await acceptInvite(inv.id);
      setInvites((prev) => prev.filter((x) => x.id !== inv.id));
    } catch (e) {
      alert(`承諾に失敗しました: ${String(e?.message || e)}`);
    } finally {
      setInviteBusy(false);
    }
  };

  const handleRejectInvite = async (inv) => {
    if (inviteBusy) return;
    setInviteBusy(true);
    try {
      await rejectInvite(inv.id);
      setInvites((prev) => prev.filter((x) => x.id !== inv.id));
    } catch (e) {
      alert(`拒否に失敗しました: ${String(e?.message || e)}`);
    } finally {
      setInviteBusy(false);
    }
  };

  const senderLine = (inv) => {
    const dn = String(inv.fromDisplayName || "").trim();
    const fp = String(inv.fromPublicId || "").trim();
    if (dn && fp) return `${dn}（@${fp}）`;
    if (dn) return dn;
    if (fp) return `@${fp}`;
    const uid = String(inv.fromUid || "").trim();
    return uid ? uid.slice(0, 6) : "不明";
  };

  const inviteTitle = (inv) => {
    const a = String(inv.tripTitle || "").trim();
    if (a) return a;
    const b = String(tripTitleMap[inv.tripId] || "").trim();
    if (b) return b;
    return "旅行";
  };

  return (
    <div className="content-top">
      <h1>{titleName}</h1>

      <div className="saved-card" style={{ cursor: "default" }}>
        <div>
          <div style={{ fontWeight: 800 }}>ログイン中のアカウント</div>
          <div className="muted">{String(user.email || "不明")}</div>
        </div>
      </div>

      <div className="saved-card" style={{ cursor: "default" }}>
        <div style={{ width: "100%" }}>
          <div style={{ fontWeight: 800 }}>表示名</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ marginTop: 6, width: "100%" }} />
          <button onClick={saveName} disabled={saving} style={{ marginTop: 6 }}>
            変更する
          </button>
        </div>
      </div>

      <div className="saved-card" style={{ cursor: "default" }}>
        <div style={{ width: "100%" }}>
          <div style={{ fontWeight: 800 }}>アカウントID</div>
          <input value={pid} onChange={(e) => setPid(e.target.value)} style={{ marginTop: 6, width: "100%" }} />
          <button onClick={savePid} disabled={saving} style={{ marginTop: 6 }}>
            変更する
          </button>
        </div>
      </div>

      <section style={{ marginTop: 14 }}>
        <div className="mission-header">
          <h2 className="mission-heading">招待</h2>
        </div>

        {invitesLoading && <p>読み込み中…</p>}

        {!invitesLoading && invites.length === 0 && <p className="muted">招待はありません。</p>}

        {!invitesLoading && invites.length > 0 && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {invites.map((inv) => (
              <div key={inv.id} className="saved-card" style={{ cursor: "default" }}>
                <div style={{ width: "100%" }}>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{inviteTitle(inv)}</div>

                  <div className="muted" style={{ marginTop: 6 }}>
                    送信者：{senderLine(inv)}
                  </div>

                  {String(inv.message || "").trim() && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      メッセージ：{String(inv.message).trim()}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => handleAcceptInvite(inv)}
                      disabled={inviteBusy}
                      style={{ background: "#ffd08a", fontWeight: 900 }}
                    >
                      承諾
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRejectInvite(inv)}
                      disabled={inviteBusy}
                      style={{ background: "#efe5c6", fontWeight: 900 }}
                    >
                      拒否
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ marginTop: 12 }}>
        <button onClick={() => signOut(auth)} style={{ background: "#ffd08a", fontWeight: 900 }}>
          ログアウト
        </button>
      </div>
    </div>
  );
}
