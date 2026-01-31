import { jwtVerify, createRemoteJWKSet } from "jose";

function json(obj, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...extraHeaders,
        },
    });
}

function withCors(req, resHeaders = {}) {
    const origin = req.headers.get("Origin") || "";
    const allow =
        !origin ||
        origin === "http://localhost:5173" ||
        /^https:\/\/.+\.ngrok-free\.dev$/.test(origin) ||
        /^https:\/\/.+\.web\.app$/.test(origin) ||
        /^https:\/\/.+\.firebaseapp\.com$/.test(origin);

    if (!allow) return resHeaders;

    return {
        ...resHeaders,
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
    };
}

function safeStr(v) {
    return String(v ?? "").trim();
}

function clampInt(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(v)));
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

    let s = s0.replace(/^\uFEFF/, "").trim();
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

function makeId() {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
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
    return Array.from(new Set(places)).slice(0, 12);
}

function buildFallbackMissions(itinerary, daysCount, limit) {
    const cores = [
        {
            title: "甘い匂いの正体",
            desc: "歩いていると、どこからか甘い匂いがした。焼いている音や、立ち止まっている人の先にあるものを探してみよう。",
            missionName: "甘いもの",
            keywords: "スイーツ,甘い,匂い,焼き,食べ物",
        },
        {
            title: "何屋か一瞬でわからない",
            desc: "外から見ただけでは判断できない店。看板・ショーケース・入口の雰囲気に注目してみよう。",
            missionName: "お店",
            keywords: "店,看板,外観,入口,ショーケース",
        },
        {
            title: "触ってはいけなさそう",
            desc: "古そう、重そう、怒られそう。触らずに写真で記録しよう。",
            missionName: "置物",
            keywords: "石像,置物,オブジェ,古い,看板",
        },
        {
            title: "予定外ルート突入",
            desc: "ナビ通りじゃない道に入ってしまった。細い道、急な坂、雰囲気が変わった瞬間を残そう。",
            missionName: "路地",
            keywords: "路地,坂,道,曲がり角,寄り道",
        },
        {
            title: "探せ！今日の主役",
            desc: "景色でも食べ物でも人でもいい。今日の旅を代表する一枚を選ぼう。",
            missionName: "主役",
            keywords: "主役,思い出,景色,食べ物,旅",
        },
        {
            title: "これは撮るしかない",
            desc: "理由はうまく説明できなくていい。そう思ったなら、それが正解。",
            missionName: "気になる",
            keywords: "気になる,発見,直感,旅,記録",
        },
    ];

    const hints = pickPlaceHints(itinerary);
    const out = [];

    for (let i = 0; i < limit; i++) {
        const base = cores[i % cores.length];
        const day = (i % daysCount) + 1;
        const segIndex = i;
        const withHint =
            hints.length > 0 && Math.random() < 0.35
                ? `${base.desc}\n（ヒント：${hints[i % hints.length]}周辺でも達成できそう）`
                : base.desc;

        out.push({
            id: makeId(),
            day,
            segIndex,
            fromPlace: "",
            toPlace: "",
            title: base.title,
            desc: withHint,
            keywords: base.keywords,
            missionName: base.missionName,
            status: "未達成",
            photoDataUrl: "",
            photoUpdatedAt: "",
            judge: { status: "", pass: null, reason: "", judgedAt: "" },
        });
    }

    return out;
}

