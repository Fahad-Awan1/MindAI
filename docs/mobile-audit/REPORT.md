# MindAI mobile app audit: report

Branch: `fix/mobile-app-audit` (in a new git repository created for `MindAI/`; see "Repository" below).
Date: 2026-10-15.

## 1. Mobile stack detected

- **Capacitor 7**: the app is the same React 19 + TypeScript + Vite build, running in an Android WebView. Details are in [ARCHITECTURE.md](ARCHITECTURE.md).
- **Not React Native.** All the DOM, CSS and web APIs exist at runtime, and every fix applies to both the website and the app.
- **Origins:**
  - The app loads from `https://localhost`.
  - The API is reached cross-origin through `VITE_API_URL`, which is baked into the APK and currently points at a Cloudflare quick tunnel.
- **Native plugins** (synced and compiled into the APK):
  - app, filesystem, share, keyboard, status-bar, splash-screen, preferences
  - text-to-speech (new in this audit)
  - capgo social-login (Google)
- **Backend:** FastAPI + SQLite + ChromaDB + Groq, with WebSocket study rooms.

## 2. Issues found

There are 66 issues; the full list, with `file:line`, how each was confirmed and its status, is in [ISSUES.md](ISSUES.md).

| Category | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| A. Wiring and functionality (W) | 0 | 6 | 8 | 7 | 21 |
| B. Layout and UI on phones (L) | 0 | 10 | 23 | 3 | 36 |
| C. Code quality (Q) | 0 | 1 | 2 | 6 | 9 |
| **Total** | **0** | **17** | **33** | **16** | **66** |

How the issues were found:
- An automated sweep of 79 screens at 360/390/430/768px (`npm run check:mobile`) found **no page-level sideways overflow**, before or after the fixes.
- The real problems were inside components, in particular states or with long content. They were found by reading every screen's code (with three parallel code audits for layout, wiring and quality) and confirmed with scripts and requests.

The most important ones:

- **Android back button:**
  - It was swallowed on the quiz results, exam report and several dialogs, because it looked for an animation CSS class.
  - Back left an exam or quiz mid-attempt without confirmation.
- **Phone screens:**
  - Exam paper question text was about 90px wide on a phone.
  - Flashcard answers were cut off.
  - Delete, reply, copy and unshare only appeared on mouse hover, so they were invisible on touch. Unshare also had no confirm.
  - Reader text selection did nothing on touch.
- **In the app (cross-origin):**
  - Exports got the wrong file name and extension, so no other app could open them.
  - A non-Latin (Urdu) title made exports fail with a 500 error.
  - Read-aloud was silent, because the WebView has no speech synthesis.
