# Mobile audit: issues

Each entry gives the screen or feature, `file:line`, what is wrong, how the problem was confirmed, its severity, the planned fix, and its status.

**Confirmed by:**
- **sweep:** `npm run check:mobile` ran 79 screens at 360×740, 390×844, 430×932 and 768×1024, with screenshots in `screenshots/before/`. It found **no page-level horizontal overflow**, so the problems below are inside components and only show in particular states or with long content.
- **code:** reading the code and working out the widths at 360px.
- **test:** reproduced with a script or a request.

Severity: **C** critical, **H** high, **M** medium, **L** low. Line numbers are from the baseline commit `f4e0643`.

Status: *Open* until fixed. When fixed, the entry gets **Fixed** plus the commit.

## A. Wiring and functionality

| ID | Feature | File:line | What is wrong | Confirmed | Sev | Planned fix | Status |
|---|---|---|---|---|---|---|---|
| W1 | Export (app) | `backend/main.py:57-65`, `frontend/src/services/api.ts:695` | CORS doesn't expose `Content-Disposition`, so the app can't read the file name and falls back to `mindai.anki`, `mindai.moodle` and so on. Those extensions are wrong, so no app can open the shared file. | code + test (cross-origin header check) | H | `expose_headers=["Content-Disposition"]`, plus a format-to-extension map on the client | Open |
| W2 | Export | `backend/services/assessment/export.py:508`, `routers/bank.py:139` | A title with non-Latin letters (Urdu or Arabic) goes into the `Content-Disposition` header and raises `UnicodeEncodeError`, giving a 500. | code + test | H | ASCII fallback name plus RFC 5987 `filename*=` | Open |
| W3 | Lecture import | `backend/routers/imports.py:57-66,105` | The job row is created before the upload is saved. On a 413, an empty file or a save error the job stays `queued` forever: the UI polls every 2 s indefinitely and the job can't be dismissed. | code | H | Mark the job failed on every error path | Open |
| W4 | Read aloud / Audio overview (app) | `frontend/src/services/speech.ts:37,65-77`, `AudioOverview.tsx:135-176` | Android System WebView has no Web Speech synthesis. Read-aloud is silent or never finishes, and the audio-overview fallback says "browser can't speak". | code (known WebView limit) | H | Native TTS plugin in the app, plus a timeout guard | Open |
| W5 | Document upload over the tunnel | `backend/routers/documents.py:55-141` | Parsing, embedding **and** an LLM summary all happen before the response. Over Cloudflare (about 100 s limit) a big PDF returns 524 while the server keeps going, so a retry creates a duplicate. | code | H | Generate the summary in a background task and respond right after indexing | Open |
| W6 | Recording upload (app) | `backend/routers/imports.py:46`, `ImportPanel.tsx` | The UI says "max 500 MB", but the tunnel caps uploads at 100 MB. Cloudflare's HTML 413 shows as "Upload failed". | code | M | Size check on the client when a remote API is used, with a clear message | Open |
| W7 | Study rooms (app) | `frontend/src/hooks/useRoomSocket.ts` | No reconnect on app resume, on `online`, or after a network switch. A half-open socket loses messages and the backoff isn't reset. | code | M | Reconnect on resume, `online` and `visibilitychange`, plus a heartbeat timeout | Open |
| W8 | Streaming (chat, exam marking, generation) | `frontend/src/services/api.ts:158-169,574-582` | A stream that closes without a `done` event (a tunnel reset) is treated as success: a half-finished answer looks complete, and exam marking spinners hang. | code | M | Throw `StreamError("connection interrupted")` when no terminal event arrives | Open |
| W9 | Streaming | `QuizEditor.tsx:79`, `QuizGenerator.tsx:134`, `ExamSetup.tsx` | Add-more and variant streams aren't aborted on unmount. | code | L | AbortController on unmount | Open |
| W10 | Exam submit | `backend/routers/exams.py:135` | A resubmit while marking is still running starts a second marking run, which duplicates the activity and the bank records. | code | M | 409 while `status == "grading"` and the submit is recent | Open |
| W11 | Errors (app) | `frontend/src/services/api.ts:15-17,47-59` | Cloudflare 502/52x HTML errors show a generic "Failed to load…". axios has no timeout, so spinners hang after a silent drop. | code | M | Map 502-504 and 520-530 to "Can't reach the MindAI server"; add a timeout | Open |
| W12 | Back button during an exam or quiz | `frontend/src/App.tsx:109-118` | Android back leaves the exam room or quiz player with no confirmation, and quiz answers are lost. | code | H | A back-guard stack the active screen can register with | Open |
| W13 | Login rate limit | `backend/services/auth_service.py:97-107` | It keys on `request.client.host`, which is always 127.0.0.1 behind the proxy and tunnel, and one bucket is shared by login, verify, reset and signup. Anyone can lock any email out. | code | M | Use the forwarded client IP (`CF-Connecting-IP` / `X-Forwarded-For`) and keep a separate bucket per purpose | Open |
| W14 | Room WebSocket | `api.ts:519`, `rooms.py:346` | The login token is in the WS URL, so uvicorn's access log prints it. | code | M | Redact `token=` in the access log | Open |
| W15 | Export (app) | `frontend/src/services/platform.ts:32-36` | Dismissing the share sheet shows "Export failed." | code | L | Ignore a share cancellation | Open |
| W16 | Session | `frontend/src/services/api.ts:24-34` | A 401 from a request sent with an *older* token (in flight during a password change) signs out the device that just got the new token. | code | L | Only clear the session if the failing request used the current token | Open |
| W17 | Session | `frontend/src/auth/AuthContext.tsx` | The session is only refreshed on cold start. An app that stays alive in the background never refreshes. | code | L | Also refresh on app resume, at most once a day | Open |
| W18 | Rooms / exams | `backend/routers/rooms.py:415,438`, `routers/assessment.py:690` | `int()` on client input: bad values drop the socket or return a 500. | code | L | Validate the input | Open |
| W19 | AI answers | `frontend/src/components/MarkdownMessage.tsx:53` | A relative or `#` link from the model would navigate the app's own WebView. | code | L | Render non-http(s) links as text | Open |
| W20 | File picker (app) | `DocumentList.tsx:147`, `ImportPanel.tsx:142` | `accept` lists only extensions, so Android may grey out `.md`, `.opus` and `.mkv` files. | code | L | Add MIME types to `accept` | Open |
| W21 | Deployment | `frontend/.env.mobile` | The APK has a quick-tunnel URL baked in, and every tunnel restart breaks it. | code | M | Not fixable in code: needs a fixed domain or named tunnel. Documented. | Open |

