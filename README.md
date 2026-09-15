# 好好聊 · 五題對答案

用五個同意程度問題，邀請一個人一起聊聊。提問者建立五題並填答、發布專屬邀請；受邀者不必登入，完成後雙方都能看到結果。每份邀請只接受一人作答。

## 本機執行

需要 Node.js 24 以上。

```bash
npm ci
npm run dev:api
```

再開另一個終端機：

```bash
npm run dev
```

打開 `http://localhost:5173`。初始帳號是 `admin`，本機初始密碼是 `1234`，第一次登入必須改成至少 12 個字元的新密碼。資料寫入 `data/value-dialogue.db`。開發時 Vite 會把 `/api` 代理到 Node 伺服器。

單一伺服器模式：`npm run build` 後執行 `npm run start`，打開 `http://localhost:8787`。正式環境首次啟動**必須**提供長度至少 12 字元的 `ADMIN_INITIAL_PASSWORD`；建立管理員後可移除這個環境變數。正式環境請使用持久磁碟保存 `DB_PATH`，並定期備份該資料庫。不要將密碼、資料庫檔或 `.env` 提交到 GitHub。

已有 Docker 的話，也可以設定強密碼後執行 `docker compose up --build`；`compose.yaml` 會用具名 volume 保存資料。若公開於網路，仍需配置 HTTPS 網域與反向代理。

## 正式架構：GitHub Pages + Cloudflare Worker/D1

GitHub Pages 只提供 React 靜態前端；正式 API 位於 `worker/index.js`，資料由 Cloudflare D1 保存。`server/` 仍保留為本機 Node.js + SQLite 開發版本，Docker 也是可選的自架方案，正式部署不依賴它們。

正式部署步驟：

1. 建立名為 `value-dialogue` 的 D1 database，把取得的 database ID 填入 `wrangler.jsonc`。
2. 將 `ADMIN_INITIAL_PASSWORD` 設為 Worker secret（至少 12 個字元），不要寫進 repository。
3. 執行遠端 migration，再部署 Worker。`CORS_ORIGIN` 已限制為 `https://chingtien.github.io`。
4. 在 GitHub repository 的 **Settings → Secrets and variables → Actions → Variables** 設定 `VITE_API_BASE_URL` 為 Worker 的 HTTPS 網址（不含 `/api`），並設定 `VITE_BASE_PATH=/lab/`。
5. **Settings → Pages** 使用 **GitHub Actions** 作為來源，於 **Actions** 手動執行發布流程。

Cloudflare Worker 本機測試：複製 `.dev.vars.example` 為 `.dev.vars`、設定長密碼，然後執行 `npm run db:migrate:local` 和 `npm run dev:worker`。D1 migration 位於 `migrations/`；登入密碼使用 PBKDF2 雜湊，session 僅保存 token 雜湊。正式初始密碼不可以使用 `1234`。

如果你把建置後的 `dist/` 放在既有個人網站的 `/value-dialogue/` 目錄，建置時使用 `VITE_BASE_PATH=/value-dialogue/`。分享連結會沿用目前網頁的路徑。

## 首版規則

- 一個 `admin` 提問帳號；日後可加使用者註冊與多人題庫。
- 題組固定五題、五點同意程度量表。發布後鎖定題目與提問者的答案。
- 受邀者用不可猜測的連結填答一次；填完才會看到提問者答案。知道連結的人可看到已完成結果，分享時請自行斟酌內容。
- 結果逐題顯示兩人的答案與差異提示，沒有「相容度」分數，也不據此作人格判斷。

測試：`npm test` 會驗證 Node/SQLite 與 Worker/D1 兩條完整流程；`npm run check:worker` 會執行 Worker 部署前編譯檢查。GitHub Actions 也會在每次推送時執行這些檢查。