function sanitizeMissions(missions, daysCount, missionCount, itinerary) {
    const limit = clampInt(missionCount, 1, 30, 5);
    const src = Array.isArray(missions) ? missions : [];
    const out = [];

    for (const m of src) {
        if (out.length >= limit) break;

        const day = clampInt(m?.day, 1, daysCount, 1);
        const segIndex = clampInt(m?.segIndex, 0, 99, 0);
        const title = safeStr(m?.title);
        const desc = safeStr(m?.desc);
        const missionName = safeStr(m?.missionName);
        const keywords = safeStr(m?.keywords);

        if (!title || !desc) continue;

        out.push({
            id: safeStr(m?.id) || makeId(),
            day,
            segIndex,
            fromPlace: safeStr(m?.fromPlace || ""),
            toPlace: safeStr(m?.toPlace || ""),
            title,
            desc,
            keywords: keywords || missionName || "",
            missionName: missionName || "",
            status: "未達成",
            photoDataUrl: "",
            photoUpdatedAt: "",
            judge: { status: "", pass: null, reason: "", judgedAt: "" },
        });
    }

    if (out.length > 0) return out;
    return buildFallbackMissions(itinerary, daysCount, limit);
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

async function geminiJudgeMissionStrict(env, args) {
    const key = String(env.GOOGLE_API_KEY || "").trim();
    if (!key)
        return { pass: false, reason: "GOOGLE_API_KEYが設定されていません。" };

    const parsed = parseDataUrl(args.imageDataUrl);
    if (!parsed?.data) return { pass: false, reason: "画像データが不正です。" };

    const title = safeStr(args.missionTitle);
    const desc = safeStr(args.missionDesc);
    const keywords = safeStr(args.missionKeywords);
    const mname = safeStr(args.missionName);
    const from = safeStr(args.fromPlace);
    const to = safeStr(args.toPlace);

    const prompt = [
        "あなたは旅行アプリの『写真ミッション判定AI』です。",
        "ユーザーがアップした写真がミッションの意図に合っているかを判定してください。",
        "",
        "判定はやや厳しめにしてください：",
        "- pass=true: 写真が旅行要素を含み、ミッション説明・キーワードの意図に沿っている",
        "- pass=false: 背景不明な自撮りだけ、真っ暗/真っ白/ブレすぎ等で内容不明、意図と無関係",
        "",
        "出力は必ずJSONのみ（前後に文章を付けない / コードフェンス禁止）。",
        'JSON形式はこれだけ：{"pass": true, "reason": "短い理由(日本語)"}',
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

    const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
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

function firebaseVerifier(projectId) {
    const issuer = `https://securetoken.google.com/${projectId}`;
    const jwks = createRemoteJWKSet(
        new URL(
            "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
        ),
    );

    return async (idToken) => {
        const { payload } = await jwtVerify(idToken, jwks, {
            issuer,
            audience: projectId,
        });
        return payload;
    };
}

function parseAllowedEmails(env) {
    const raw = String(env.ALLOWED_EMAILS || "").trim();
    if (!raw) return new Set();
    return new Set(
        raw
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
    );
}

async function requireAllowed(env, req) {
    const authz = String(req.headers.get("Authorization") || "");
    const m = authz.match(/^Bearer\s+(.+)$/);
    if (!m) return { ok: false, status: 401, error: "missing_token" };

    const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
    if (!projectId)
        return { ok: false, status: 500, error: "missing_firebase_project_id" };

    const allowedEmails = parseAllowedEmails(env);
    if (allowedEmails.size === 0)
        return { ok: false, status: 500, error: "missing_allowed_emails" };

    try {
        const verify = firebaseVerifier(projectId);
        const decoded = await verify(m[1]);
        const email = String(decoded.email || "")
            .trim()
            .toLowerCase();
        if (!email || !allowedEmails.has(email))
            return { ok: false, status: 403, error: "not_allowed" };
        return { ok: true, user: decoded };
    } catch {
        return { ok: false, status: 401, error: "invalid_token" };
    }
}

async function openaiJson(env, prompt) {
    const key = String(env.OPENAI_API_KEY || "").trim();
    if (!key) throw new Error("OPENAI_API_KEY_missing");

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
        }),
    });

    const raw = await resp.text();
    if (!resp.ok) throw new Error(`openai_http_${resp.status}`);

    let data = {};
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        throw new Error("openai_invalid_json");
    }

    const text = data?.choices?.[0]?.message?.content || "{}";

    try {
        return JSON.parse(text);
    } catch {
        throw new Error("openai_content_invalid_json");
    }
}

/** ✅ NEW: concierge 用のトリップ整形 */
function sanitizeTripForConcierge(trip) {
    const nights = Number(trip?.stayNights) || 0;
    const daysCount =
        nights + 1 ||
        (Array.isArray(trip?.itinerary?.days)
            ? trip.itinerary.days.length
            : 1) ||
        1;

    const itinerary = sanitizeItinerary(trip?.itinerary || {}, daysCount);

    return {
        daysCount,
        baseTrip: {
            title: safeStr(trip?.title) || safeStr(trip?.destination) || "旅行",
            destination: safeStr(trip?.destination),
            startDate: safeStr(trip?.startDate),
            stayNights: nights,
            travelers: Number(trip?.travelers) || 1,
            budget: safeStr(trip?.budget || "standard"),
            missionCount: clampInt(trip?.missionCount, 1, 10, 5),
            itinerary,
            missions: Array.isArray(trip?.missions) ? trip.missions : [],
        },
    };
}

