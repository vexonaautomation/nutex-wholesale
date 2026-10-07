# Google Cloud, Google Sheets & Google Drive setup

Time needed: ~20 minutes. You need the Google account that will **own** the
business data (e.g. the company Gmail or Google Workspace account).

---

## Q. Google Cloud setup

1. **Create a project** – open <https://console.cloud.google.com/> → project picker → **New project** → name `nutex-wholesale` → Create. Make sure it is selected.
2. **Enable Google Sheets API** – *APIs & Services → Library* → search “Google Sheets API” → **Enable**.
3. **Enable Google Drive API** – same place → “Google Drive API” → **Enable**.
4. **Create a service account** – *IAM & Admin → Service Accounts → Create service account*
   - Name: `nutex-wholesale-app` → Create and continue → (no roles needed) → Done.
   - Open it → **Keys → Add key → Create new key → JSON** → a `.json` file downloads.
   - Keep this file private. **Never commit it to GitHub** (`.gitignore` already blocks `*service-account*.json`).
   - From the JSON copy:
     - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
     - `private_key` → `GOOGLE_PRIVATE_KEY` (keep the `\n` sequences; wrap in double quotes in `.env`)

## R. Google Sheets setup

5. **Create the spreadsheet** – <https://sheets.new> → name it `NUTEX WHOLESALE DATABASE`.
   - Leave it empty. The app creates all 17 sheets and header rows on first start (or run `npm run setup:sheets`).
   - Copy the ID from the URL `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit` → `GOOGLE_SHEET_ID`.
   **Optional — set up all tabs yourself with Apps Script** ([`google-sheets/setup.gs`](setup.gs)):
   1. In the sheet: **Extensions → Apps Script** → delete the sample code → paste the whole `setup.gs` → **Save**.
   2. Choose function **`setupNutexSheets`** → **Run** → *Review permissions* → your account → *Allow*.
   3. All 18 tabs are created with their header rows (frozen, coloured), default settings and schema version. The file is renamed “NUTEX WHOLESALE DATABASE” if it was “Untitled”.
   4. Reload the sheet → new **Nutex Setup** menu: *Create / update all sheets*, *Load initial categories, sizes and colours* (empty tabs only), *Check setup* (also shows whether the service account has Editor access).
   The script is additive only — safe to run any number of times. After a schema change, regenerate it with `npm run gs:generate`.

6. **Share the sheet with the service account** – **Share** → paste the service-account email → role **Editor** → untick “Notify people” → Share.
   - Keep the business owner as the sheet **owner**. The service account is only an editor.
   - Turn on version history protection: nothing to do — Google Sheets keeps version history automatically (*File → Version history*).

> Tip: Use a **separate** spreadsheet for development/testing. Never point a development machine at the production sheet when experimenting.

## S. Google Drive setup

7. **Create the folder** `NUTEX WHOLESALE` and copy its ID from `https://drive.google.com/drive/folders/<THIS_PART>` → `GOOGLE_DRIVE_FOLDER_ID`.
   The app creates these sub-folders automatically (and never deletes anything):
   ```
   NUTEX WHOLESALE/
   ├── PRODUCTS/          product images
   ├── CATEGORIES/        category images
   ├── COLORS/            colour swatches
   ├── PAYMENT/           payment QR uploaded by admin
   ├── PAYMENT-PROOFS/    customer payment screenshots (private)
   └── BRAND/             company logo
   ```
8. **Give the app upload access.** Choose ONE option:

   **Option A — Google Workspace (recommended if you have Workspace):**
   create a **Shared drive** (e.g. “Nutex Wholesale”), create the `NUTEX WHOLESALE` folder inside it, and add the
   service-account email as **Content manager**. Set `GOOGLE_DRIVE_AUTH=service_account`.

   **Option B — personal Gmail (no Workspace):**
   Service accounts have **no storage quota** in a personal “My Drive”, so uploads must be made as you:
   1. *APIs & Services → OAuth consent screen* → External → fill app name/support email → add your Gmail as a test user → then click **Publish app** (status **In production**; otherwise refresh tokens expire after 7 days). The “unverified app” warning is expected for this private internal tool.
   2. *Credentials → Create credentials → OAuth client ID → Desktop app* → copy client ID and secret into `.env` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
   3. Run `npm run drive:token`, open the printed URL, sign in as the folder owner, allow access.
   4. Copy the printed token to `GOOGLE_OAUTH_REFRESH_TOKEN` and set `GOOGLE_DRIVE_AUTH=oauth`.

   Files are served to shoppers through the app’s `/media/<fileId>` route, so you do **not** need to make the folder public. Payment proofs are only viewable by logged-in admins.

## Add Render environment variables

9. In Render → your service → **Environment**, add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `GOOGLE_SHEET_ID` | spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `…@….iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | full private key incl. `-----BEGIN PRIVATE KEY-----` (Render accepts real newlines or `\n`) |
| `GOOGLE_DRIVE_FOLDER_ID` | folder ID |
| `GOOGLE_DRIVE_AUTH` | `service_account` or `oauth` |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | only for `oauth` |
| `JWT_SECRET`, `SESSION_SECRET` | generated automatically by `render.yaml` (or 48+ random chars) |
| `FRONTEND_URL` | `https://<your-service>.onrender.com` or your domain |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | first admin (remove after first login) |

## Test the connection

10. Locally (with `.env` filled in):
    ```bash
    npm run setup:sheets -- --with-master-data
    npm run validate:production
    ```
    On Render: open `https://<service>/api/health` → `"ready": true`, then sign in at `/admin` → *Settings → System & backup* shows Google Sheets + Drive status.

### Troubleshooting
| Symptom | Fix |
|---|---|
| `The caller does not have permission` | Share the sheet with the service-account email as **Editor** |
| `Service Accounts do not have storage quota` | Use a Shared drive (Option A) or OAuth (Option B) |
| `invalid_grant` for Drive | Refresh token expired/revoked — publish the consent screen and run `npm run drive:token` again |
| `GOOGLE_PRIVATE_KEY is missing or malformed` | Paste the whole key including BEGIN/END lines; keep `\n` |
| `Quota exceeded` (429) | The app retries automatically; heavy admin use for a minute can hit Google’s 60 requests/min per user limit |
