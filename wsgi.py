"""WSGI entry point, for hosts that run Python web apps through WSGI (e.g. PythonAnywhere).

Same behaviour as server.py: serves ./public and the /api/responses endpoints,
storing answers in DATA_FILE (default ./data/responses.json).
"""
import json
import mimetypes
import os

import server

ROUTES = {"/": "index.html", "/wall": "index.html", "/wall/": "index.html",
          "/admin": "admin.html", "/admin/": "admin.html"}
HEADERS = [("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer")]
REASONS = {200: "OK", 201: "Created", 400: "Bad Request", 403: "Forbidden",
           404: "Not Found", 405: "Method Not Allowed", 429: "Too Many Requests"}


def _json(start, code, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    start(f"{code} {REASONS.get(code, '')}", HEADERS + [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(body))), ("Cache-Control", "no-cache")])
    return [body]


def application(environ, start):
    path = environ.get("PATH_INFO", "/") or "/"
    method = environ.get("REQUEST_METHOD", "GET")

    if path == "/api/responses":
        if method == "GET":
            return _json(start, *server.api_list())
        if method == "POST":
            try:
                n = min(int(environ.get("CONTENT_LENGTH") or 0), 4096)
            except ValueError:
                return _json(start, 400, {"error": "bad request"})
            fwd = environ.get("HTTP_X_FORWARDED_FOR", "")
            ip = fwd.split(",")[0].strip() if fwd else environ.get("REMOTE_ADDR", "")
            return _json(start, *server.api_post(environ["wsgi.input"].read(n), ip))
        return _json(start, 405, {"error": "method not allowed"})
    if path.startswith("/api/responses/") and method == "DELETE":
        return _json(start, *server.api_delete(path, environ.get("HTTP_X_ADMIN_TOKEN")))

    # static files from ./public
    rel = ROUTES.get(path, path.lstrip("/"))
    full = os.path.realpath(os.path.join(server.PUBLIC, rel))
    if not full.startswith(os.path.realpath(server.PUBLIC) + os.sep) or not os.path.isfile(full):
        return _json(start, 404, {"error": "not found"})
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
        ctype += "; charset=utf-8"
    with open(full, "rb") as f:
        body = f.read()
    start("200 OK", HEADERS + [("Content-Type", ctype), ("Content-Length", str(len(body))),
                               ("Cache-Control", "no-cache")])
    return [body]
