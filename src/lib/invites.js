import { db } from "../firebase";
import {
  collection,
  getDocs,
  query,
  serverTimestamp,
  doc,
  where,
  deleteDoc,
  runTransaction,
  getDoc,
} from "firebase/firestore";

function normPid(v) {
  return String(v || "").trim().toLowerCase();
}

function makeInviteDocId({ tripId, fromUid, toPublicId }) {
  const a = String(tripId || "").trim();
  const b = String(fromUid || "").trim();
  const c = normPid(toPublicId);
  return `${a}__${b}__${c}`;
}

export async function createInvite({
  tripId,
  fromUid,
  toPublicId,
  toUid,
  message,
  fromDisplayName,
  fromPublicId,
  tripTitle,
}) {
  const tid = String(tripId || "").trim();
  const fuid = String(fromUid || "").trim();
  const tpid = normPid(toPublicId);

  if (!tid || !fuid || !tpid) throw new Error("invite_invalid");

  const id = makeInviteDocId({ tripId: tid, fromUid: fuid, toPublicId: tpid });
  const ref = doc(db, "invites", id);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const st = String(snap.data()?.status || "").trim();
      if (!st || st === "pending") throw new Error("invite_already_pending");
      throw new Error("invite_already_exists");
    }

    tx.set(ref, {
      tripId: tid,
      tripTitle: String(tripTitle || "").trim(),
      fromUid: fuid,
      fromDisplayName: String(fromDisplayName || "").trim(),
      fromPublicId: normPid(fromPublicId),
      toPublicId: tpid,
      toUid: toUid ? String(toUid) : null,
      message: String(message || "").trim(),
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return { id };
}

export async function listPendingInvitesByToUid(toUid) {
  const q = query(
    collection(db, "invites"),
    where("toUid", "==", String(toUid)),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listPendingInvitesByToPublicId(toPublicId) {
  const q = query(
    collection(db, "invites"),
    where("toPublicId", "==", normPid(toPublicId)),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function acceptInvite(inviteId) {
  await deleteDoc(doc(db, "invites", String(inviteId)));
}

export async function rejectInvite(inviteId) {
  await deleteDoc(doc(db, "invites", String(inviteId)));
}

export async function listMyInvites(uidOrPublicId) {
  const v = String(uidOrPublicId || "").trim();
  if (!v) return [];
  const [a, b] = await Promise.all([
    listPendingInvitesByToUid(v).catch(() => []),
    listPendingInvitesByToPublicId(v).catch(() => []),
  ]);
  const m = new Map();
  for (const x of [...a, ...b]) m.set(x.id, x);
  return Array.from(m.values());
}

export async function getInvite(inviteId) {
  const id = String(inviteId || "").trim();
  if (!id) return null;
  const ref = doc(db, "invites", id);
  const snap = await getDoc(ref).catch(() => null);
  if (!snap || !snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