- **Over the tunnel:**
  - Document uploads could time out (Cloudflare's ~100 s limit) and create duplicates.
  - Dropped streams looked like successful answers.
  - Study-room sockets didn't recover after the app was backgrounded or the network switched.
- **Backend:**
  - The rate limit used `127.0.0.1` for everyone behind the proxy, so anyone could lock any email out.
  - An exam could be marked twice.
  - Failed recording uploads left import jobs "queued" forever.
- **Code quality:** an old AI Studio prototype was still in the repo, and there was no linter or tests.

## 3. What was fixed

Commits on `fix/mobile-app-audit` (newest last):

| Commit | What |
|---|---|
| `f4e0643` | Baseline: the project as it was before the audit |
| `d392de7` | Architecture notes, issue list, `npm run check:mobile` |
| `cc199c1` | Backend wiring: export names over CORS, non-Latin titles, stuck imports, background summaries, double marking, real-IP rate limits, token redaction, input validation, in-app errors instead of `alert()` |
| `8c456bc` | Resilience: interrupted streams, gateway/timeout messages, socket reconnect + heartbeat, stale-401 sign-outs, refresh on resume, share-sheet cancel, link safety, stream aborts |
| `b37da4b` | Android back button / Escape: a real handler stack; confirm before leaving a quiz or exam |
| `0bef301` | Phone layout part 1: exam paper, flashcards, audio player, touch actions, ordering arrows, concept graph, long text, keyboard gap, safe areas, reader selection, chat starters and Enter key, `dvh` |
| `737db90` | Phone layout part 2: quiz and exam bars, teach-back, mind map, dashboard table, charts, profile, rename form, padding, tap targets, tight rows |
| `a203b30` | Native text-to-speech for read-aloud and audio overviews in the app |
| `439a651` | Removed dead prototype code and stale text; backend linter (ruff), which caught a real import bug in the export fix |
| `28f3be9` | ESLint, Vitest and pytest suites; build type-checks first; typed room socket events |
| (this commit) | Phone walkthrough script, report, screenshots |

**Not fixed, with the reason:**
- **W21: the APK points at a Cloudflare quick tunnel.** This is infrastructure, not code. The tunnel expired **twice during this audit**, and each time the installed app stopped working until it was rebuilt with the new address. MindAI needs a fixed address: a named Cloudflare tunnel on your own domain, or hosting the backend (Render or Railway).
- **Q1: a real-looking Gemini API key is in the untracked root `.env.local`,** left over from the old prototype. I can't revoke it. Please revoke it in Google AI Studio and delete the file.
- **Q9: errors loading the AI personas are ignored on purpose.** Chat works without them.
- **Lint warnings:** 13 `react-hooks/exhaustive-deps` warnings remain (0 errors). They are on effects written to run once, or only when one value changes. Adding the "missing" dependencies would make them re-run on every render, so they were left as they are rather than silenced.
- **Room message actions:** on touch, the small copy/reply bar appears over the top-left of the tapped bubble and can cover the start of its first line (it shows only after a tap). This is cosmetic.

## 4. Screenshots

- **Before/after:** `screenshots/before/` and `screenshots/after/`. Only the 390×844 set is committed; all four sizes are on disk.
  - The "after" shots show what the default screens look like now.
  - The default screens looked the same before and after, because the fixes are in deeper states.
- **Walkthroughs:** `screenshots/walkthrough-390/` and `screenshots/walkthrough-360/`. These show the deeper states after the fixes: quiz player, export sheet, exam paper, a long link in a room, the reader's selection toolbar, the composer above the keyboard and the upload card.
- **No "before" shots of those deeper states:** the walkthrough script was written after the fixes, so the before-side of the comparison is the issue description and `file:line` in ISSUES.md.

## 5. Results

| Check | Command | Result |
|---|---|---|
| Type check | `cd frontend && npm run typecheck` | ✅ no errors |
| Frontend lint | `npm run lint` | ✅ 0 errors, 13 warnings (above) |
| Frontend unit tests | `npm test` | ✅ 13/13 passed |
| Production build | `npm run build` (type-check + vite) | ✅ built |
| Backend lint | `venv\Scripts\python -m ruff check .` | ✅ all checks passed |
| Backend tests | `venv\Scripts\python -m pytest` | ✅ 17/17 passed |
| Mobile layout sweep | `npm run check:mobile` (79 screens × 4 sizes) | ✅ 0 problems |
| Phone feature walkthrough | `node scripts/mobile-walkthrough.mjs` at 390×844 and 360×740 | ✅ 10/10 steps both sizes |
| Android build | `npm run build:mobile` + `gradlew assembleDebug` | ✅ APK built, 9 plugins |

The phone walkthrough uses the real backend and AI. It covers:
- session restore after a reload
- AI Chat as Leo (a real streamed answer)
- opening and playing a saved quiz
- back/Escape asking before leaving the quiz
- the export sheet, with a CSV actually downloaded
- exam paper readability (narrowest question text 247px at 360 wide; it was about 90px)
- a long link wrapping in a study room over the WebSocket, with tap-to-show actions
- reader text selection
- the composer staying visible when the keyboard shrinks the view
- a document upload

**Not verified on a device.** No Android emulator or system image is installed on this PC, so the app was **not run on a device or emulator**. These could only be checked as "compiles and is configured", not run:
- native back button
- keyboard resize
- native text-to-speech
- native Google sign-in
- Preferences session storage
- the share sheet

Browser tests at phone size cover the same web code. Please run the checklist below on your phone.

## 6. Manual test checklist (real phone, new `MindAI.apk`)

1. **Install and sign in.** Install over the old app, sign in, then close the app completely and reopen it. You should still be signed in.
2. **Keyboard.** Tap the email field on Forgot password, the chat box and a room message box. The field must stay above the keyboard, with no 64px gap.
3. **Back button.**
   - Open the menu and press back: the menu closes.
   - Open the profile and press back: the profile closes.
   - In a quiz, press back: it asks "Leave this quiz?". Do the same in an exam.
   - Inside a room, back leaves the room. On Home, back closes the app.
4. **Exam paper.** Open an exam paper: the questions are readable, with marks under each question.
5. **Flashcards.** Open a deck with long answers, flip a card, and scroll the answer.
6. **Quiz answers.** Play an ordering question: the arrows are easy to tap.
7. **Export.** Use Word, CSV and Anki: the share sheet shows the right file name (e.g. `Quiz.docx`, `Quiz.txt`). Close the share sheet without choosing an app: there is no "Export failed".
8. **Read aloud.** Tap 🔊 on an AI answer: the phone reads it. An audio overview plays with the phone's voice.
9. **Rooms.** Tap a message: Reply/Copy appear. Turn Wi-Fi off and on, or background the app for a minute: the room reconnects.
10. **Reader.** Long-press to select text: the action bar appears above the tab bar.
11. **Upload.** Upload a document: it returns quickly and the summary appears a little later.
12. **Long text.** Paste a very long link in chat or a room: it wraps.
13. **Google sign-in.** This works only after the Android OAuth client is created in Google Cloud and the tunnel URL is added to the Web client's origins.

## 7. Risks and follow-ups

- **Hosting (most important).** Quick-tunnel URLs change, and the app breaks every time. Move to a fixed domain and backend hosting, then set `VITE_API_URL` once.
- **Google sign-in in the app.** It needs the Android OAuth client (package `com.mindai.app` + SHA-1) and the current web origin in Google Cloud Console. Native Google sign-in was not tested on a device.
- **Uploads through the tunnel.** These are capped at ~100 MB; the app now says so. Audio-overview generation is still a single long request and can hit the tunnel's ~100 s limit for long documents. Moving it to a background job, the way documents and imports now work, is the next step.
- **Repository.** `MindAI/` had no git repository; its parent folder `D:\Shared Folder` is the repo of a different project. A separate repo was created in `MindAI/`, and the parent repo was not touched. Add a remote and push this branch when you're ready.
- **Secrets.** `backend/.env` holds the Gmail app password and the Groq key. It is gitignored and was not committed. The Gmail app password was shared in chat during setup, so consider generating a new one.
- **Tests that need setup.** The backend tests and the phone walkthrough need a running backend and a verified test account; the walkthrough's AI steps need a working Groq key.