## B. Layout and UI on phones

| ID | Screen | File:line | What is wrong | Confirmed | Sev | Planned fix | Status |
|---|---|---|---|---|---|---|---|
| L1 | Android back button (several screens) | `services/platform.ts:114-120` | `closeTopDialog` treats every `.dialog-panel` (an animation class, also used on the quiz results and exam report pages, toasts and menus) as a dialog and sends Escape. Several dialogs don't listen for Escape, so back presses are swallowed and nothing happens. | code | H | A real dismiss stack (`useDismiss`) that dialogs register with | Open |
| L2 | Reader: highlight to explain | `Reader.tsx:229,146,257-276` | Uses only `onMouseUp`, so a touch selection never shows the toolbar. The toolbar is also about 430px wide (it spills past a 360px screen). | code | H | `selectionchange` listener; bottom-sheet toolbar on phones | Open |
| L3 | Exam paper | `exam/ExamPaper.tsx:214,224-231,284-319` | `p-[12mm]` plus `whitespace-nowrap` labels and marks leave about 90px for the question text. The name/date lines with underscores overflow. | code | H | Responsive padding; marks under the question on phones; wrapping meta rows | Open |
| L4 | Flashcards | `Flashcards.tsx:281,477,485,497` | Fixed-height `h-96` card with `p-10` and `overflow-hidden`: long answers are cut off. The page is `p-8` on every size. | code | H | Responsive padding; the card text scrolls | Open |
| L5 | Flashcards session header | `Flashcards.tsx:449-469` | Pill, progress bar, badge and Exit in one non-wrapping row (about 420px in 296px). | code | H | `flex-wrap`, and hide extras on phones | Open |
| L6 | Audio overview player | `AudioOverview.tsx:225-241,216,308` | Controls row about 350px in 248px with no wrap. | code | H | Wrap; speed buttons on their own row | Open |
| L7 | Touch: hidden actions | `SavedSets.tsx:105`, `RoomView.tsx:403,574,584,612` | Delete, reply/copy, mention, remove member and unshare only show on hover, so they are invisible on phones. Unshare has no confirm. | code | H | Always visible on touch screens (`@media (hover:none)`); confirm before unsharing | Open |
| L8 | Quiz: ordering question | `quiz/QuestionView.tsx:244-245` | Up/down arrows are 20×20px and touching each other: the only way to answer. | code | H | 40px buttons | Open |
| L9 | Concept graph | `ConceptGraph.tsx:299,328` | A 620px canvas taller than the screen traps scrolling; node details render off-screen below it. | code | H | `60dvh` on phones; scroll the details into view | Open |
| L10 | Long words and URLs | `RoomView.tsx:524-528`, `TutorChat.tsx:124`, `DocumentList.tsx:203,247` | Bubbles and file names don't break long URLs or names, so they overflow or get cut mid-word. | code | H | `min-w-0` + `overflow-wrap:anywhere` | Open |
| L11 | Chat / Rooms while typing | `App.tsx:333`, `TabBar.tsx:37` | The tab bar hides while typing but `main` keeps `pb-16`, so the composer floats 64px above the keyboard. | code | M | Drop the padding while typing | Open |
| L12 | Tutor drawer | `TutorChat.tsx:100-102,163` | `autoFocus` opens the keyboard immediately on phones. Fixed overlays don't follow the keyboard-inset fallback. | code | M | No autofocus on touch; overlays respect the keyboard inset | Open |
| L13 | Sidebar drawer | `Sidebar.tsx:177` | `h-screen` (100vh) pushes the bottom block under the mobile browser toolbar. | code | M | `inset-y-0` with no `h-screen`; safe-area padding | Open |
| L14 | Tab bar | `TabBar.tsx:37` | No safe-area padding at the bottom (gesture bar). | code | M | `env(safe-area-inset-bottom)` | Open |
| L15 | Reader toast | `Reader.tsx:282` | Squeezed to about 180px wide. | code | M | `inset-x-4 w-fit` | Open |
| L16 | Room settings menu | `RoomView.tsx:716` | Closes only on mouse-leave: it never closes on touch. | code | M | Outside-tap and Escape close | Open |
| L17 | Room details panel | `RoomView.tsx:833` | No backdrop, `w-80`, small close button. | code | M | Scrim that closes; `w-[min(20rem,100vw)]` | Open |
| L18 | AI Chat empty state | `ChatInterface.tsx:348,452-467` | Four stacked starter cards (about 250px) plus personas and the composer cover the intro message on short phones. | code + screenshot | M | Horizontal starter scroller on phones | Open |
| L19 | Composers | `chat/ChatComposer.tsx:127-130` | Enter always sends, and soft keyboards have no Shift+Enter, so you can't type a multi-line message. | code | M | On touch, Enter adds a new line and the button sends; `enterKeyHint` | Open |
| L20 | Quiz answers | `quiz/QuestionView.tsx:83,165,167,192,240`, `QuizBattle.tsx:152` | Option, match and order text doesn't wrap (`flex-1` without `min-w-0`). The "unlink" control is a 22px span inside a button. | code | M | Wrapping text; a real 40px button | Open |
| L21 | Numeric question | `QuestionView.tsx:268-276` | `w-56` input plus a unit in a row about 250px wide. | code | M | `w-full max-w-[14rem] min-w-0` | Open |
| L22 | Quiz top bar | `quiz/QuizPlayer.tsx:230-253` | Survival mode: hearts and timer crush the title to nothing. | code | M | Second row on phones | Open |
| L23 | Challenge play | `quiz/ChallengeModal.tsx:58` | The fixed close button sits on the quiz bar's timer and counter and exits without confirming. | code | M | Hide it while playing | Open |
| L24 | Exam room sections | `exam/ExamRoom.tsx:171-176` | Title, instructions and "2/3 chosen" squeezed into three columns. | code | M | Stack on phones | Open |
| L25 | Exam room bar | `ExamRoom.tsx:131` | Bar wraps to 2-3 rows (about 150px), leaving little room above the keyboard. | code | M | Compact one-row bar on phones | Open |
| L26 | Teach It Back result | `TeachBack.tsx:158-171,215,228` | Buttons squeeze the concept title to about 35px; fixed `p-8`. | code | M | Stack on phones; responsive padding | Open |
| L27 | Mind map | `MindMapGenerator.tsx:116,173-179,195-200` | Title doesn't truncate (no `min-w-0`); a zoomed map can't be panned. | code | M | `min-w-0`; scrollable when zoomed | Open |
| L28 | Dashboard documents table | `Dashboard.tsx:482-498` | `truncate` in an auto-layout table: a long name pushes the Type column out. | code | M | `table-fixed` | Open |
| L29 | Progress charts | `ProgressCharts.tsx:23,49-51,148-150,193` | About 5px axis labels on phones; tap tooltips stick and run off the edge. | code | M | Bigger labels; tap-outside close; capped tooltip width | Open |
| L30 | Profile dialog | `ProfileDialog.tsx:66-75` | A long email pushes the close button out; `90vh`. | code | M | `min-w-0`, `break-all`, `dvh` | Open |
| L31 | Quiz battle | `QuizBattle.tsx:82-84,191-193,213` | Podium 312px in a 280px box; non-owners can't close the battle. | code | M | Narrower podium; a Leave button for everyone | Open |
| L32 | Quiz rename | `quiz/QuizEditor.tsx:109-124` | Input plus Save/Cancel overflow the header. | code | M | `flex-wrap`, `min-w-0` | Open |
| L33 | Page padding | `Flashcards.tsx:281`, `MindMapGenerator.tsx:116`, `StudyPlanner.tsx:77`, `AudioOverview.tsx:308`, `TeachBack.tsx:158,215` | Fixed `p-8` pages with `p-8`/`p-10` cards leave about 230px for content. | code | M | `p-4 md:p-8` pages and `p-5 md:p-8` cards | Open |
| L34 | Tap targets | `ChatInterface.tsx:420`, `SpeakButton.tsx:56`, `App.tsx:306,314`, `RoomView.tsx:405,409`, `ConceptGraph.tsx:333`, `QuizSetup.tsx:266`, `PaperHeader.tsx:110,162`, `QuizPlayer.tsx:264` | Icon buttons about 20-30px. | code | L | At least `p-2` and 16px icons | Open |
| L35 | Tight rows | `QuizResults.tsx:192-198`, `StudyPlanner.tsx:157-166,192`, `QuizSetup.tsx:54-58,287-291`, `PaperHeader.tsx:145-170` | Rows squeeze at 360px. | code | L | `flex-wrap`, `overflow-x-auto` | Open |
| L36 | `vh` units | `QuizSetup.tsx:193`, `ExamSetup.tsx:136`, `AuthPage.tsx:358`, `App.tsx:289,406` | `vh`/`h-screen` in the WebView. | code | L | `dvh` | Open |

