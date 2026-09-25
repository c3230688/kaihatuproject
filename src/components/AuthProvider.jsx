import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { ensureUser } from "../lib/user";

const AuthContext = createContext({ user: null, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      async (u) => {
        setUser(u || null);
        if (u) {
          const baseId = u.uid.slice(0, 6).toLowerCase();
          try {
            await ensureUser(u.uid, {
              displayName: u.displayName || "ユーザー",
              publicId: baseId,
              email: u.email,
            });
          } catch {}
        }
        setLoading(false);
      },
      () => {
        setUser(null);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
