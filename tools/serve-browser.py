#!/usr/bin/env python3
"""Serve the browser distribution with optional cross-origin isolation headers."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class BrowserRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, cross_origin_isolation: bool = False, **kwargs):
        self.cross_origin_isolation = cross_origin_isolation
        super().__init__(*args, **kwargs)

    def end_headers(self) -> None:
        if self.cross_origin_isolation:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("build/web"))
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument(
        "--cross-origin-isolation",
        action="store_true",
        help="emit COOP/COEP/CORP headers for threaded WebAssembly builds",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    directory = args.directory.resolve()
    if not directory.is_dir():
        raise SystemExit(f"browser distribution directory does not exist: {directory}")
    handler = partial(
        BrowserRequestHandler,
        directory=str(directory),
        cross_origin_isolation=args.cross_origin_isolation,
    )
    server = ThreadingHTTPServer(("", args.port), handler)
    mode = "isolated" if args.cross_origin_isolation else "single-thread fallback"
    print(f"Serving {directory} on port {args.port} ({mode})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
