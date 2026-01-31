import { auth } from "../firebase";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export async function authedFetch(input, init = {}) {
    const u = auth.currentUser;
    const token = u ? await u.getIdToken() : "";

    const headers = new Headers(init.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let url = input;
    if (API_BASE && typeof input === "string" && input.startsWith("/api/")) {
        url = API_BASE + input;
    }

    return fetch(url, { ...init, headers });
}
