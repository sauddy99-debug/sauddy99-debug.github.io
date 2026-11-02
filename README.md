# Little Utilities

A static collection of standalone HTML apps, hosted with GitHub Pages.

```text
index.html                         Landing page / app launcher
apps/
  Tapes.html                       Voice recording app
  productivity-tracker.html        Hourly productivity tracker
  hourly-launcher.py               Optional local CSV-folder launcher
  Launch Hourly.command            macOS launcher (requires Python 3)
```

## Add an app

1. Create `apps/your-app.html`, with CSS and JavaScript inline.
2. Copy an `.app` link in `index.html` and update its URL, title, description, and icon.
3. Use relative URLs and match filename capitalization exactly.

No build step or backend is required. Serve the root locally with `python3 -m http.server 8000`, then open http://localhost:8000.

## Hourly

Hourly tracks 10 dates from 6 AM to 2 AM the following morning, with ratings of
0–5, 100 possible points per day, and 1,000 per challenge. After-midnight hours
belong to the preceding tracking date. Hour and Max labels follow the highlighted
score rows. Max is the best recorded running total across the dates in that row.

The running daily average uses only fully rated days whose final hour has ended.
Partial days are excluded, zero-point completed days are included, and decimal
averages are rounded down. For example, completed totals 50, 60, 70, 80 yield 65;
the fifth day is included once its 1–2 AM rating completes the day.

For **automatic startup using CSVs beside the HTML**, double-click
`apps/Launch Hourly.command` on macOS, or run:

```sh
python3 apps/hourly-launcher.py
```

The launcher binds only to `127.0.0.1:8768`, opens Hourly, and uses the folder
containing `productivity-tracker.html` as the default. Keep its terminal open.
Move the launcher script and command alongside the HTML if moving the app.
On an empty folder, it creates a blank challenge; otherwise it opens the latest
valid CSV by its stored challenge creation timestamp. Existing challenges are
preserved. Select folder switches to another folder, and Use app folder returns
to the default. Restarting the launcher uses the app folder again.

When opened directly or on GitHub Pages, the HTML stays standalone. Browsers
require permission before reading local folders, so choose a folder on the first
visit. Hourly remembers it and resumes automatically when permission remains
granted; otherwise Reconnect folder asks for permission again. A hosted site
cannot scan the directory containing its deployed HTML for local CSVs.

Click Enable sound / Test beep once after automatic startup. Browsers can block
audio until user interaction. Hourly beeps repeat at five-minute marks while
completed hours remain unrated. Keep the app open and computer awake; background
tabs may delay alarms. CSVs save after every rating, with recovery/export on
failure. The local launcher checks previous contents before replacing a file to
avoid overwriting external edits. End challenge & start new preserves the old CSV.

Checks: `node --test tests/productivity.test.cjs`, `python3 tests/launcher_test.py`,
and the Playwright scripts `tests/browser-check.cjs` and `tests/helper-browser.cjs`.

## Browser support

Microphone and folder access require HTTPS or localhost and browser permission. Folder access needs a Chromium browser with File System Access support, such as Chrome or Edge. Tapes loads its fonts from Google Fonts.

## Publishing

GitHub Pages serves the repository root from `main`. The site root opens the launcher, which links to both apps.
