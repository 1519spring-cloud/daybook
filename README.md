# Daybook: an offline journal for iPhone and Mac

Built 2026-09-23. A Progressive Web App (PWA): install it once from Safari, and it runs from the Home Screen (iPhone) or the Dock (Mac) with no network. Entries and photos live only on the device that holds them (IndexedDB). No account, no server, no tracking. Since version 1.3.0, a sync file carries entries between the iPhone and the Mac.

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
- Photos inline with the text, like Day One: add a photo and it lands where the cursor is, so an entry can run text, photo, text, photo
- Photos grid; photos shrink to 2048 px JPEG on import to save space
- Map tab: every placed photo and entry on a map, joined by a dashed route in time order, with total miles. Tap a photo marker to see it with its caption and open the entry. Filter by tag. Needs a connection for the map itself (OpenFreeMap tiles); offline it shows a sketch of the route
- Photo places: a photo that carries GPS keeps it; iPhone strips GPS from photos added through a web page, so a photo taken in the last 30 minutes is placed where the phone is (Settings can turn this off); any photo can be placed or moved from the pin on the photo in the editor
- Share a trip: pick a journal, tag and dates, and Daybook builds one web page file with the entries in order, photos inline and a map with the route. It opens in any browser; in a preview that doesn't run scripts, the route shows as a sketch. Moods, tags and stars are left out
- Full-text search across text, tags and place names; filter by tag or star
- Markdown formatting: headings, bold, italic, lists, quotes, links
- Mood (5 levels), tags, star, location (GPS works offline; name a place once and nearby entries reuse the name)
- Multiple journals
- 26 writing prompts and 4 templates (daily review, gratitude, trip day, meeting notes)
- Autosave while typing
- Recently Deleted, kept 30 days
- 4-digit passcode with auto-lock (privacy screen; not encryption)
- Backup: a .zip in Day One's export format (JSON plus photos folder named by MD5). Restores into Daybook; should also import into Day One (not tested against Day One itself)
- Import: Daybook backups, Day One .zip exports and Day One .json files. Day One photos keep their place in the text; Day One video, audio and PDF items are skipped
- Markdown export of every entry
- Reminder banner when the last backup is more than 14 days old
- Light and dark mode
- Mac layout (any window 820 px or wider): sidebar in place of the bottom tabs, a centered reading column, and the editor, reader and Settings as panels over the journal
- Mac keyboard: N new entry, / search, E edit the open entry, Esc close (the editor saves as it closes), Cmd+Return or Cmd+S finish an entry, digits and Delete on the passcode screen
- Mac photos: drag photos from Finder or Photos onto an entry, or paste one, as well as the Photo button
- Sync with your other device (Settings): see below

## What was tested (Chromium, iPhone-sized viewport)

Version 1.3.0 (2026-09-26, Mac and sync), in Chromium with an iPhone profile and a Mac profile side by side: a first sync of everything from the phone to the Mac, photos included; then edits, a new entry with a photo, a move to Recently Deleted and a permanent delete on the Mac, while the phone edited the same entry and added one of its own; the Mac's changes into the phone (both versions of the doubly edited entry kept, one tagged #sync-conflict; the deletion and the permanent delete carried over); the phone's changes back to the Mac, after which both held the same entries; opening the same sync file twice changes nothing; every referenced photo present on both. Mac layout on every tab; N, /, E, Esc, Cmd+Return, typing the passcode; dragging and pasting a photo into an entry; an offline reload on the Mac. The phone layout is unchanged. Not tested in Safari on a real Mac or iPhone, and AirDrop of the sync file was not tested.

Create, edit, photo, mood, tags, location, star, backdated entry, On This Day, calendar, search, photos grid, passcode set and unlock, full reload with the network off (app shell and entries load from cache), backup and restore into a clean browser, re-import skipping unchanged entries, Day One JSON import (escaped punctuation, place name, weather). MD5 matches the standard test vectors. Version 1.2.0 (2026-09-26, map and sharing): GPS read from photo EXIF (north/south and east/west), a fresh photo placed at the phone's position, naming and removing photo places, the live map with markers, route and popups, the offline route sketch, the share form and page (live map, photos, anchors) and the same page with scripts off, and photo places surviving backup and restore. Version 1.1.0 (2026-09-25, inline photos): photo placement at the cursor, removing a photo, reader order, entries made in 1.0.0 (photos shown after the text), search ignoring photo markers, backup and restore keeping order, Day One import keeping order, the update from 1.0.0 to 1.1.0 and an offline reload afterward. Not tested on a physical iPhone.

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

## Using Daybook on a Mac

1. Open the same address (https://1519spring-cloud.github.io/daybook/) in Safari on the Mac.
2. Click the Share button in the toolbar and choose Add to Dock (older macOS: File > Add to Dock). Always open Daybook from the Dock, not a Safari tab; the two may not share a journal. Daybook opens in its own window and works with no network. Chrome also works: use the install icon at the right end of the address bar. Chrome cannot read HEIC photos; Safari can.
3. The Mac's Daybook is a separate copy of the journal. It starts empty. To fill it, send a sync file from the iPhone (next section).

## Sync between the iPhone and the Mac

Each device keeps its own journal. A sync file carries the changes from one to the other. There is no server and no account; the file goes only where you send it.

1. On the device you wrote on: Settings > Send changes. The first time, it sends everything. After that, it sends only what changed since the last send: new entries, edits, photos, moves to Recently Deleted, and permanent deletions.
2. Send the file with AirDrop (or save it to iCloud Drive or Google Drive).
3. On the other device: Settings > Open a sync file, and pick it. On iPhone, an AirDropped file is in Files > Downloads.
4. When you switch back, send the other way.

If the same entry was changed on both devices between syncs, both versions are kept. The newer one keeps its place; the other is saved as its own entry tagged #sync-conflict. Delete whichever you don't want. Send everything (in Settings, after the first send) rebuilds the other device's copy if a sync file went missing.

Rules the sync follows:
- An entry received in a sync file is not sent back.
- An entry edited on one device and deleted on the other: whichever happened later wins. A deletion goes to Recently Deleted, so it can be restored for 30 days.
- A journal renamed on one device is renamed on the other.
- The device clocks decide which change is newer.

## Keeping data safe

The journal exists only on the device. Deleting the Home Screen icon deletes the phone's journal. On a Mac, whether the Dock app's journal is protected from Safari's storage cleanup is not confirmed; Settings shows "Protected from cleanup" for the device in use. A copy synced to the other device is a second copy, but keep taking backups. Back up from Settings > Back up now > Save to Files, into iCloud Drive or Google Drive. The timeline shows a reminder when the last backup is more than 14 days old.

## Updating the app

Change the files, bump `VERSION` in `sw.js`, and re-upload. The installed app shows "A new version is ready" the next time it opens or comes back to the screen with a network connection (from 1.3.1 on; earlier versions only checked when relaunched); tap Reload. GitHub may serve the old files for up to 10 minutes after an upload. From 1.3.2 on, the notice floats above every tab and panel, the app asks GitHub for the update file directly instead of a copy the phone kept, and a new version fetches all of its files fresh. Do this on each device. Update both devices before syncing between them: a device on a version before 1.3.0 has no sync.

## Limits compared with a native app

- No Face ID (passcode only), no widgets, no Apple Watch, no automatic weather
- Daily reminders need a server for web push, so none are built in. An iOS Shortcuts personal automation (Time of Day > Open App or Open URL) is the workaround
- Very large Day One exports (several GB of photos) may exceed the memory Safari allows during import
