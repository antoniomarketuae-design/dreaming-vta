# Dreaming VTA — Product Map

**App name shown to users: "Dreaming"** (renamed from "Dreaming VTA" in v4). The folder, repo and URL keep `dreaming-vta`.

**What it is:** the user's first app. An installable web app (PWA) that lives on their **iPhone** Home Screen,
installed from a link — no App Store. The user builds the inside of the app *from the phone*: they ask Claude
(via the Claude app / this session), Claude changes the code and bumps the version, and the installed app
updates itself the next time it is opened.

**Status legend:** ✅ done · 🟡 in progress · ⬜ planned · 💭 idea

## Components

| Component | Status | Where | Notes |
|---|---|---|---|
| App shell (Home + About tabs, router) | ✅ v1 | `app/index.html`, `app/js/app.js` | New screen = new file in `app/js/screens/` + one entry in `SCREENS` in `app.js` (and add the file to `SHELL` in `sw.js`). |
| iPhone install (Add to Home Screen, full-screen, icon) | ✅ v1 | `index.html` meta tags, `manifest.webmanifest`, `app/icons/` | Install guide overlay shows on first visit in iOS Safari; `?install` previews it anywhere. |
| App icon (crescent moon, night sky) | ✅ v1 | `tools/make-icons.js` → `app/icons/*.png` | Pure-Node PNG encoder; rerun to regenerate. |
| Offline support (service worker) | ✅ v1 | `app/sw.js` | Network-first + cache fallback. Verified in headless Edge: offline reload renders fully. The in-app browser pane does NOT support service workers — test SW in Edge. |
| Self-update loop | ✅ v1 | `app/version.json`, `checkForUpdate` in `app.js`, `tools/bump.js` | **After every change run** `node tools/bump.js "what changed"`. App reloads on resume; shows "Version N is ready · Update" if open. Build log on About tab. |
| Local server | ✅ | `tools/serve.js` | Port 8787, 127.0.0.1 only, `Cache-Control: no-cache`. |
| Temporary public link | ❌ dropped | — | localhost.run rotated the URL within minutes and then dropped ("tunnel activity timeout"). Unusable for a Home Screen app, whose icon is tied to one URL. |
| Permanent hosting (GitHub Pages) | ✅ live 2026-11-09 | `tools/publish.js` | **https://antoniomarketuae-design.github.io/dreaming-vta/** · repo `antoniomarketuae-design/dreaming-vta` (public). `main` = whole project, `gh-pages` = `app/` via `git subtree push`; Pages auto-enabled on first gh-pages push, live ~30 s later. This PC's Git Credential Manager is already signed in, so pushes need no prompt. Verified live: all files 200, SW active, offline reload renders. |
| **Dream journal (v5)** — the app's purpose | ✅ live v5 | see rows below | User's spec (2026-11-09): greeting+date+quiet streak · hero = last dream's visualisation card · ONE big "Record last night's dream" button (voice default, typing secondary) · recent-dreams thumbnail strip · 4 tabs Home/Journal/Insights/Profile · first-time morning-reminder prompt · lucid/recurring gold star markers · text pale lavender ~80%, no white blocks. |
| Data store | ✅ | `app/js/store.js` | localStorage (`dreaming.dreams.v1`, `dreaming.settings.v1`); create/update/delete/list, stats (streak), settings, export/import, sample dreams. On-device only. |
| Auto title + tags | ✅ | `app/js/analyze.js` | Keyword dictionary `TAGS` (kind mood/symbol, hue). `suggestTitle` strips "I was…" lead-ins. |
| Dream visualisation | ✅ v5 | `app/js/dreamart.js` | Generative canvas painting seeded per dream, made on the phone (free fallback when there is no AI image). |
| Dreaming Plus (free vs paid) | ✅ v8 | `server/plans.json`, `app/js/account.js`, `paywall.js`, `screens/plus.js` | Anonymous device accounts; monthly limits free 1 image / 3 analyses / 0 videos, Plus 30 / 100 / 5; paywall sheet, subscriptions page, redeem codes. Payments NOT connected yet (`paymentsEnabled` false). |
| AI dream images | ✅ v8, photo look v9 | `server/images.js`, `app/js/images.js` | poyo `nano-banana-2` → fal fallback; ~30 s; sharp → 1024px WebP. **Photorealistic** prompt (user rejected the painted look); `plans.json images.look` = photo / painting. |
| AI dream videos | 🟡 v10 building | `server/videos.js`, `app/js/videos.js`, `css/video.css` | Plus only. poyo `seedance-2` (5 s, 720p, 9:16, with sound; AI image = first frame when present) → fal fallback (fal account locked: no balance). 2–4 min per video; 4 s 480p = 80 poyo credits. Full-screen player with sound + Save; marks on Journal/Home thumbnails. |
| Screens | ✅ v5 | `screens/home, record, dream, journal, insights, profile.js` + `css/<screen>.css` | Router in `app.js`: tabs + `#record[/type]` + `#dream/<id>`. Each screen owns a CSS file with a prefix (.home- .rec- .dream- .jr- .ins- .prof-). |
| Morning reminder | ✅ v5 (untested on iPhone) | `screens/profile.js` | Daily .ics calendar event (no server needed). Real push notifications need a server. |
| Dream interpretation — inbox server | ✅ live 2026-11-09 | `server/` → VPS `/opt/dreaming`, PM2 `dreaming-api` :3020 | **https://nexflowclub.com/dreaming-api/**. Phone sends dream → gets id + secret token → polls. Claude (dev PC, admin key in `~/.dreaming/admin.key`) reads `/admin/queue`, answers. Postgres db `dreaming`. Later the server calls the AI itself (same phone API). |
| Dream interpretation — knowledge base | ✅ pilot 2026-11-09 | `Interpretation/kb/` (PRIVATE: whole Interpretation/ folder is gitignored, PC only) | **1,026 entries (2026-11-09 evening): 828 symbols, 198 themes; 0 problems; Freud 630/630 + Miller 755/755 citations machine-verified (690 literal quotes); 437 care notes.** Built from all 2,173 Miller headwords + modern life + research typical themes via plan → source packs → 33 writer agents → cleanup/merge/relink. Test set: 28 dreams → 28/28 (avg 4.2 entries per answer, 7 small gaps; was 2.9 / 24). Interpreter tone: confident and direct. |match|get|list`. Next: add gaps reported by answers (e.g. tree, transformation, colours). |
| Dream interpretation — in the app | ✅ v6 beta | `app/js/interpret.js`, `screens/dream.js`, Profile → Labs switch | Tester flow: switch on in Profile → Labs; "✨ What does it mean?" on a dream → "Interpreting…" (polls) → card (essence, symbols, themes, feeling, perspectives tabs, reflect, care, based-on, 👍/👎). |
| Dream interpretation — answering loop | 🟡 manual (this PC) | `tools/inbox.mjs` | `inbox.mjs wait` runs in the background; when a dream arrives: claim → fresh interpreter agent (only interpreter.md + KB + dream) → `runs/<id>.result.json` → `inbox.mjs answer` (checks ids exist + prediction words) → restart wait. Only works while a Claude session runs it. Production = server calls the AI itself with the same rules + KB. |
| In-app Builder chat (Claude API) | 💭 later | — | User chose "start simple, add builder later". Needs a small backend + Anthropic API key (pay per use). |
| Native wrapper (App Store / TestFlight) | 💭 maybe | — | Capacitor can wrap the same code later if ever needed. |

## How to run

- Local preview: `node tools/serve.js` → http://localhost:8787
- Ship a change: `node tools/bump.js "Added the X screen"` then `node tools/publish.js` (live ~1 min later; the phone picks it up on next open).

## Decisions (2026-11-09)

- PWA over native: iPhone can't sideload apps; PWA needs no App Store, no $99 developer fee, works on Android too.
- Plain HTML/CSS/JS ES modules, no build step — keeps the "ask from phone → see it" loop instant.
- Dark "night sky" look (indigo/violet + moonlight yellow), iOS system font, safe-area aware.
