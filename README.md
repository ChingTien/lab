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

## GitHub Pages 與後端

GitHub Pages 只提供靜態檔案，無法保存登入、分享連結及另一人填答的狀態。此專案使用 React + Vite 作前端、Node.js + SQLite 作 API；若前端放 GitHub Pages，Node API 必須另外部署在有**持久磁碟**的 Node.js 主機，並公開 HTTPS 網址。只把前端上傳 GitHub 而沒有 API，登入和分享均無法使用。

1. 部署 API，設定 `NODE_ENV=production`、強初始密碼、持久化的 `DB_PATH`，以及 `CORS_ORIGIN=https://你的帳號.github.io`。公開環境不要使用 `1234`。
2. 在 GitHub repository 的 **Settings → Secrets and variables → Actions → Variables** 設定 `VITE_API_BASE_URL` 為 API 的 HTTPS 網址（不含 `/api`）。如果 repository 名稱不是 `value-dialogue`，也設定 `VITE_BASE_PATH=/<repository名稱>/`。根目錄的 GitHub Pages repository 可設 `/`。
3. 在 **Settings → Pages** 選擇 **GitHub Actions** 作為發布來源。設定 API 網址後，於 **Actions** 手動執行一次 workflow；往後每次推送到 `main` 都會重新發布。未設定 API 網址時會略過部署，避免上線一個不能運作的登入頁。

如果你把建置後的 `dist/` 放在既有個人網站的 `/value-dialogue/` 目錄，建置時使用 `VITE_BASE_PATH=/value-dialogue/`。分享連結會沿用目前網頁的路徑。

## 首版規則

- 一個 `admin` 提問帳號；日後可加使用者註冊與多人題庫。
- 題組固定五題、五點同意程度量表。發布後鎖定題目與提問者的答案。
- 受邀者用不可猜測的連結填答一次；填完才會看到提問者答案。知道連結的人可看到已完成結果，分享時請自行斟酌內容。
- 結果逐題顯示兩人的答案與差異提示，沒有「相容度」分數，也不據此作人格判斷。

測試：`npm test`。本專案目前只有單機 SQLite 實作；若將來使用多個 Node 伺服器，需改用共用資料庫與跨節點登入限流。
