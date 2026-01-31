以下は「許可する Google アカウント（メールアドレス）を追加する」ための**運用手順書（説明書）**です。
このプロジェクトは **3か所**（フロント / Worker(API) / Firestore）で許可判定しているので、**追加するたびに3つ全部**を更新するのが安全です。

---

# 許可メール追加 手順書

## 0. 前提

* 追加したいメール例：`new.user@example.com`
* いま許可リストが存在する場所：

  1. フロント：`src/pages/LoginForm.jsx`（ALLOWED_EMAILS）
  2. Worker：`worker/src/index.js`（env.ALLOWED_EMAILS）
  3. Firestore：`firestore.rules`（isAllowed の email 配列）

---

## 1) フロント（ログイン画面の弾き）に追加する

### 対象ファイル

* `src/pages/LoginForm.jsx`

### 変更箇所

`ALLOWED_EMAILS` にメールを追加する。

例：

```js
const ALLOWED_EMAILS = new Set([
  "haruki7856th@gmail.com",
  "kaihatuproject8@gmail.com",
  "kaihatu.app01@gmail.com",
  "new.user@example.com"
]);
```

### 反映コマンド（Hostingに出している場合）

```powershell
npm run build
firebase deploy --only hosting
```

---

## 2) Worker(API) 側の許可リストに追加する

Worker は `ALLOWED_EMAILS` を **wrangler secret** で持っています。
つまり「secret 更新 + deploy」が必要です。

### 対象

* Cloudflare Workers（`worker/`）

### 実行場所

プロジェクト直下で PowerShell を開く

### コマンド（PowerShellは `&&` を使わない）

```powershell
cd worker
npx wrangler secret put ALLOWED_EMAILS
```

入力欄が出るので、**カンマ区切りで全件**を貼り付けます（上書き方式です）。

例（全部入れる）：

```txt
haruki7856th@gmail.com,kaihatuproject8@gmail.com,kaihatu.app01@gmail.com,new.user@example.com
```

次にデプロイ：

```powershell
npx wrangler deploy
```

### 動作確認（任意）

API ベースURLが設定されている環境でログイン後、アプリ操作ができるか確認。
（403 not_allowed が消える）

---

## 3) Firestore ルールの許可リストに追加する

Firestore ルールにもメール制限が入っています。
ここを更新しないと Firestore で **Missing or insufficient permissions** が出ます。

### 対象ファイル

* `firestore.rules`（プロジェクト直下にある想定）

  * もし無い場合は作成してください（firebase.json で参照されます）

### 変更箇所

`isAllowed()` の email 配列に追加する。

例：

```js
function isAllowed() {
  return signedIn()
    && request.auth.token.email != null
    && request.auth.token.email in [
      "haruki7856th@gmail.com",
      "kaihatuproject8@gmail.com",
      "kaihatu.app01@gmail.com",
      "new.user@example.com"
    ];
}
```

### ルール反映コマンド

```powershell
firebase deploy --only firestore:rules
```

※ 以前あなたの環境では `firebase.json` に firestore の指定が無くて失敗していたので、
`firebase.json` には以下が入っている必要があります：

```json
{
  "firestore": { "rules": "firestore.rules" },
  "hosting": { ... }
}
```

---

## 4) 追加後の最終チェック（必ず）

追加したメールでログインして、次を確認：

1. ログイン直後に「このアカウントは利用できません」が出ない
   → フロントOK

2. 旅行作成・ミッション生成など API が動く（403 not_allowed が出ない）
   → Worker OK

3. 旅行一覧が表示される / Firestore 書き込みできる（権限エラーが出ない）
   → Firestore OK