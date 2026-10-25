#!/usr/bin/env python3
"""Local server for Gallery App.

Serves the current directory like ``python3 -m http.server``, and also accepts
PUT requests that write gallery sidecars inside an image folder:

- ``.gallapp_likes`` / ``.gallapp_position`` (default session)
- ``.gallapp_multi`` (multi-class classifications: ``name<TAB>class``)
- ``.gallapp_classes`` (class labels: ``slot<TAB>name<TAB>glyph``)
- session variants: ``.gallapp_likes_<session>``, ``.gallapp_position_<session>``,
  ``.gallapp_multi_<session>``

It listens on localhost only.
"""

import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

DEFAULT_WRITABLE = {
    ".gallapp_likes",
    ".gallapp_position",
    ".gallapp_multi",
    ".gallapp_classes",
}
# Session names: letters, digits, underscore, hyphen (1–40 chars).
SESSION_FILE_RE = re.compile(
    r"^\.gallapp_(likes|position|multi)_([A-Za-z0-9_-]{1,40})$"
)
MAX_BYTES = 1_000_000
CLASS_RE = re.compile(r"^[1-9]$")
CLASS_SLOT_RE = re.compile(r"^[1-9]$")
CLASS_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
CLASS_GLYPH_RE = re.compile(r"^[A-Za-z0-9]$")


def _valid_name(name):
    return (
        bool(name)
        and name not in (".", "..")
        and "/" not in name
        and "\\" not in name
        and "\x00" not in name
        and "\t" not in name
    )


def _writable_base(base):
    if base in DEFAULT_WRITABLE:
        return True
    return bool(SESSION_FILE_RE.match(base))


def _kind(base):
    if base == ".gallapp_classes":
        return "classes"
    if "position" in base:
        return "position"
    if "multi" in base:
        return "multi"
    return "likes"


class GalleryHandler(SimpleHTTPRequestHandler):
    def do_PUT(self):
        rel = unquote(self.path.split("?", 1)[0]).lstrip("/")
        base = os.path.basename(rel)
        if not _writable_base(base):
            self.send_error(
                405,
                "Only .gallapp_likes / .gallapp_position / .gallapp_multi / "
                ".gallapp_classes (and session variants) can be written",
            )
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

        kind = _kind(base)
        if kind == "classes":
            # slot<TAB>name<TAB>glyph  (slot 1–9, one-word name, one-char glyph)
            rows = []
            seen_slots = set()
            for line in text.splitlines():
                raw_line = line.strip()
                if not raw_line or raw_line.startswith("#"):
                    continue
                parts = raw_line.split("\t")
                if len(parts) != 3:
                    self.send_error(
                        400,
                        "Class lines must be slot<TAB>name<TAB>glyph: " + raw_line,
                    )
                    return
                slot, name, glyph = (p.strip() for p in parts)
                if not CLASS_SLOT_RE.match(slot):
                    self.send_error(400, "Class slot must be 1–9: " + slot)
                    return
                if slot in seen_slots:
                    self.send_error(400, "Duplicate class slot: " + slot)
                    return
                if not CLASS_NAME_RE.match(name):
                    self.send_error(
                        400,
                        "Class name must be one word (letters, digits, _-): " + name,
                    )
                    return
                if not CLASS_GLYPH_RE.match(glyph):
                    self.send_error(
                        400,
                        "Class glyph must be a single letter or digit: " + glyph,
                    )
                    return
                seen_slots.add(slot)
                rows.append("%s\t%s\t%s" % (slot, name, glyph))
            rows.sort(key=lambda row: int(row.split("\t", 1)[0]))
            body = ("\n".join(rows) + ("\n" if rows else "")).encode("utf-8")
        elif kind == "multi":
            # filename<TAB>class or filename<TAB>1,3,5 (several classes per image)
            by_name = {}
            for line in text.splitlines():
                raw_line = line.strip()
                if not raw_line or raw_line.startswith("#"):
                    continue
                if "\t" not in raw_line:
                    self.send_error(
                        400,
                        "Multi lines must be filename<TAB>class[,class…]: "
                        + raw_line,
                    )
                    return
                name, klass_field = raw_line.split("\t", 1)
                name = name.strip()
                if not _valid_name(name):
                    self.send_error(400, "Invalid image name: " + name)
                    return
                classes = []
                seen = set()
                for part in klass_field.replace(" ", ",").split(","):
                    klass = part.strip()
                    if not klass:
                        continue
                    if not CLASS_RE.match(klass):
                        self.send_error(
                            400,
                            "Class must be an integer 1–9: " + klass,
                        )
                        return
                    if klass not in seen:
                        seen.add(klass)
                        classes.append(int(klass))
                if not classes:
                    self.send_error(
                        400,
                        "Multi lines need at least one class: " + raw_line,
                    )
                    return
                bucket = by_name.setdefault(name, set())
                bucket.update(classes)
            rows = []
            for name in sorted(by_name):
                classes = sorted(by_name[name])
                rows.append(name + "\t" + ",".join(str(c) for c in classes))
            body = ("\n".join(rows) + ("\n" if rows else "")).encode("utf-8")
        else:
            names = []
            for line in text.splitlines():
                name = line.strip()
                if not name or name.startswith("#"):
                    continue
                if not _valid_name(name):
                    self.send_error(400, "Invalid image name: " + name)
                    return
                names.append(name)

            if kind == "position":
                if len(names) > 1:
                    self.send_error(400, "Position file accepts at most one filename")
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
