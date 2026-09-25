# Daybook: an offline journal for iPhone

Built 2026-09-23. A Progressive Web App (PWA): install it once from Safari, and it runs from the Home Screen with no network. Entries and photos live only on the phone (IndexedDB). No account, no server, no tracking.

## Market scan (September 2026)

| App | Price | Where data lives | Export |
|---|---|---|---|
| Day One | Free (1 photo/entry); Silver $49.99/yr; Gold (AI) $74.99/yr; no lifetime | Local plus Day One Sync or iCloud | JSON zip with photos, PDF |
| Apple Journal | Free, built into iOS | On device, iCloud sync | No bulk export confirmed |
| Journey | About $4.17/mo billed yearly | Journey Cloud | Not confirmed |
| Diarium | Free tier; one-time Pro purchase, no subscription | Local; optional sync through your own OneDrive/Drive/Dropbox/iCloud | Not confirmed |
| Daylio | Free; up to $35.99/yr | Local, manual backup only | PDF, CSV |
| Reflectly | $39.99/yr | Cloud (AI features) | Not confirmed |
| Stoic | Up to $39.99/yr; lifetime $299 | iCloud | Not confirmed |
| Grid Diary | $29.99/yr | Not confirmed | Not confirmed |
| Obsidian | Free; Sync add-on paid | Plain Markdown files | Native Markdown |

Sources: App Store listings for each app; dayoneapp.com pricing guide (updated 2026-08-18) and export guide; journey.cloud/membership; diariumapp.com; ChoosingTherapy reviews of Day One and Daylio; WebKit blog post 10218 on storage and Home Screen apps.

Common complaints: Day One's subscription cost with no lifetime option, and feature bloat; Daylio's lack of automatic backup.

What Daybook copies: Day One's timeline, calendar, photo grid, On This Day, tags, stars, location, templates, prompts and its JSON export format; Diarium's no-subscription, local-first model; Obsidian's plain-text portability (Markdown export).

## Features

- Timeline grouped by month, with entry count, day streak and word count
- On This Day card for entries from the same date in earlier years
- Calendar with dots on days that have entries; write an entry for any past day
- Photos grid; photos shrink to 2048 px JPEG on import to save space
- Full-text search across text, tags and place names; filter by tag or star
- Markdown formatting: headings, bold, italic, lists, quotes, links
- Mood (5 levels), tags, star, location (GPS works offline; name a place once and nearby entries reuse the name)
- Multiple journals
- 26 writing prompts and 4 templates (daily review, gratitude, trip day, meeting notes)
- Autosave while typing
- Recently Deleted, kept 30 days
- 4-digit passcode with auto-lock (privacy screen; not encryption)
- Backup: a .zip in Day One's export format (JSON plus photos folder named by MD5). Restores into Daybook; should also import into Day One (not tested against Day One itself)
- Import: Daybook backups, Day One .zip exports and Day One .json files
- Markdown export of every entry
- Reminder banner when the last backup is more than 14 days old
- Light and dark mode

## What was tested (Chromium, iPhone-sized viewport)

Create, edit, photo, mood, tags, location, star, backdated entry, On This Day, calendar, search, photos grid, passcode set and unlock, full reload with the network off (app shell and entries load from cache), backup and restore into a clean browser, re-import skipping unchanged entries, Day One JSON import (escaped punctuation, place name, weather). MD5 matches the standard test vectors. Not tested on a physical iPhone.

## Install on the iPhone

1. Host the folder at an HTTPS address once (GitHub Pages is free; see below).
2. Open that address in Safari on the iPhone.
3. Tap Share, then Add to Home Screen.
4. Open Daybook from the Home Screen icon. From then on it needs no network.

Use the Home Screen app, not the Safari tab. WebKit exempts Home Screen web apps from Safari's 7-day storage cleanup; a Safari tab gets no such protection.

### GitHub Pages hosting

1. Sign in to GitHub (a free account works).
2. Create a public repository named `daybook`.
3. Upload the files in this folder: `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `jszip.min.js` and the `icons` folder.
4. Settings > Pages > Deploy from branch `main`, folder `/ (root)`.
5. The app is served at `https://<username>.github.io/daybook/`.

The code is public; journal entries never leave the phone.

## Keeping data safe

The journal exists only on the phone. Deleting the Home Screen icon deletes the journal. Back up from Settings > Back up now > Save to Files, into iCloud Drive or Google Drive. The timeline shows a reminder when the last backup is more than 14 days old.

## Updating the app

Change the files, bump `VERSION` in `sw.js`, and re-upload. The installed app shows "A new version is ready" the next time it has a network connection; tap Reload.

## Limits compared with a native app

- No Face ID (passcode only), no widgets, no Apple Watch, no automatic weather
- Daily reminders need a server for web push, so none are built in. An iOS Shortcuts personal automation (Time of Day > Open App or Open URL) is the workaround
- Very large Day One exports (several GB of photos) may exceed the memory Safari allows during import
