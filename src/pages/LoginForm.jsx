import React, { useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import "../style.css";

import logo from "../img/logo.jpg";

export default function LoginForm() {
    const nav = useNavigate();
    const loc = useLocation();
    const { user, loading } = useAuth();
    const [msg, setMsg] = useState("");

    useEffect(() => {
        if (loading) return;

        if (user) {
            const to = loc.state?.from || "/";
            nav(to, { replace: true });
        }
    }, [loading, user, nav, loc.state]);

    const handleGoogleLogin = async () => {
        setMsg("");

        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);

            const to = loc.state?.from || "/";
            nav(to, { replace: true });
        } catch (e) {
            console.error(e);
            setMsg("Googleログインに失敗しました");
        }
    };

    return (
        <div className="auth-container">
            <div className="login-hero">
                <div className="login-logo-card">
                    <img src={logo} alt="おでかけしおり" className="login-logo" />
                </div>

                <button className="login-google-btn" onClick={handleGoogleLogin}>
                    Googleでログイン
                </button>

                {msg && (
                    <div
                        style={{
                            marginTop: 12,
                            background: "#fff6e6",
                            border: "1px solid #f1d2a3",
                            borderRadius: 12,
                            padding: 12,
                        }}
                    >
                        {msg}
                    </div>
                )}
            </div>
        </div>
    );
}
