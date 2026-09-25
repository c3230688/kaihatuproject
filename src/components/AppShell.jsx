import React, { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import "../style.css";

import logo from "../img/logo.jpg";
import calendarIcon from "../img/calendar.png";
import footprintsIcon from "../img/footprints.png";
import accountIcon from "../img/account.png";

export default function AppShell() {
    const nav = useNavigate();
    const [open, setOpen] = useState(false);

    const go = (path) => {
        setOpen(false);
        nav(path);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <>
            <header className="app-header">
                <div className="brand" onClick={() => go("/")} role="button" tabIndex={0}>
                    <img src={logo} alt="おでかけしおり" />
                </div>

                <div className="header-right">
                    <button className="hamburger-btn" aria-label="メニューを開く" onClick={() => setOpen(true)}>
                        <div className="hamburger">
                            <span className="bar" />
                            <span className="bar" />
                            <span className="bar" />
                        </div>
                    </button>
                </div>
            </header>

            <aside className={`drawer ${open ? "open" : ""}`}>
                <div className="drawer-top">
                    <button className="drawer-close" aria-label="閉じる" onClick={() => setOpen(false)}>
                        ×
                    </button>
                </div>

                <nav className="menu-list">
                    <button className="menu-item" onClick={() => go("/")}>
                        <img src={calendarIcon} alt="" />
                        日程作成
                    </button>

                    <button className="menu-item" onClick={() => go("/reschedule")}>
                        <img src={calendarIcon} alt="" />
                        日程再調整
                    </button>

                    <button className="menu-item" onClick={() => go("/footprints")}>
                        <img src={footprintsIcon} alt="" />
                        あしあと
                    </button>

                    <button className="menu-item" onClick={() => go("/mypage")}>
                        <img src={accountIcon} alt="" />
                        マイページ
                    </button>
                </nav>
            </aside>

            {open && <div className="overlay" onClick={() => setOpen(false)} />}

            <main className="page">
                <Outlet />
            </main>
        </>
    );
}
