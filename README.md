# Her Name

A mobile-first typography microsite for the exhibition. No build step, no dependencies: one Python file and four static files.

```
server.py          serves /public and stores answers to question 2
wsgi.py            the same site for WSGI hosts (PythonAnywhere)
public/index.html  the experience (also the shared screen at /wall)
public/app.js      flow, full-screen moment, the flower, toggle
public/styles.css  type, paper, grid
public/admin.html  remove an inappropriate entry (needs ADMIN_TOKEN)
data/              answers + append-only backup log (created automatically, git-ignored)
```

## Run it locally

```bash
python3 server.py
```

Open http://localhost:8000. To try it on your phone, connect it to the same Wi-Fi and open `http://<your-mac's-IP>:8000`. Find the IP with:

```bash
ipconfig getifaddr en0
```

Shared screen / projector: `http://localhost:8000/wall` — results panel on the left, the flower on the right, refreshes every 20 s.

## The flower

A carnation (the flower children give parents on Korean Parents' Day), shown as a halftone of cream dots on a fixed grid, over a dark, out-of-focus field of drifting light with film grain. The picture moves underneath the grid — it zooms, turns, breathes and opens — so each dot only grows, shrinks or appears in place, like a halftone of moving footage. During the big movement, edges sweeping across the grid leave a short warm trail; a few marks twinkle as small crosses.

The carnation is painted procedurally in `public/app.js` (`drawCarnation`) at 16 stages from bud to full bloom, then sampled: darker areas of the painting get larger dots.

The visit runs in four beats:

1. The questions appear alone on the dark page.
2. Once both are answered they dissolve (fade and blur) while the flower, already standing large behind them as a closed bud, opens — upright, without turning (about 7.2 s, `ARRIVE_MS`).
3. The answers are set inside the flower in tiny Cormorant Garamond, small enough to read as a pattern, replacing the dots they cover; each word resolves out of a scramble of marks, growing from the stem up into the bloom. Hover or tap to read one.
4. Small uppercase notes appear around the flower, like captions on a poster: the result, the question “Who gets to call her by her name?”, the invitation to the wall, and the count. The dots and words make room for them. “Her own name” turns the first names warm and dims everything else.

The open flower keeps breathing; a loupe magnifies it under the mouse; a tap sends a ripple through the dots and reads the nearest word in a callout.

## Data accumulates

The flower starts empty: every word in it comes from a real visitor. Nothing is seeded, nothing resets, and the server never clears answers. Restarting or redeploying keeps them as long as the `data/` folder (or `DATA_FILE`) lives on a persistent disk.

- `data/responses.json` holds the current answers.
- `data/responses.log.jsonl` is an append-only backup: every answer is written there first and the file is never rewritten. If `responses.json` is ever missing or damaged, the server rebuilds everything from the log automatically.
- Back up both files after the exhibition. Don't delete them unless you mean to erase every answer.

## What is stored

Only the answer to “What do other people usually call her?” and the category the student chose. The first answer never leaves the phone. No names, IPs or timestamps are shown; IPs are held in memory for rate limiting only (6 answers per minute per device).

## Moderation

Set a token when you start the server, then visit `/admin`:

```bash
ADMIN_TOKEN=pick-something-long python3 server.py
```

## Deploy for the exhibition

The site needs one always-on Python process and **a disk that survives restarts**. Hosts with ephemeral disks (Render free, Heroku, Vercel) will wipe the answers on every redeploy or sleep. No packages to install on any host.

### Option A — PythonAnywhere (free, no card, files persist)

1. Sign up at pythonanywhere.com (a free "Beginner" account). Your site will be `https://<username>.pythonanywhere.com`.
2. **Files** tab → upload this folder's contents (`server.py`, `wsgi.py`, `public/`) into `/home/<username>/her-name/`. Don't upload `data/` unless you want to carry over answers you collected locally.
3. **Web** tab → *Add a new web app* → *Manual configuration* → any Python 3 version.
4. On that page, open the *WSGI configuration file* link, delete everything in it and paste:

   ```python
   import os, sys
   path = "/home/<username>/her-name"
   sys.path.insert(0, path)
   os.environ["DATA_FILE"] = path + "/data/responses.json"
   os.environ["ADMIN_TOKEN"] = "pick-something-long"
   from wsgi import application
   ```

5. Back on the **Web** tab, turn on *Force HTTPS* and press *Reload*. Done.

Free web apps must be re-confirmed every 3 months (one button on the Web tab); answers are kept either way.

### Option B — Railway or Fly.io (paid, a few dollars a month)

Deploy from the folder (the `Procfile` runs `python3 server.py`, which reads `$PORT`). Attach a volume and set `DATA_FILE=/data/responses.json` (use the volume's mount path) and `ADMIN_TOKEN`.

### Before the show

Make the QR code point to the root URL (HTTPS). Test with two phones: answer on one, watch the word arrive on the other within ~20 seconds.

## Accessibility notes

- Every step works with a keyboard; focus moves to each new question.
- `prefers-reduced-motion` removes the stippling-in, ripples and sweep; content still appears.
- Korean uses Noto Serif KR / Noto Sans KR with `word-break: keep-all`, and Hangul/CJK are never fake-italicized. Other scripts fall back to system fonts; each answer uses `dir="auto"` so right-to-left names render correctly.
