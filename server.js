import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import admin from "firebase-admin";

admin.initializeApp();

const ALLOWED_EMAILS = new Set([
    "haruki7856th@gmail.com",
    "kaihatuproject8@gmail.com",
    "kaihatu.app01@gmail.com",
]);
const FIXED_MISSION_COUNT = 5;

const app = express();

app.use(
    cors({
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            if (origin === "http://localhost:5173") return cb(null, true);
            if (/^https:\/\/.+\.ngrok-free\.dev$/.test(origin))
                return cb(null, true);
            if (/^https:\/\/.+\.web\.app$/.test(origin)) return cb(null, true);
            if (/^https:\/\/.+\.firebaseapp\.com$/.test(origin))
                return cb(null, true);
            return cb(null, false);
        },
    }),
);

app.use(express.json({ limit: "25mb" }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function requireAllowed(req, res, next) {
    try {
        const authz = String(req.headers.authorization || "");
        const m = authz.match(/^Bearer\s+(.+)$/);
        if (!m)
            return res.status(401).json({ ok: false, error: "missing_token" });

        const decoded = await admin.auth().verifyIdToken(m[1]);
        const email = String(decoded.email || "")
            .trim()
            .toLowerCase();

        if (!email || !ALLOWED_EMAILS.has(email)) {
            return res.status(403).json({ ok: false, error: "not_allowed" });
        }

        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ ok: false, error: "invalid_token" });
    }
}

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        hasGoogleKey: Boolean(process.env.GOOGLE_API_KEY),
    });
});

app.use("/api", requireAllowed);

function toISODateOrEmpty(v) {
    if (!v) return "";
    const s = String(v).trim();
    return s ? s : "";
}

function isValidTimeHHMM(s) {
    return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

function normalizeFee(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function sanitizeItinerary(itinerary, daysCount) {
    const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
    const fixedDays = [];

    for (let day = 1; day <= daysCount; day++) {
        const src = days.find((d) => Number(d?.day) === day) || {};
        const srcItems = Array.isArray(src?.items) ? src.items : [];
        const items = srcItems
            .slice(0, 8)
            .map((x) => ({
                start: isValidTimeHHMM(x?.start) ? x.start : "09:00",
                end: isValidTimeHHMM(x?.end) ? x.end : "10:00",
                place: String(x?.place || x?.title || "予定").trim(),
                address: String(x?.address || "").trim(),
                description: String(x?.description || x?.desc || "").trim(),
                feeYen: normalizeFee(x?.feeYen ?? x?.fee ?? x?.priceYen),
                mapsQuery: String(
                    x?.mapsQuery || x?.address || x?.place || "",
                ).trim(),
            }))
            .filter((x) => x.place.length > 0);

        fixedDays.push({
            day,
            date: String(src?.date || "").trim(),
            items: items.length
                ? items.map((x) => ({
                      ...x,
                      mapsQuery:
                          x.mapsQuery || `${x.place} ${x.address}`.trim(),
                  }))
                : [
                      {
                          start: "09:00",
                          end: "10:00",
                          place: "予定",
                          address: "",
                          description: "",
                          feeYen: null,
                          mapsQuery: "予定",
                      },
                  ],
        });
    }

    return { days: fixedDays };
}

function parseDataUrl(dataUrl) {
    const s = String(dataUrl || "").trim();
    const m = s.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { mimeType: m[1], data: m[2] };
}

function extractTextFromGeminiResponse(parsedResp) {
    const parts = parsedResp?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) return "";
    return parts
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
}

function coerceJsonObject(text) {
    const s0 = String(text || "").trim();
    if (!s0) return null;

    let s = s0;
    s = s.replace(/^\uFEFF/, "").trim();

    const fenceMatch = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) s = String(fenceMatch[1] || "").trim();

    if (s.startsWith("{") && s.endsWith("}")) {
        try {
            return JSON.parse(s);
        } catch {}
    }

    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) {
        const mid = s.slice(i, j + 1);
        try {
            return JSON.parse(mid);
        } catch {}
    }

    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
        try {
            return JSON.parse(m[0]);
        } catch {}
    }

    return null;
}

