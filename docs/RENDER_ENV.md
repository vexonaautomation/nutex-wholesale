# Render par saari settings (env) ek saath daalna

Saari settings ek hi file mein hain: **`deploy/render.env`**. Ise bharo, check karo aur Render mein ek baar mein paste kar do.

> `deploy/render.env` sirf aapke computer par rehti hai. Ye **GitHub par kabhi upload nahi hoti** (git-ignored), kyunki isme passwords aur keys hain. Kisi ko share mat karna.
> Khaali template GitHub par hai: `deploy/render.env.example`.

## 5 steps

1. **File kholo:** `deploy/render.env` (VS Code / Notepad).
2. **Bharo:** jahan bhi `PASTE_...` likha hai wahan apni value daalo (neeche table dekho).
3. **Check karo:**
   ```bash
   npm run env:check
   ```
   Sab theek ho to aakhri line `✓ Ready` aayegi. Koi kami ho to woh naam ke saath batayega. Ye check kisi password ya key ko screen par nahi dikhata.
4. **Render mein paste karo:** Render → apni service → **Environment** → **Add from .env** → poori file copy-paste → **Add variables** → **Save, rebuild and deploy**.
5. **Pehla login:** website khulne ke baad `https://<aapki-site>/admin` par apne admin email/password se login karo. Phir Render → Environment se **`ADMIN_BOOTSTRAP_PASSWORD` delete** kar do (admin ban chuka hai; password wahan rakhna zaroori nahi).

## Pehle se bhara hua (kuch karne ki zaroorat nahi)

| Variable | Value | Matlab |
|---|---|---|
| `NODE_ENV`, `NODE_VERSION`, `DATA_BACKEND`, `TRUST_PROXY` | production, 22, google, 1 | Live website ki basic settings |
| `ADMIN_SESSION_TIMEOUT` | 8h | Admin 8 ghante baad dobara login kare |
| `CATALOG_CACHE_TTL_SECONDS` | 60 | Product list 60 second tak fast cache |
| `KEEP_ALIVE` | auto | Website kabhi sleep nahi hogi (data ko nahi chhuta) |
| `JWT_SECRET`, `SESSION_SECRET` | random (bhar diye) | Login ki security keys. Badalne par sab admin logout ho jayenge |
| `FRONTEND_URL` | `https://nutex-wholesale.onrender.com` | Website ka address — Render jo address de, wahi rakhna (ya apna domain) |
| `ADMIN_BOOTSTRAP_NAME` | Nutex Owner | Admin ka naam (badal sakte ho) |
| `WHATSAPP_*` | aapki `.env` se | WhatsApp OTP. **Key abhi test wali hai** — live key mile to `WHATSAPP_API_KEY` badal dena |

## Aapko bharna hai

| Variable | Kya hai | Kahan milega |
|---|---|---|
| `ADMIN_BOOTSTRAP_EMAIL` | Aapki **admin ID** (email) | Jo email se admin login karna hai |
| `ADMIN_BOOTSTRAP_PASSWORD` | Admin password | Khud banao: kam se kam 10 characters, letters + numbers |
| `GOOGLE_SHEET_ID` | Google Sheet ka ID | Sheet ka link: `https://docs.google.com/spreadsheets/d/`**`YE_HISSA`**`/edit` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email | Google Cloud se download ki hui JSON key file mein `"client_email"` |
| `GOOGLE_PRIVATE_KEY` | Service account ki key | Usi JSON file mein `"private_key"` — poori value, double quotes ke andar (neeche example) |
| `GOOGLE_DRIVE_FOLDER_ID` | Drive folder ka ID | Folder ka link: `https://drive.google.com/drive/folders/`**`YE_HISSA`** |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Drive upload ki permission (Gmail ke liye) | Google Cloud → Credentials → OAuth client (Desktop app) |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Drive upload token | Apne computer par `npm run drive:token` chalao, jo token print ho woh paste karo |

Google Cloud, Sheet, Drive ka poora setup (screenshot jaisa step-by-step): [google-sheets/setup.md](../google-sheets/setup.md).

### `GOOGLE_PRIVATE_KEY` kaise paste karein
JSON file mein ye aisa dikhta hai — bas `"private_key":` ke baad wala poora hissa (quotes ke saath) copy karo:
```
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG...\n...\n-----END PRIVATE KEY-----\n"
```
`\n` waise hi rehne do — website unhe khud samajh leti hai.

### Gmail ya Google Workspace?
- **Personal Gmail** (jaise `@gmail.com`): `GOOGLE_DRIVE_AUTH=oauth` rakho aur teeno `GOOGLE_OAUTH_...` bharo. (Gmail mein service account file save nahi kar sakta.)
- **Google Workspace + Shared drive**: `GOOGLE_DRIVE_AUTH=service_account` karo aur teeno `GOOGLE_OAUTH_...` lines hata do.

## Dhyan rakhein
- Render par plan **Starter** hi rakhna (Free nahi) — website kabhi sleep nahi hogi.
- Sheet ko service-account email ke saath **Editor** share karna mat bhoolna.
- `deploy/render.env` galti se kisi ko chali jaye to: Google key nayi banao, WhatsApp key badlo, admin password badlo.
- Render Blueprint (`render.yaml`) use karte waqt Render kuch values poochega — chahe to khaali chhod ke service banne ke baad ye file paste kar do; paste ki hui values wahi set ho jayengi.
