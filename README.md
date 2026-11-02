# Little Utilities

A static collection of standalone HTML apps, hosted with GitHub Pages.

```text
index.html                         Landing page / app launcher
apps/
  Tapes.html                       Voice recording app
  productivity-tracker.html        Hour-by-hour productivity tracker
```

## Add an app

1. Create `apps/your-app.html`, with CSS and JavaScript inline.
2. Copy an `.app` link in `index.html` and update its URL, title, description, and icon.
3. Use relative URLs and match filename capitalization exactly.

No build step or backend is required. Serve the root locally with `python3 -m http.server 8000`, then open http://localhost:8000.

## Browser support

Microphone and folder access require HTTPS or localhost and browser permission. Folder access needs a Chromium browser with File System Access support, such as Chrome or Edge. Tapes loads its fonts from Google Fonts.

## Publishing

GitHub Pages serves the repository root from `main`. The site root opens the launcher, which links to both apps.