let cachedFetch = null;
async function getFetch() {
    if (typeof globalThis.fetch === "function") return globalThis.fetch;
    if (cachedFetch) return cachedFetch;
    const mod = await import("node-fetch");
    cachedFetch = mod.default;
    return cachedFetch;
}

function normalizeJudge(obj) {
    const pass = obj?.pass === true;
    const reason = String(obj?.reason || "").trim();
    return {
        pass,
        reason:
            reason ||
            (pass
                ? "ミッションの意図に合っていそうです。"
                : "ミッションの意図と一致しない可能性があります。"),
    };
}

async function geminiJudgeMissionStrict({
    missionTitle,
    missionDesc,
    missionKeywords,
    missionName,
    fromPlace,
    toPlace,
    imageDataUrl,
}) {
    const key = String(process.env.GOOGLE_API_KEY || "").trim();
    if (!key)
        return { pass: false, reason: "GOOGLE_API_KEYが設定されていません。" };

    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed?.data) return { pass: false, reason: "画像データが不正です。" };

    const title = String(missionTitle || "").trim();
    const desc = String(missionDesc || "").trim();
    const keywords = String(missionKeywords || "").trim();
    const mname = String(missionName || "").trim();
    const from = String(fromPlace || "").trim();
    const to = String(toPlace || "").trim();

    const prompt = [
        "あなたは旅行アプリの『写真ミッション判定AI』です。",
        "ユーザーがアップした写真がミッションの意図に合っているかを判定してください。",
        "",
        "判定はやや厳しめにしてください：",
        "- pass=true: 写真が旅行要素を含み、ミッション説明・キーワードの意図に沿っている",
        "- pass=false: 背景不明な自撮りだけ、真っ暗/真っ白/ブレすぎ等で内容不明、意図と無関係",
        "",
        "出力は必ずJSONのみ（前後に文章を付けない / コードフェンス禁止）。",
        "JSON形式はこれだけ：",
        '{"pass": true, "reason": "短い理由(日本語)"}',
        "",
        "ミッション情報:",
        `- タイトル: ${title || "なし"}`,
        `- 説明: ${desc || "なし"}`,
        `- キーワード: ${keywords || "なし"}`,
        `- ミッション名: ${mname || "なし"}`,
        `- ルート: ${from && to ? `${from} → ${to}` : "なし"}`,
    ].join("\n");

    const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

    const body = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: parsed.mimeType || "image/jpeg",
                            data: parsed.data,
                        },
                    },
                ],
            },
        ],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 1200,
            responseMimeType: "application/json",
        },
    };

    const fetchFn = await getFetch();
    const resp = await fetchFn(endpoint, {
        method: "POST",
        headers: {
            "x-goog-api-key": key,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const raw = await resp.text();

    if (!resp.ok) {
        return {
            pass: false,
            reason: `判定APIがエラーを返しました。(HTTP ${resp.status})`,
        };
    }

    let parsedResp = {};
    try {
        parsedResp = raw ? JSON.parse(raw) : {};
    } catch {
        return { pass: false, reason: "判定レスポンスが不正です。" };
    }

    const outText = extractTextFromGeminiResponse(parsedResp).trim();
    if (!outText) return { pass: false, reason: "判定できませんでした。" };

    const judgeObj = coerceJsonObject(outText);
    if (!judgeObj || typeof judgeObj !== "object") {
        return { pass: false, reason: "判定結果の形式が不正でした。" };
    }

    return normalizeJudge(judgeObj);
}

function makeId() {
    try {
        return randomUUID();
    } catch {
        return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
}

function clampInt(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(v)));
}

function safeStr(v) {
    return String(v ?? "").trim();
}

function pickPlaceHints(itinerary) {
    const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
    const places = [];
    for (const d of days) {
        const items = Array.isArray(d?.items) ? d.items : [];
        for (const it of items) {
            const p = safeStr(it?.place);
            if (p) places.push(p);
        }
    }
    const uniq = Array.from(new Set(places));
    return uniq.slice(0, 24);
}

function buildSegments(itinerary) {
    const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
    const segs = [];

    for (const d of days) {
        const day = Number(d?.day) || 1;
        const items = Array.isArray(d?.items) ? d.items : [];
        for (let i = 0; i < items.length - 1; i++) {
            const fromPlace = safeStr(items[i]?.place);
            const toPlace = safeStr(items[i + 1]?.place);
            if (!fromPlace || !toPlace) continue;
            segs.push({ day, segIndex: i, fromPlace, toPlace });
        }
    }

    return segs;
}

function sanitizeMissions(missions, daysCount, itinerary) {
    const limit = FIXED_MISSION_COUNT;
    const src = Array.isArray(missions) ? missions : [];
    const out = [];

    const itineraryFixed = sanitizeItinerary(itinerary || {}, daysCount);
    const segs = buildSegments(itineraryFixed);
    const segMap = new Map();
    for (const s of segs) segMap.set(`${s.day}|${s.segIndex}`, s);

    for (const m of src) {
        if (out.length >= limit) break;

        const day = clampInt(m?.day, 1, daysCount, 1);
        const segIndex = clampInt(m?.segIndex, 0, 99, 0);

        const title = safeStr(m?.title);
        const desc = safeStr(m?.desc);
        const missionName = safeStr(m?.missionName);
        const keywords = safeStr(m?.keywords);

        if (!title || !desc) continue;

        let fromPlace = safeStr(m?.fromPlace || "");
        let toPlace = safeStr(m?.toPlace || "");

        const seg = segMap.get(`${day}|${segIndex}`);
        if (seg) {
            fromPlace = seg.fromPlace;
            toPlace = seg.toPlace;
        }

        out.push({
            id: safeStr(m?.id) || makeId(),
            day,
            segIndex,
            fromPlace,
            toPlace,
            title,
            desc,
            keywords: keywords || missionName || "",
            missionName: missionName || "",
            status: "未達成",
            photoDataUrl: "",
            photoUpdatedAt: "",
            judge: {
                status: "",
                pass: null,
                reason: "",
                judgedAt: "",
            },
        });
    }

    return out;
}

app.post("/api/createTrip", async (req, res) => {
    try {
        const { title, destination, startDate, stayNights, travelers, budget } =
            req.body || {};

        if (!destination || !String(destination).trim()) {
            return res
                .status(400)
                .json({ ok: false, error: "destination_required" });
        }

        const tripTitle =
            title && String(title).trim()
                ? String(title).trim()
                : `${destination}旅行`;
        const nights = Number(stayNights) || 0;
        const daysCount = nights + 1;
        const start = toISODateOrEmpty(startDate);

        const prompt = [
            "あなたは旅行プランナーです。",
            "次の条件で旅行日程(itinerary)だけを作ってください。",
            "",
            `行き先: ${destination}`,
            `開始日: ${start || "未指定"}`,
            `日数: ${daysCount}日（${nights}泊）`,
            `人数: ${Number(travelers) || 1}`,
            `予算: ${budget || "standard"}`,
            "",
            "重要：出力はJSONのみ（前後の文章禁止 / コードフェンス禁止）。",
            "",
            "itineraryのJSONスキーマ:",
            '{ "itinerary": { "days": [ { "day": 1, "date": "YYYY-MM-DD", "items": [ { "start": "09:00", "end": "10:30", "place": "目的地名", "address": "所在地", "description": "簡単な説明", "feeYen": null, "mapsQuery": "Googleマップ検索用クエリ" } ] } ] } }',
            "",
            `itinerary.daysは day=1..${daysCount} を必ず作る`,
            "itemsは各日2〜6件を目安に作る（最大8件）",
            "placeには実在の店名・施設名を入れてよい",
        ].join("\n");

        const r = await client.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
        });

        const text = r.choices?.[0]?.message?.content || "{}";

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            return res
                .status(500)
                .json({ ok: false, error: "invalid_json_parse", raw: text });
        }

        const fixedItinerary = sanitizeItinerary(
            parsed?.itinerary || {},
            daysCount,
        );

        return res.json({
            ok: true,
            trip: {
                title: tripTitle,
                destination,
                startDate: start || "",
                stayNights: nights,
                travelers: Number(travelers) || 1,
                budget: budget || "standard",
                missionCount: FIXED_MISSION_COUNT,
                itinerary: fixedItinerary,
                missions: [],
            },
        });
    } catch (e) {
        return res
            .status(500)
            .json({ ok: false, error: e?.message || "failed" });
    }
});

