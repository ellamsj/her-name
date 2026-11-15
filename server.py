#!/usr/bin/env python3
"""Her Name — tiny zero-dependency server.

Serves ./public and stores anonymous answers to question 2 in a JSON file.
Only the second answer is ever sent here; the first answer never leaves the phone.

Env vars:
  PORT         port to listen on (default 8000)
  HOST         interface to bind (default 0.0.0.0 so phones on the same Wi-Fi can reach it)
  DATA_FILE    where answers are stored (default ./data/responses.json)
  ADMIN_TOKEN  enables /admin for removing inappropriate entries (disabled when unset)
"""
import json
import os
import re
import threading
import time
import unicodedata
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "public")
DATA_FILE = os.environ.get("DATA_FILE", os.path.join(HERE, "data", "responses.json"))
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
CATEGORIES = {"first", "married", "child", "other", "unsure"}
MAX_CHARS = 40
RATE_LIMIT = 6        # submissions…
RATE_WINDOW = 60      # …per this many seconds, per IP

_lock = threading.Lock()
_recent = {}


LOG_FILE = os.path.splitext(DATA_FILE)[0] + ".log.jsonl"


def _replay_log():
    """Rebuild every answer from the append-only log (used if the main file is missing or damaged)."""
    rows, removed = [], set()
    try:
        with open(LOG_FILE, encoding="utf-8") as f:
            for line in f:
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "removed" in ev:
                    removed.add(ev["removed"])
                elif "id" in ev:
                    rows.append(ev)
    except FileNotFoundError:
        pass
    return [r for r in rows if r["id"] not in removed]


def _load():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return _replay_log()


def _log(event):
    os.makedirs(os.path.dirname(LOG_FILE) or ".", exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def _save(rows):
    os.makedirs(os.path.dirname(DATA_FILE) or ".", exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA_FILE)


def _public(rows):
    return [{"id": r["id"], "text": r["text"], "category": r["category"]} for r in rows]


def clean_text(s):
    s = unicodedata.normalize("NFC", str(s or ""))
    # drop control/format chars but keep ZWJ/ZWNJ, which some scripts need
    s = "".join(ch for ch in s if ch in "‌‍" or not unicodedata.category(ch).startswith("C"))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:MAX_CHARS]


def api_list():
    with _lock:
        rows = _load()
    return 200, {"responses": _public(rows)}


def api_post(raw, ip):
    """Store one answer. Returns (status, body)."""
    try:
        data = json.loads(raw or b"{}")
        if not isinstance(data, dict):
            raise ValueError
    except (ValueError, json.JSONDecodeError):
        return 400, {"error": "bad request"}
    category = data.get("category")
    text = clean_text(data.get("text"))
    cid = re.sub(r"[^a-zA-Z0-9-]", "", str(data.get("cid", "")))[:64]
    if category not in CATEGORIES:
        return 400, {"error": "Choose the description that fits best."}
    if not text and category != "unsure":
        return 400, {"error": "Type what people call her, or choose “I’m not sure.”"}
    now = time.time()
    with _lock:
        hits = [t for t in _recent.get(ip, []) if now - t < RATE_WINDOW]
        rows = _load()
        existing = next((r for r in rows if cid and r.get("cid") == cid), None)
        if existing:  # a retry of the same submission
            return 200, {"id": existing["id"], "responses": _public(rows)}
        if len(hits) >= RATE_LIMIT:
            return 429, {"error": "Too many answers from this device. Try again in a minute."}
        hits.append(now)
        _recent[ip] = hits
        row = {"id": uuid.uuid4().hex[:12], "cid": cid, "text": text,
               "category": category, "t": int(now)}
        _log(row)          # durable first: the log is never rewritten
        rows.append(row)
        _save(rows)
    return 201, {"id": row["id"], "responses": _public(rows)}


def api_delete(path, token):
    m = re.fullmatch(r"/api/responses/([a-f0-9]{12})", path)
    if not m:
        return 404, {"error": "not found"}
    if not ADMIN_TOKEN or token != ADMIN_TOKEN:
        return 403, {"error": "forbidden"}
    with _lock:
        rows = _load()
        kept = [r for r in rows if r["id"] != m.group(1)]
        if len(kept) != len(rows):
            _log({"removed": m.group(1), "t": int(time.time())})
        _save(kept)
    return 200, {"removed": len(rows) - len(kept)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PUBLIC, **kw)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if not self.path.startswith("/fonts"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            super().log_message(fmt, *args)

    def _ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/responses":
            return self._json(*api_list())
        if path in ("/wall", "/wall/"):
            self.path = "/index.html"
        elif path in ("/admin", "/admin/"):
            self.path = "/admin.html"
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/responses":
            return self._json(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 4096)
        except ValueError:
            return self._json(400, {"error": "bad request"})
        return self._json(*api_post(self.rfile.read(length), self._ip()))

    def do_DELETE(self):
        return self._json(*api_delete(urlparse(self.path).path, self.headers.get("X-Admin-Token")))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Her Name → http://localhost:{port}   (shared screen: /wall · admin: /admin)")
    print(f"Answers stored in {DATA_FILE} (backup log: {LOG_FILE})")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
