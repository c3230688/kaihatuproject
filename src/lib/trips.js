import { db } from "../firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

function normId(v) {
  return String(v || "").trim();
}

export async function createTrip(trip) {
  const id = normId(trip?.id);
  if (!id) throw new Error("trip_id_required");

  const ref = doc(db, "trips", id);
  await setDoc(
    ref,
    {
      ...trip,
      id,
      updatedAt: serverTimestamp(),
      createdAt: trip?.createdAt || serverTimestamp(),
    },
    { merge: true }
  );
  return { id };
}

export async function getTrip(tripId) {
  const id = normId(tripId);
  if (!id) throw new Error("trip_id_required");
  const snap = await getDoc(doc(db, "trips", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function listTripsForUser(uid) {
  const u = normId(uid);
  if (!u) return [];
  const q = query(collection(db, "trips"), where("memberUids", "array-contains", u), orderBy("updatedAt", "desc"));
  const snap = await getDocs(q).catch(async () => {
    const q2 = query(collection(db, "trips"), where("memberUids", "array-contains", u));
    return await getDocs(q2);
  });
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addTripMember(tripId, uid) {
  const tid = normId(tripId);
  const u = normId(uid);
  if (!tid || !u) throw new Error("invalid_args");

  const ref = doc(db, "trips", tid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("trip_not_found");

    const data = snap.data() || {};
    const prev = Array.isArray(data.memberUids) ? data.memberUids.map(String) : [];

    if (prev.includes(u)) {
      tx.update(ref, { updatedAt: serverTimestamp() });
      return;
    }

    const next = [...prev, u];

    tx.update(ref, {
      memberUids: next,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function removeTripMember(tripId, uid) {
  const tid = normId(tripId);
  const u = normId(uid);
  if (!tid || !u) throw new Error("invalid_args");

  const ref = doc(db, "trips", tid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("trip_not_found");

    const data = snap.data() || {};
    const prev = Array.isArray(data.memberUids) ? data.memberUids.map(String) : [];
    if (!prev.includes(u)) {
      tx.update(ref, { updatedAt: serverTimestamp() });
      return;
    }

    const next = prev.filter((x) => String(x) !== u);

    tx.update(ref, {
      memberUids: next,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function upsertTripMemberProfile(tripId, uid, { displayName, publicId } = {}) {
  const tid = normId(tripId);
  const u = normId(uid);
  if (!tid || !u) throw new Error("invalid_args");

  const ref = doc(db, "trips", tid);

  const dn = String(displayName || "").trim();
  const pid = String(publicId || "").trim().toLowerCase();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("trip_not_found");

    const data = snap.data() || {};
    const members = Array.isArray(data.memberUids) ? data.memberUids.map(String) : [];
    if (!members.includes(u)) throw new Error("not_a_member");

    tx.update(ref, {
      [`memberProfiles.${u}.displayName`]: dn,
      [`memberProfiles.${u}.publicId`]: pid,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function deleteTripWithMessages(tripId) {
  const tid = normId(tripId);
  if (!tid) throw new Error("trip_id_required");

  const tripRef = doc(db, "trips", tid);

  const msgsRef = collection(db, "trips", tid, "messages");
  const q = query(msgsRef, orderBy("createdAt", "desc"), limit(400));
  const snap = await getDocs(q).catch(() => null);

  const batch = writeBatch(db);
  if (snap && snap.docs && snap.docs.length) {
    for (const d of snap.docs) batch.delete(d.ref);
  }
  batch.delete(tripRef);
  await batch.commit();
}

export async function deleteTrip(tripId) {
  const tid = normId(tripId);
  if (!tid) throw new Error("trip_id_required");
  await deleteDoc(doc(db, "trips", tid));
}