app.post("/api/generateMissions", async (req, res) => {
    try {
        const { trip } = req.body || {};
        if (!trip || typeof trip !== "object") {
            return res.status(400).json({ ok: false, error: "trip_required" });
        }

        const destination = String(trip?.destination || "").trim();
        if (!destination) {
            return res
                .status(400)
                .json({ ok: false, error: "destination_required" });
        }

        const nights = Number(trip?.stayNights) || 0;
        const daysCount =
            nights + 1 ||
            (Array.isArray(trip?.itinerary?.days)
                ? trip.itinerary.days.length
                : 1) ||
            1;

        const itinerary = sanitizeItinerary(trip?.itinerary || {}, daysCount);
        const segments = buildSegments(itinerary);
        const placeHints = pickPlaceHints(itinerary);

        if (!segments.length) {
            return res
                .status(400)
                .json({ ok: false, error: "not_enough_segments" });
        }

        const prompt = [
            "あなたは旅行アプリの『写真ミッション作成AI』です。",
            "今回は『地点A→地点Bの移動中に寄り道して撮れる』ミッションだけを作ってください。",
            "",
            "重要：出力はJSONのみ（前後の文章禁止 / コードフェンス禁止）。",
            "",
            "missionsのJSONスキーマ（必須）:",
            '{ "missions": [ { "day": 1, "segIndex": 0, "fromPlace": "A", "toPlace": "B", "title": "ミッション名", "desc": "説明文", "missionName": "短い名詞(任意)", "keywords": "判定用キーワード(カンマ区切り,任意)" } ] }',
            "",
            "ミッション作りのルール：",
            "- すべてのミッションは必ず『移動区間(fromPlace→toPlace)の途中で寄り道して達成できる』内容にする",
            "- タイトルはRPGクエスト風に短く（15〜20文字目安）、説明的になりすぎない",
            "- タイトルに「〜しよう」「〜を撮ろう」「写真」は入れない",
            "- 説明文は『道中で立ち止まって撮れるもの』が想像できる具体性（40〜90文字目安）",
            "- 正解を狭めない（店先/看板/路地/小さな名所/オブジェ等、幅広く達成できる）",
            "- 実在の店舗名・施設名は itinerary に含まれる place を引用する形ならOK（勝手に新しい店名は作らない）",
            "- missionsは必ず5個ちょうど（不足・超過は禁止）",
            "",
            "必ず次の移動区間リストから選び、fromPlace/toPlace はここからコピペする:",
            JSON.stringify({ segments }, null, 2),
            "",
            "itineraryに含まれる場所名（引用OK）:",
            JSON.stringify({ places: placeHints }, null, 2),
            "",
            "旅行情報:",
            JSON.stringify(
                {
                    destination,
                    startDate: String(trip?.startDate || "").trim(),
                    stayNights: nights,
                    travelers: Number(trip?.travelers) || 1,
                    budget: String(trip?.budget || "standard"),
                },
                null,
                2,
            ),
            "",
            "現在の旅行日程:",
            JSON.stringify(itinerary, null, 2),
        ].join("\n");

        const r = await client.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
        });

        const text = r.choices?.[0]?.message?.content || "{}";

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            return res
                .status(500)
                .json({ ok: false, error: "invalid_json_parse", raw: text });
        }

        const missions = sanitizeMissions(
            parsed?.missions,
            daysCount,
            itinerary,
        );

        if (!missions || missions.length !== FIXED_MISSION_COUNT) {
            return res.status(500).json({
                ok: false,
                error: "mission_generation_failed",
                detail: `expected ${FIXED_MISSION_COUNT}, got ${missions?.length || 0}`,
            });
        }

        return res.json({ ok: true, missions });
    } catch (e) {
        return res
            .status(500)
            .json({ ok: false, error: e?.message || "generate_failed" });
    }
});

