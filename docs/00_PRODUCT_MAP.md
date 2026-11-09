# Dreaming VTA — Product Map

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
| The actual app content ("Your space") | ⬜ | `app/js/screens/` | Not decided yet — the user will define it from the phone. |
| In-app Builder chat (Claude API) | 💭 later | — | User chose "start simple, add builder later". Needs a small backend + Anthropic API key (pay per use). |
| Native wrapper (App Store / TestFlight) | 💭 maybe | — | Capacitor can wrap the same code later if ever needed. |

## How to run

- Local preview: `node tools/serve.js` → http://localhost:8787
- Ship a change: `node tools/bump.js "Added the X screen"` then `node tools/publish.js` (live ~1 min later; the phone picks it up on next open).

## Decisions (2026-11-09)

- PWA over native: iPhone can't sideload apps; PWA needs no App Store, no $99 developer fee, works on Android too.
- Plain HTML/CSS/JS ES modules, no build step — keeps the "ask from phone → see it" loop instant.
- Dark "night sky" look (indigo/violet + moonlight yellow), iOS system font, safe-area aware.