export default {
    async fetch(req, env) {
        const corsHeaders = withCors(req);

        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        const url = new URL(req.url);

        if (url.pathname === "/api/health") {
            return json(
                {
                    ok: true,
                    hasOpenAIKey: Boolean(env.OPENAI_API_KEY),
                    hasGoogleKey: Boolean(env.GOOGLE_API_KEY),
                    hasFirebaseProjectId: Boolean(env.FIREBASE_PROJECT_ID),
                    hasAllowedEmails: Boolean(
                        String(env.ALLOWED_EMAILS || "").trim(),
                    ),
                },
                200,
                corsHeaders,
            );
        }

        if (!url.pathname.startsWith("/api/")) {
            return json(
                { ok: false, error: "not_found", path: url.pathname },
                404,
                corsHeaders,
            );
        }

        const auth = await requireAllowed(env, req);
        if (!auth.ok) {
            return json(
                { ok: false, error: auth.error },
                auth.status,
                corsHeaders,
            );
        }

        if (req.method !== "POST") {
            return json(
                { ok: false, error: "method_not_allowed" },
                405,
                corsHeaders,
            );
        }

        let body = {};
        try {
            body = await req.json();
        } catch {
            body = {};
        }

        try {
            if (url.pathname === "/api/createTrip") {
                const {
                    title,
                    destination,
                    startDate,
                    stayNights,
                    travelers,
                    budget,
                    missionCount,
                } = body || {};
                if (!destination || !String(destination).trim()) {
                    return json(
                        { ok: false, error: "destination_required" },
                        400,
                        corsHeaders,
                    );
                }

                const tripTitle =
                    title && String(title).trim()
                        ? String(title).trim()
                        : `${destination}旅行`;

                const nights = Number(stayNights) || 0;
                const daysCount = nights + 1;
                const start = String(startDate || "").trim();
                const mcount = clampInt(missionCount, 1, 10, 5);

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
                ].join("\n");

                const parsed = await openaiJson(env, prompt);
                const fixedItinerary = sanitizeItinerary(
                    parsed?.itinerary || {},
                    daysCount,
                );

                return json(
                    {
                        ok: true,
                        trip: {
                            title: tripTitle,
                            destination,
                            startDate: start || "",
                            stayNights: nights,
                            travelers: Number(travelers) || 1,
                            budget: budget || "standard",
                            missionCount: mcount,
                            itinerary: fixedItinerary,
                            missions: [],
                        },
                    },
                    200,
                    corsHeaders,
                );
            }
            if (url.pathname === "/api/generateMissions") {
                const { trip } = body || {};
                if (!trip || typeof trip !== "object") {
                    return json(
                        { ok: false, error: "trip_required" },
                        400,
                        corsHeaders,
                    );
                }

                const destination = safeStr(trip?.destination);
                if (!destination) {
                    return json(
                        { ok: false, error: "destination_required" },
                        400,
                        corsHeaders,
                    );
                }

                const nights = Number(trip?.stayNights) || 0;
                const daysCount =
                    nights + 1 ||
                    (Array.isArray(trip?.itinerary?.days)
                        ? trip.itinerary.days.length
                        : 1) ||
                    1;

                const mcount = clampInt(trip?.missionCount, 1, 10, 5);
                const itinerary = sanitizeItinerary(
                    trip?.itinerary || {},
                    daysCount,
                );

                const prompt = [
                    "あなたは旅行アプリの『写真ミッション作成AI』です。",
                    "ユーザーが編集した旅行日程(itinerary)をもとに、写真ミッション(missions)を作ってください。",
                    "",
                    "重要：出力はJSONのみ（前後の文章禁止 / コードフェンス禁止）。",
                    "",
                    "missionsのJSONスキーマ（必須）:",
                    '{ "missions": [ { "day": 1, "segIndex": 0, "title": "ミッション名", "desc": "説明文", "missionName": "短い名詞(任意)", "keywords": "判定用キーワード(カンマ区切り,任意)" } ] }',
                    "",
                    "ミッション作りのルール：",
                    "- タイトルはゲームのクエスト名のように短く、説明的になりすぎない（15〜20文字目安）",
                    "- 「〜しよう」「〜を撮ろう」はタイトルに使わない",
                    "- 実在する店名・施設名・商品名は出さない",
                    "- 日程の雰囲気に寄せる（食べ歩きがありそう、路地がありそう、看板が多そう等）",
                    "- 説明文は少し具体的にし、ユーザーが何を撮ればいいかが分かる（40〜90文字目安）",
                    "- 正解を狭めない（屋台/店先/看板/路地/オブジェ等、幅広く達成できる）",
                    `- missionsはちょうど${mcount}個作る`,
                    "",
                    "旅行情報:",
                    JSON.stringify(
                        {
                            destination,
                            startDate: safeStr(trip?.startDate),
                            stayNights: nights,
                            travelers: Number(trip?.travelers) || 1,
                            budget: safeStr(trip?.budget || "standard"),
                        },
                        null,
                        2,
                    ),
                    "",
                    "現在の旅行日程:",
                    JSON.stringify(itinerary, null, 2),
                ].join("\n");

                const parsed = await openaiJson(env, prompt);
                const missions = sanitizeMissions(
                    parsed?.missions,
                    daysCount,
                    mcount,
                    itinerary,
                );

                return json({ ok: true, missions }, 200, corsHeaders);
            }

            if (url.pathname === "/api/concierge") {
                const { trip, message } = body || {};
                const userMessage = safeStr(message);

                if (!trip || typeof trip !== "object") {
                    return json(
                        { ok: false, error: "trip_required" },
                        400,
                        corsHeaders,
                    );
                }
                if (!userMessage) {
                    return json(
                        { ok: false, error: "message_required" },
                        400,
                        corsHeaders,
                    );
                }

                const nights = Number(trip?.stayNights) || 0;
                const daysCount =
                    nights + 1 ||
                    (Array.isArray(trip?.itinerary?.days)
                        ? trip.itinerary.days.length
                        : 1) ||
                    1;

                const baseItinerary = sanitizeItinerary(
                    trip?.itinerary || {},
                    daysCount,
                );

                const prompt = [
                    "あなたは旅行日程を調整するAIです。",
                    "ユーザーの要望に合わせて、既存の日程を編集したり、新しい予定を追加してください。",
                    "",
                    "ルール：",
                    "1) ユーザーの要望を最優先する。",
                    "2) 可能な範囲で日程(itinerary)を更新する。",
                    "3) 判断に必要な情報が足りない場合は、replyで確認の質問を1つだけ行う。",
                    "4) 返答は必ずJSONのみ（前後の文章禁止 / コードフェンス禁止）。",
                    "",
                    '必ず次の形式で返してください: {"reply":"...", "itinerary":{"days":[...]}}',
                    "",
                    "現在の日程:",
                    JSON.stringify(baseItinerary, null, 2),
                    "",
                    "旅行情報:",
                    JSON.stringify(
                        {
                            destination: safeStr(trip?.destination),
                            startDate: safeStr(trip?.startDate),
                            stayNights: nights,
                            travelers: Number(trip?.travelers) || 1,
                            budget: safeStr(trip?.budget || "standard"),
                        },
                        null,
                        2,
                    ),
                    "",
                    "ユーザーの要望:",
                    userMessage,
                ].join("\n");

                const parsed = await openaiJson(env, prompt);

                const nextItinerary = sanitizeItinerary(
                    parsed?.itinerary || baseItinerary,
                    daysCount,
                );
                const reply = safeStr(parsed?.reply) || "調整しました。";

                return json(
                    {
                        ok: true,
                        reply,
                        trip: {
                            title: safeStr(trip?.title) || "旅行",
                            destination: safeStr(trip?.destination),
                            startDate: safeStr(trip?.startDate),
                            stayNights: nights,
                            travelers: Number(trip?.travelers) || 1,
                            budget: safeStr(trip?.budget || "standard"),
                            missionCount: clampInt(
                                trip?.missionCount,
                                1,
                                30,
                                5,
                            ),
                            itinerary: nextItinerary,
                            missions: Array.isArray(trip?.missions)
                                ? trip.missions
                                : [],
                        },
                    },
                    200,
                    corsHeaders,
                );
            }

            if (url.pathname === "/api/judgeMission") {
                const {
                    missionTitle,
                    missionDesc,
                    missionKeywords,
                    missionName,
                    fromPlace,
                    toPlace,
                    imageDataUrl,
                } = body || {};
                if (!imageDataUrl || !String(imageDataUrl).trim()) {
                    return json(
                        { ok: false, error: "image_required" },
                        400,
                        corsHeaders,
                    );
                }

                const judge = await geminiJudgeMissionStrict(env, {
                    missionTitle,
                    missionDesc,
                    missionKeywords,
                    missionName,
                    fromPlace,
                    toPlace,
                    imageDataUrl,
                });
                return json({ ok: true, judge }, 200, corsHeaders);
            }
            return json(
                { ok: false, error: "not_found", path: url.pathname },
                404,
                corsHeaders,
            );
        } catch (e) {
            return json(
                { ok: false, error: String(e?.message || e) },
                500,
                corsHeaders,
            );
        }
    },
};