app.post("/api/concierge", async (req, res) => {
    try {
        const { trip, message } = req.body || {};
        const userMessage = String(message || "").trim();

        if (!trip || typeof trip !== "object") {
            return res.status(400).json({ ok: false, error: "trip_required" });
        }
        if (!userMessage) {
            return res
                .status(400)
                .json({ ok: false, error: "message_required" });
        }

        const nights = Number(trip?.stayNights) || 0;
        const daysCount =
            nights + 1 ||
            (Array.isArray(trip?.itinerary?.days)
                ? trip.itinerary.days.length
                : 1) ||
            1;

        const baseTrip = {
            title: String(trip?.title || "").trim() || "旅行",
            destination: String(trip?.destination || "").trim(),
            startDate: String(trip?.startDate || "").trim(),
            stayNights: nights,
            travelers: Number(trip?.travelers) || 1,
            budget: String(trip?.budget || "standard"),
            missionCount: FIXED_MISSION_COUNT,
            itinerary: sanitizeItinerary(trip?.itinerary || {}, daysCount),
            missions: Array.isArray(trip?.missions) ? trip.missions : [],
        };

        const prompt = [
            "あなたは旅行日程を調整するAIです。",
            "ユーザーの要望に合わせて、既存の日程を編集したり、新しい目的地や予定を追加してください。",
            "",
            "ルール：",
            "1) ユーザーの要望を最優先する。",
            "2) 可能な範囲で日程(itinerary)を更新する。",
            "3) 判断に必要な情報が足りない場合は、replyで確認の質問を1つだけ行う。",
            "4) 返答は必ずJSONのみ。",
            "",
            "必ず次の形式で返してください。",
            '{ "reply": "変更内容の説明や確認の質問", "itinerary": { "days": [ ... ] } }',
            "",
            "現在の日程:",
            JSON.stringify(baseTrip.itinerary, null, 2)a,
            "",
            "旅行情報:",
            JSON.stringify(
                {
                    destination: baseTrip.destination,
                    startDate: baseTrip.startDate,
                    stayNights: baseTrip.stayNights,
                    travelers: baseTrip.travelers,
                    budget: baseTrip.budget,
                },
                null,
                2,
            ),
            "",
            "ユーザーの要望:",
            userMessage,
        ].join("\n");

        const r = await client.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
        });

        const text = r.choices?.[0]?.message?.content || "{}";

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            return res
                .status(500)
                .json({ ok: false, error: "invalid_json_parse", raw: text });
        }

        const nextItinerary = sanitizeItinerary(
            parsed?.itinerary || baseTrip.itinerary,
            daysCount,
        );
        const reply = String(parsed?.reply || "").trim() || "調整しました。";

        return res.json({
            ok: true,
            reply,
            trip: {
                ...baseTrip,
                itinerary: nextItinerary,
            },
        });
    } catch (e) {
        return res
            .status(500)
            .json({ ok: false, error: e?.message || "concierge_failed" });
    }
});

app.post("/api/judgeMission", async (req, res) => {
    try {
        const {
            missionTitle,
            missionDesc,
            missionKeywords,
            missionName,
            fromPlace,
            toPlace,
            imageDataUrl,
        } = req.body || {};

        if (!imageDataUrl || !String(imageDataUrl).trim()) {
            return res.status(400).json({ ok: false, error: "image_required" });
        }

        const judge = await geminiJudgeMissionStrict({
            missionTitle,
            missionDesc,
            missionKeywords,
            missionName,
            fromPlace,
            toPlace,
            imageDataUrl,
        });

        return res.json({ ok: true, judge });
    } catch (e) {
        return res.status(500).json({
            ok: false,
            error: String(e?.message || "judge_failed"),
        });
    }
});

app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
});

app.listen(8787, () => {
    console.log("API running: http://localhost:8787");
    console.log("Health check: http://localhost:8787/api/health");
});
