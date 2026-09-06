"""Serve the project and watch assets/inbox for dropped photos."""

from __future__ import annotations

import functools
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_inbox import process_online_photo, watch_forever  # noqa: E402

PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/assets/replace.json" or path.endswith("/replace.json"):
            self.send_header("Cache-Control", "no-store")
        elif path.endswith((".html", ".css", ".js", "/")) or path in ("", "/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/online-photo":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 12_000_000:
            self.send_error(400, "invalid photo")
            return
        data = self.rfile.read(length)
        try:
            event = process_online_photo(data)
        except Exception as exc:
            payload = json.dumps({"error": str(exc)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        payload = json.dumps(event).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


def main() -> None:
    watcher = threading.Thread(target=watch_forever, daemon=True)
    watcher.start()
    handler = functools.partial(Handler, directory=str(ROOT))
    server = ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    print(f"serving {ROOT} at http://127.0.0.1:{PORT}/", flush=True)
    print(f"drop photos in {ROOT / 'assets' / 'inbox'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)


if __name__ == "__main__":
    main()
