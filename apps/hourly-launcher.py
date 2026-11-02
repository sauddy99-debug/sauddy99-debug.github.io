"""Loopback-only launcher for Hourly and its adjacent CSV folder; Python 3 stdlib."""
import argparse
import hmac
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
import webbrowser

APP_FILE = Path(__file__).with_name("productivity-tracker.html")
MAX_BYTES = 2 * 1024 * 1024


class FolderError(Exception):
    def __init__(self, message, code="Error", status=400):
        super().__init__(message)
        self.code, self.status = code, status


class HourlyServer(ThreadingHTTPServer):
    def __init__(self, app_file=APP_FILE, port=8768):
        self.app_file = Path(app_file).resolve(strict=True)
        self.folder = self.app_file.parent
        self.token = secrets.token_urlsafe(32)
        self.folder_lock = threading.Lock()
        super().__init__(("127.0.0.1", port), HourlyHandler)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server_port}"

    def csv_path(self, name):
        if (not isinstance(name, str) or not name or name in (".", "..")
                or "/" in name or "\\" in name or "\x00" in name
                or not name.lower().endswith(".csv")):
            raise FolderError("Choose a CSV filename in the app folder.")
        path = self.folder / name
        if path.is_symlink():
            raise FolderError("CSV links outside the app folder are not supported.")
        if path.exists() and not path.is_file():
            raise FolderError("That name is not a regular CSV file.")
        return path

    def read_csv(self, path):
        if not path.exists():
            raise FolderError("CSV file was not found.", "NotFoundError", 404)
        if path.stat().st_size > MAX_BYTES:
            raise FolderError("Choose a CSV smaller than 2 MB.")
        return path.read_bytes().decode("utf-8")


class HourlyHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def check_request(self, api=False):
        if self.headers.get("Host") != urlsplit(self.server.origin).netloc:
            raise FolderError("Invalid local server host.", status=403)
        origin = self.headers.get("Origin")
        if origin and origin != self.server.origin:
            raise FolderError("Requests must come from Hourly.", status=403)
        if api and not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.token):
            raise FolderError("Reopen Hourly through its local launcher.", status=403)

    def do_GET(self):
        try:
            self.check_request()
            url = urlsplit(self.path)
            if url.path in ("/", "/productivity-tracker.html"):
                config = json.dumps({"apiBase": "/__hourly_api__/", "token": self.server.token,
                                     "folderName": self.server.folder.name}).replace("<", "\\u003c")
                source = self.server.app_file.read_text(encoding="utf-8")
                source = source.replace("<script>", '<script type="application/json" id="hourly-local-config">' + config + '</script>\n<script>', 1)
                return self.respond(200, source.encode("utf-8"), "text/html; charset=utf-8")
            self.check_request(api=True)
            if url.path == "/__hourly_api__/files":
                names = sorted(p.name for p in self.server.folder.iterdir()
                               if p.suffix.lower() == ".csv" and p.is_file() and not p.is_symlink())
                return self.respond(200, {"files": names})
            if url.path == "/__hourly_api__/file":
                path = self.server.csv_path(parse_qs(url.query).get("name", [""])[0])
                return self.respond(200, {"text": self.server.read_csv(path)})
            raise FolderError("Not found.", "NotFoundError", 404)
        except FolderError as error:
            self.respond(error.status, {"error": str(error), "code": error.code})
        except (OSError, UnicodeError) as error:
            self.respond(400, {"error": str(error), "code": "Error"})

    def do_POST(self):
        temp_name = None
        try:
            self.check_request(api=True)
            if urlsplit(self.path).path != "/__hourly_api__/file":
                raise FolderError("Not found.", "NotFoundError", 404)
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BYTES * 2:
                raise FolderError("CSV request is too large or empty.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or "expected" not in payload:
                raise FolderError("Save request must include the previous file contents.")
            path = self.server.csv_path(payload.get("name"))
            text, expected = payload.get("text"), payload["expected"]
            if not isinstance(text, str) or (expected is not None and not isinstance(expected, str)):
                raise FolderError("Invalid CSV save request.")
            data = text.encode("utf-8")
            if len(data) > MAX_BYTES:
                raise FolderError("Choose a CSV smaller than 2 MB.")
            with self.server.folder_lock:
                # Check again under the lock so two Hourly tabs cannot silently overwrite each other.
                path = self.server.csv_path(payload["name"])
                actual = self.server.read_csv(path) if path.exists() else None
                if actual != expected:
                    raise FolderError("The CSV changed outside this page. Export your unsaved ratings before reopening it.", "ConflictError", 409)
                with tempfile.NamedTemporaryFile(dir=self.server.folder, prefix=".hourly-", suffix=".tmp", delete=False) as temp:
                    temp_name = temp.name
                    temp.write(data)
                    temp.flush()
                    os.fsync(temp.fileno())
                os.replace(temp_name, path)
                temp_name = None
            self.respond(200, {"saved": True})
        except FolderError as error:
            self.respond(error.status, {"error": str(error), "code": error.code})
        except (OSError, ValueError, UnicodeError) as error:
            self.respond(400, {"error": str(error), "code": "Error"})
        finally:
            if temp_name:
                Path(temp_name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Open Hourly with automatic access to CSVs beside its HTML.")
    parser.add_argument("--port", type=int, default=8768)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    try:
        server = HourlyServer(port=args.port)
    except OSError as error:
        parser.exit(1, f"Could not start Hourly: {error}\nIf a launcher is already running, open http://127.0.0.1:{args.port}/ or stop it first.\n")
    with server:
        print(f"Hourly is running at {server.origin}/\nDefault CSV folder: {server.folder}\nKeep this window open; Ctrl+C stops Hourly.", flush=True)
        if not args.no_open:
            webbrowser.open(server.origin + "/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