## C. Code quality

| ID | Area | File:line | What is wrong | Confirmed | Sev | Planned fix | Status |
|---|---|---|---|---|---|---|---|
| Q1 | Secrets | root `.env.local:1` | A real-looking Gemini API key from the old prototype (not tracked by git). | code | H | Can't revoke it from here: **the owner must revoke the key** in Google AI Studio. The file is left untouched. | Open |
| Q2 | Dead code | root `App.tsx`, `index.tsx`, `index.html`, `components/`, `services/geminiService.ts`, `types.ts`, `package.json`, `vite.config.ts`, `tsconfig.json`, `metadata.json` | Old AI Studio prototype, unused by `frontend/` and `backend/`. | code | M | Remove it from the repo | Open |
| Q3 | Tooling | `frontend/package.json` | No lint, no unit tests, `build` doesn't type-check; no backend tests in the repo. | code | M | Add ESLint, Vitest unit tests, type-check in the build, pytest auth tests | Open |
| Q4 | Stale text | `AuthPage.tsx:53`, `README.md:34` | Still advertises the removed "AI Study Group". | code | L | Update the text | Open |
| Q5 | Unused client API | `services/api.ts` (`studyGroupAPI.create/turn/end`, `documentsAPI.getById`, `chatAPI.chatWithDocument/KnowledgeBase`, `aiAPI.generateQuiz/ExamPaper`, `studySetsAPI.rename/submitQuizAttempt/submitFlashcardSession/submitExamAttempt`, `importsAPI.get`, `assessmentAPI.attempts`) | Never called. | code (grep) | L | Remove them | Open |
| Q6 | Unused types/imports | `types.ts:92` `AnalysisState`, `assessment/types.ts:5` `ExamQuestionType`; unused Python imports in `audio.py`, `exams.py`, `study_sets.py`, `import_service.py`, `study_group_service.py`, `voice_service.py` | Dead. | code | L | Remove them | Open |
| Q7 | `alert()` | `App.tsx:161,172`, `DocumentList.tsx:50` | Native-looking `alert()` for errors, inconsistent with the in-app UI. | code | L | In-app error banner | Open |
| Q8 | Broken script | `setup_test_data.ps1` | Uploads without auth ("the API has no authentication" no longer holds), so it gets a 401. | code | L | Remove it, with `test_doc.txt` | Open |
| Q9 | Silent failures | `ChatInterface.tsx:49`, `RoomView.tsx:159`, `ImportPanel.tsx:36` | Personas and imports fetch errors are swallowed. | code | L | Acceptable for personas (optional data); imports shows an error | Open |
