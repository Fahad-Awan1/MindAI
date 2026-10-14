# MindAI on your phone

MindAI runs on phones in two ways. Both use the same React code as the website, so every change to the web app also reaches the phone.

| | What it is | Needs |
|---|---|---|
| **Installable web app (PWA)** | Open MindAI in Chrome on the phone, then use **Install app** (sidebar) or **Add to Home screen**. It opens full screen with its own icon. | MindAI reachable over HTTPS (a tunnel or hosting) |
| **Android app (APK)** | A real app built with Capacitor (`frontend/android/`). You can share it as an APK or publish it on the Play Store. | Android Studio on this PC, plus the same HTTPS address |

The phone can't reach `localhost` on your PC, so MindAI first needs a public HTTPS address.

## 1. Give MindAI a public address (Cloudflare tunnel, free)

1. Install the tunnel tool once:
   ```
   winget install Cloudflare.cloudflared
   ```
2. Start the backend (port 8000) and the frontend (`npm run dev`, port 5173) as usual.
3. In a new terminal, run:
   ```
   cloudflared tunnel --url http://localhost:5173
   ```
   It prints an address like `https://something-random.trycloudflare.com`.
   - The tunnel points at the **frontend** (5173). Vite forwards `/api` and the study-room WebSockets to the backend, so this one address serves both the website and the API.

**Using the PWA:** open that address in Chrome on the phone and tap **Install app**.

The address changes every time you restart `cloudflared`, and it only works while your PC and the tunnel are running. For a fixed address, see section 4.

## 2. Build the Android app

**One-time setup:**
- Install [Android Studio](https://developer.android.com/studio). It brings Java and the Android SDK.
- Open it once so it finishes downloading the SDK.

**Every time the address changes:**
1. Put the tunnel address into `frontend/.env.mobile` (no trailing slash):
   ```
   VITE_API_URL=https://something-random.trycloudflare.com
   ```
2. Build and copy it into the Android project:
   ```
   cd frontend
   npm run build:mobile
   ```
3. Open the project in Android Studio:
   ```
   npm run android
   ```
4. From Android Studio, either:
   - Run it on your phone: turn on USB debugging, plug the phone in, and press ▶ Run.
   - Make an APK to share: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. The file is `android/app/build/outputs/apk/debug/app-debug.apk`.

### How the app differs from the website
- **Exports:** Word, CSV, Anki and the other exports open Android's share sheet (save to Files or Drive, or send on WhatsApp) instead of downloading.
- **Printing:** "Print / save as PDF" and the bubble sheet are hidden in the app, because Android WebView can't print. Use the Word export instead.
- **Back button:** it closes the menu or the open dialog first, then goes back through the screens you visited. On the first screen it closes the app.
- **Voice input:** the mic asks for microphone permission the first time.
- **Study-room invite links:** these use the public address from `.env.mobile`, so friends can open them in a browser.

## 3. Changing the code later
Edit the web app as usual, then run `npm run build:mobile` again and re-run the app from Android Studio. Don't edit `android/app/src/main/assets/public/`, because the build overwrites it.

App icon and splash screen sources are in `frontend/assets/`. To regenerate them after changing those files, run:
```
npx @capacitor/assets generate --android
```

## 4. Later: real hosting (fixed address, works when your PC is off)
- **Backend:** host the FastAPI backend on Render, Railway or a small VPS.
  - Set `GROQ_API_KEY` and `SECRET_KEY`.
  - Use a persistent disk for `mindai.db`, `uploads/` and `chroma_db/` (or move to Postgres).
  - Add your web address to `cors_origins` in `backend/config.py`.
- **Frontend:** build it with `VITE_API_URL=https://your-backend` and host `frontend/dist` on Netlify, Vercel or Cloudflare Pages. The web build also registers the service worker, so it can be installed as a PWA.
- **Android app:** set the same backend address in `.env.mobile` and rebuild. The address no longer changes.
- **Play Store:**
  - You need a Google Play developer account (one-time US$25 fee).
  - Make a signed release build: **Build → Generate Signed App Bundle**. Keep the keystore safe.
  - You also need a privacy policy URL, because the app uses the microphone and stores accounts.
