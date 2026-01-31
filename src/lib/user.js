import { db } from "../firebase";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";

export function isValidPublicId(v) {
    const s = String(v || "")
        .trim()
        .toLowerCase();
    return /^[a-z0-9_]{3,20}$/.test(s);
}

function normPid(v) {
    return String(v || "")
        .trim()
        .toLowerCase();
}

function makeAltPid(base) {
    const r = Math.random().toString(36).slice(2, 6);
    return `${base}_${r}`.slice(0, 20);
}

export async function getUidByPublicId(publicId) {
    const pid = normPid(publicId);
    if (!pid) return null;

    const ref = doc(db, "publicIds", pid);
    const snap = await getDoc(ref).catch(() => null);
    if (snap && snap.exists()) {
        const uid = String(snap.data()?.uid || "").trim();
        return uid || null;
    }

    const q = query(collection(db, "users"), where("publicId", "==", pid));
    const s2 = await getDocs(q);
    const first = s2.docs?.[0];
    if (!first) return null;
    const uid = String(first.id || "").trim();
    return uid || null;
}

async function claimPublicId(uid, basePid) {
    const u = String(uid || "").trim();
    let chosen = normPid(basePid);

    if (!isValidPublicId(chosen)) chosen = u.slice(0, 6).toLowerCase();
    if (!isValidPublicId(chosen)) chosen = makeAltPid("user");

    const out = await runTransaction(db, async (tx) => {
        for (let i = 0; i < 12; i++) {
            const ref = doc(db, "publicIds", chosen);
            const snap = await tx.get(ref);
            if (!snap.exists()) {
                tx.set(ref, {
                    uid: u,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                return chosen;
            }
            const mappedUid = String(snap.data()?.uid || "").trim();
            if (mappedUid === u) {
                tx.set(
                    ref,
                    { uid: u, updatedAt: serverTimestamp() },
                    { merge: true }
                );
                return chosen;
            }
            chosen = makeAltPid(basePid || chosen);
            if (!isValidPublicId(chosen)) chosen = makeAltPid("user");
        }
        throw new Error("publicId_taken");
    });

    return out;
}

export async function ensureUser(uid, { displayName, publicId, email } = {}) {
    const u = String(uid || "").trim();
    if (!u) throw new Error("uid_required");

    const dn = String(displayName || "").trim() || "ユーザー";
    const em = String(email || "").trim();
    const basePid = normPid(publicId) || u.slice(0, 6).toLowerCase();

    const userRef = doc(db, "users", u);
    const profileRef = doc(db, "profiles", u);

    const userSnap = await getDoc(userRef).catch(() => null);
    const profileSnap = await getDoc(profileRef).catch(() => null);

    let chosenPid = "";

    if (userSnap && userSnap.exists()) {
        const curr = userSnap.data() || {};
        const currPid = normPid(curr.publicId);
        if (currPid) {
            chosenPid = currPid;
            await setDoc(
                doc(db, "publicIds", chosenPid),
                { uid: u, updatedAt: serverTimestamp() },
                { merge: true }
            );
        } else {
            chosenPid = await claimPublicId(u, basePid);
        }

        await updateDoc(userRef, {
            displayName: String(curr.displayName || "").trim() || dn,
            publicId: chosenPid,
            email: String(curr.email || "").trim() || em,
            updatedAt: serverTimestamp(),
        });

        if (profileSnap && profileSnap.exists()) {
            const pc = profileSnap.data() || {};
            await updateDoc(profileRef, {
                displayName: String(pc.displayName || "").trim() || dn,
                publicId: normPid(pc.publicId) || chosenPid,
                updatedAt: serverTimestamp(),
            });
        } else {
            await setDoc(profileRef, {
                displayName: dn,
                publicId: chosenPid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        }

        const latestUser = await getDoc(userRef);
        const data = latestUser.exists() ? latestUser.data() || {} : {};
        return {
            uid: u,
            displayName: String(data.displayName || "").trim() || dn,
            publicId: normPid(data.publicId) || chosenPid,
            email: String(data.email || "").trim() || em,
        };
    }

    chosenPid = await claimPublicId(u, basePid);

    await setDoc(userRef, {
        displayName: dn,
        publicId: chosenPid,
        email: em,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    await setDoc(profileRef, {
        displayName: dn,
        publicId: chosenPid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    return { uid: u, displayName: dn, publicId: chosenPid, email: em };
}

export async function updateDisplayName(uid, displayName) {
    const u = String(uid || "").trim();
    const dn = String(displayName || "").trim();
    if (!u) throw new Error("uid_required");
    if (!dn) throw new Error("displayName_required");

    await Promise.all([
        updateDoc(doc(db, "users", u), {
            displayName: dn,
            updatedAt: serverTimestamp(),
        }).catch(async () => {
            await setDoc(
                doc(db, "users", u),
                {
                    displayName: dn,
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                },
                { merge: true }
            );
        }),
        updateDoc(doc(db, "profiles", u), {
            displayName: dn,
            updatedAt: serverTimestamp(),
        }).catch(async () => {
            await setDoc(
                doc(db, "profiles", u),
                {
                    displayName: dn,
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                },
                { merge: true }
            );
        }),
    ]);
}

export async function updatePublicId(uid, oldPublicId, newPublicId) {
    const u = String(uid || "").trim();
    const oldPid = normPid(oldPublicId);
    const nextPid = normPid(newPublicId);

    if (!u) throw new Error("uid_required");
    if (!isValidPublicId(nextPid)) throw new Error("publicId_invalid");

    const userRef = doc(db, "users", u);
    const profileRef = doc(db, "profiles", u);
    const oldRef = oldPid ? doc(db, "publicIds", oldPid) : null;
    const nextRef = doc(db, "publicIds", nextPid);

    await runTransaction(db, async (tx) => {
        const userSnap = await tx.get(userRef);
        const nextSnap = await tx.get(nextRef);
        const oldSnap = oldRef ? await tx.get(oldRef) : null;

        const currentPid = normPid(
            userSnap.exists() ? userSnap.data()?.publicId : ""
        );

        if (currentPid && currentPid !== oldPid && oldPid) {
            throw new Error("publicId_mismatch");
        }

        if (nextSnap.exists()) {
            const mappedUid = String(nextSnap.data()?.uid || "").trim();
            if (mappedUid && mappedUid !== u) throw new Error("publicId_taken");
        }

        if (oldRef && oldSnap && oldSnap.exists()) {
            const mappedUid = String(oldSnap.data()?.uid || "").trim();
            if (mappedUid === u) tx.delete(oldRef);
        }

        tx.set(
            nextRef,
            {
                uid: u,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
            },
            { merge: true }
        );
        tx.set(
            userRef,
            { publicId: nextPid, updatedAt: serverTimestamp() },
            { merge: true }
        );
        tx.set(
            profileRef,
            { publicId: nextPid, updatedAt: serverTimestamp() },
            { merge: true }
        );
    });

    return { ok: true, publicId: nextPid };
}
