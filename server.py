#!/usr/bin/env python3
"""Local server for Gallery App.

Serves the current directory like ``python3 -m http.server``, and also accepts
PUT requests that write ``.gallapp_likes`` or ``.gallapp_position`` inside an
image folder. It listens on localhost only.
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

WRITABLE = {".gallapp_likes", ".gallapp_position"}
MAX_BYTES = 1_000_000


def _valid_name(name):
    return bool(name) and name not in (".", "..") and "/" not in name and "\\" not in name and "\x00" not in name


class GalleryHandler(SimpleHTTPRequestHandler):
    def do_PUT(self):
        rel = unquote(self.path.split("?", 1)[0]).lstrip("/")
        base = os.path.basename(rel)
        if base not in WRITABLE:
            self.send_error(405, "Only .gallapp_likes and .gallapp_position can be written")
            return

        root = os.path.realpath(os.getcwd())
        dest = os.path.realpath(os.path.join(root, rel))
        try:
            inside = os.path.commonpath([root, dest]) == root
        except ValueError:
            inside = False
        if not inside or os.path.basename(dest) != base:
            self.send_error(403, "Path is outside the server root")
            return

        parent = os.path.dirname(dest)
        if not os.path.isdir(parent):
            self.send_error(404, "Directory not found")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400, "Bad Content-Length")
            return
        if length < 0 or length > MAX_BYTES:
            self.send_error(413, "Payload is too large")
            return

        raw = self.rfile.read(length) if length else b""
        try:
            text = raw.decode("utf-8")
        except UnicodeError:
            self.send_error(400, "Payload must be UTF-8")
            return

        names = []
        for line in text.splitlines():
            name = line.strip()
            if not name or name.startswith("#"):
                continue
            if not _valid_name(name):
                self.send_error(400, "Invalid image name: " + name)
                return
            names.append(name)

        if base == ".gallapp_position":
            if len(names) > 1:
                self.send_error(400, ".gallapp_position accepts at most one filename")
                return
            body = (names[0] + "\n").encode("utf-8") if names else b""
        else:
            body = ("\n".join(names) + ("\n" if names else "")).encode("utf-8")

        tmp = dest + ".tmp"
        try:
            with open(tmp, "wb") as handle:
                handle.write(body)
            os.replace(tmp, dest)
        except OSError as err:
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_error(500, str(err))
            return

        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()


def main():
    port = 8000
    bind = "127.0.0.1"
    args = sys.argv[1:]
    if args[:1] == ["--bind"]:
        if len(args) < 2:
            sys.exit("usage: python3 gallapp/server.py [--bind HOST] [PORT]")
        bind = args[1]
        args = args[2:]
    if args:
        try:
            port = int(args[0])
        except ValueError:
            sys.exit("PORT must be an integer")

    server = ThreadingHTTPServer((bind, port), GalleryHandler)
    print("Gallery App serving %s at http://%s:%s/gallapp/" % (os.getcwd(), bind, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
