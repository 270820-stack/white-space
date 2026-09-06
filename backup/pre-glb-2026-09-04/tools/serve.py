"""Serve the project and watch assets/inbox for dropped photos."""

from __future__ import annotations

import functools
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_inbox import watch_forever  # noqa: E402

PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/assets/replace.json" or path.endswith("/replace.json"):
            self.send_header("Cache-Control", "no-store")
        elif path.endswith((".html", ".css", ".js", "/")) or path in ("", "/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

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
