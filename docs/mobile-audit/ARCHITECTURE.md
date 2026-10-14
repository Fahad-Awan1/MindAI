# MindAI architecture and mobile approach

This is what is actually in the repo, as of the audit on 2026-10-15. Every later step in the audit is based on it.

## Repository layout

| Path | What it is | Used? |
|---|---|---|
| `backend/` | FastAPI app: `main.py`, `routers/*.py`, `services/*`, SQLite through SQLAlchemy, ChromaDB, Groq | **Yes**: the API |
| `frontend/` | React 19 + TypeScript + Vite 6 + Tailwind 3 (bundled), with Capacitor 7 | **Yes**: the web app **and** the Android app |
| `frontend/android/` | Capacitor-generated Android Studio project (`com.mindai.app`) | **Yes** |
| `docs/` | Setup guides (`MOBILE.md`, `AUTH_SETUP.md`) and this audit | Yes |
| Root `App.tsx`, `index.tsx`, `index.html`, `components/`, `services/geminiService.ts`, `types.ts`, `package.json`, `vite.config.ts`, `metadata.json` | An older Google AI Studio prototype (Gemini in the browser). Nothing in `frontend/` or `backend/` imports it. | **No**: dead code |

## Mobile approach: Capacitor (a native WebView wrapper)

- **One codebase.** The mobile app is the same React build (`frontend/dist`), copied into `frontend/android/app/src/main/assets/public` by `npx cap sync android`. It is not React Native, so the DOM, CSS, `localStorage` and so on all exist at runtime.
- **App origin.** Android Capacitor serves the bundle from `https://localhost`. The backend is on a different origin, so every API call is cross-origin and goes through CORS.
- **Two builds:**
  - **Web:** `npm run build` / `npm run dev`. Same-origin: Vite proxies `/api` and the room WebSocket to the backend (`vite.config.ts`).
  - **App:** `npm run build:mobile` = `vite build --mode mobile` + `cap sync`. `.env.mobile` sets `VITE_API_URL` to the backend's public HTTPS address, which is baked in at build time.
- **Hosting today.** The public address is a Cloudflare *quick tunnel* to the Vite dev server (port 5173), which proxies to uvicorn on 8000. The URL changes every time the tunnel restarts, which means the APK has to be rebuilt each time.
- **Native plugins** (`package.json`, `capacitor.config.ts`):
  - `@capacitor/app`: Android back button and app lifecycle.
  - `@capacitor/filesystem` + `@capacitor/share`: exports go to the share sheet.
  - `@capacitor/keyboard` (`resizeOnFullScreen`): edge-to-edge keyboard resize.
  - `@capacitor/status-bar`, `@capacitor/splash-screen`.
  - `@capacitor/preferences`: keeps the session in native storage.
  - `@capgo/capacitor-social-login`: native Google sign-in.
- **Android config:**
  - `AndroidManifest.xml`: `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `windowSoftInputMode=adjustResize`.
  - `capacitor.config.ts`: `adjustMarginsForEdgeToEdge: 'force'`.
  - `app/build.gradle`: pins `androidx.browser:1.8.0` (AGP 8.7 / SDK 35).
- **PWA.** The web build is also installable. `vite-plugin-pwa` generates a service worker (registered in `src/index.tsx` on the web only) and uses `public/site.webmanifest`.
- **Platform glue** is in `frontend/src/services/platform.ts`:
  - `isNative`
  - `saveFile` (download vs share sheet)
  - back-button routing
  - keyboard handling (resize fallback and scrolling the focused field into view)
  - the install prompt

## How the frontend talks to the backend

- **HTTP:** axios instance in `frontend/src/services/api.ts`, `baseURL = VITE_API_URL || ''`.
  - A request interceptor adds `Authorization: Bearer <token>`.
  - A response interceptor clears the session on 401.
- **Streaming:** NDJSON over `fetch` (`streamChat`, `streamEvents` in `api.ts`) for chat, quiz and exam generation, and exam marking.
- **WebSocket:** study rooms, `wss://<api>/api/rooms/{id}/ws?token=…` (`roomsAPI.socketUrl`, `hooks/useRoomSocket.ts`).
- **Auth:**
  - JWT with a `tv` (token version) claim. 60-day lifetime, renewed on every app start (`POST /api/auth/refresh`).
  - Stored in `localStorage` + memory, plus Capacitor Preferences in the app (`services/authToken.ts`).
  - Email verification and password-reset codes use Gmail SMTP. Google sign-in uses GIS on the web and native Google sign-in in the app.
- **Uploads:**
  - Documents: `multipart` to `/api/documents/upload` (50 MB).
  - Lectures and recordings: `/api/imports/media` (500 MB), processed in the background with Whisper (Groq). The UI polls the job status.
- **Audio:**
  - Voice input: `MediaRecorder` → `/api/voice/transcribe`.
  - Read-aloud: Groq TTS when enabled on the server, otherwise the browser's `speechSynthesis`.
  - Audio overviews: rendered server-side when possible.

## Backend

- FastAPI (`backend/main.py`) with 15 routers: auth, documents, chat, ai_features, study_sets, tutor, voice, audio, graph, rooms, study_group (personas only), imports, assessment, exams, bank.
- SQLite (`mindai.db`). New columns are added at startup through `_ADDED_COLUMNS`.
- ChromaDB for RAG with numbered source passages, so citations stay real.
- Groq `openai/gpt-oss-120b` behind a token budget.
- CORS:
  - Configured origins plus a regex: `localhost`/`127.0.0.1` on any port and `*.trycloudflare.com`.
  - `https://localhost` and `capacitor://localhost` are allowed for the app.

## Tooling found

- **Type check:** `tsc --noEmit` (strict).
- **Build:** `vite build`.
- **Before this audit there was no:**
  - lint configuration
  - frontend unit tests
  - backend tests in the repo (the earlier test scripts lived outside it)
  - git repository for MindAI. Its parent folder `D:\Shared Folder` is the repo of an unrelated project, so a separate repo was created in `MindAI/` with a baseline commit, and this work is on branch `fix/mobile-app-audit`.
