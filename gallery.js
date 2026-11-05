(function (root) {
  "use strict";

  var IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif)$/i;
  // Letters, digits, _ and - only; no spaces or other punctuation.
  var SESSION_NAME_RE = /^[A-Za-z0-9_-]+$/;
  var SESSION_NAME_MAX = 40;
  var CLASS_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
  var CLASS_GLYPH_RE = /^[A-Za-z0-9]$/;
  var MAX_CLASS = 9;
  var CLASS_COLORS = {
    1: "#0969da",
    2: "#1a7f37",
    3: "#bf8700",
    4: "#cf222e",
    5: "#8250df",
    6: "#0550ae",
    7: "#e16f24",
    8: "#a40e26",
    9: "#0a3069",
  };
  var RECENT_KEY = "gallapp-recent-dirs";
  var CRC_TABLE = makeCrcTable();

  function makeCrcTable() {
    var table = new Uint32Array(256);
    var n, c, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  function crc32(bytes) {
    var crc = 0xffffffff;
    var i;
    for (i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concatBytes(chunks) {
    var total = 0;
    var i, out, offset;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    out = new Uint8Array(total);
    offset = 0;
    for (i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  function dosDateTime(date) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function safeZipName(name, used) {
    var base = String(name || "image").replace(/[\\/]/g, "_").replace(/^\.+/, "");
    var candidate = base || "image";
    var n = 2;
    var dot;
    while (used[candidate]) {
      dot = base.lastIndexOf(".");
      candidate = dot > 0 ? base.slice(0, dot) + "-" + n + base.slice(dot) : base + "-" + n;
      n += 1;
    }
    used[candidate] = true;
    return candidate;
  }

  /**
   * ZIP of already-compressed images. Method 0 (store) keeps PNG/JPEG intact
   * and needs no compression library.
   */
  function buildStoredZip(files) {
    var used = {};
    var locals = [];
    var centrals = [];
    var offset = 0;
    var now = dosDateTime(new Date());
    var encoder = new TextEncoder();
    var centralSize = 0;
    var centralStart;
    var eocd;
    var ev;

    if (files.length > 0xffff) {
      throw new Error("Too many files for a classic zip.");
    }

    files.forEach(function (file) {
      var nameBytes = encoder.encode(safeZipName(file.name, used));
      var data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
      var crc;
      var local;
      var view;
      var central;
      var cv;
      if (data.length > 0xffffffff || nameBytes.length > 0xffff) {
        throw new Error("A file is too large for the zip: " + file.name);
      }
      crc = crc32(data);
      local = new Uint8Array(30 + nameBytes.length);
      view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, now.time, true);
      view.setUint16(12, now.date, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      central = new Uint8Array(46 + nameBytes.length);
      cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      if (offset + local.length + data.length > 0xffffffff) {
        throw new Error("The zip exceeds the 4 GB limit.");
      }
      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    });

    centralStart = offset;
    centrals.forEach(function (part) {
      centralSize += part.length;
    });
    eocd = new Uint8Array(22);
    ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);
    return concatBytes(locals.concat(centrals, [eocd]));
  }

  /**
   * Directory path relative to the HTTP server root.
   * Returns "" when empty, or null when the path walks upward.
   */
  function normalizeDir(raw) {
    var text = String(raw || "").trim();
    var parts = [];
    var segs, i, seg;
    if (/^https?:\/\//i.test(text)) {
      try {
        var url = new URL(text);
        text = url.searchParams.get("dir") || url.pathname;
      } catch (err) {
        return null;
      }
    }
    text = text.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!text) return "";
    segs = text.split("/");
    for (i = 0; i < segs.length; i++) {
      seg = segs[i];
      if (!seg || seg === ".") continue;
      try {
        seg = decodeURIComponent(seg);
      } catch (err) {
        return null;
      }
      if (!seg || seg === "." ) continue;
      if (seg === ".." || seg.indexOf("\0") !== -1 || seg.indexOf("/") !== -1) return null;
      parts.push(seg);
    }
    return parts.join("/");
  }

  function decodeHtml(value) {
    return String(value)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function imagesFromListing(html, baseUrl) {
    var base = new URL(baseUrl);
    var hrefs = [];
    var re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    var match;
    var images = [];
    var seen = {};
    if (!base.pathname.endsWith("/")) {
      base = new URL(base.pathname + "/", base);
    }
    while ((match = re.exec(String(html)))) {
      hrefs.push(decodeHtml(match[1] != null ? match[1] : match[2]));
    }
    hrefs.forEach(function (href) {
      var pathOnly, segs, i, seg, resolved, rest, name;
      if (!href || href.charAt(0) === "#" || href.charAt(0) === "?") return;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
      pathOnly = href.split("?")[0].split("#")[0];
      segs = pathOnly.split("/");
      for (i = 0; i < segs.length; i++) {
        seg = segs[i];
        if (!seg) continue;
        try {
          seg = decodeURIComponent(seg);
        } catch (err) {
          return;
        }
        if (seg === "..") return;
      }
      try {
        resolved = new URL(href, base);
      } catch (err) {
        return;
      }
      if (resolved.origin !== base.origin) return;
      if (!resolved.pathname.startsWith(base.pathname)) return;
      rest = resolved.pathname.slice(base.pathname.length);
      if (!rest || rest.indexOf("/") !== -1) return;
      try {
        name = decodeURIComponent(rest);
      } catch (err) {
        return;
      }
      if (!name || name.charAt(0) === "." || !IMAGE_EXT.test(name) || seen[name]) return;
      seen[name] = true;
      images.push({ name: name, url: resolved.href });
    });
    images.sort(function (a, b) {
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    return images;
  }

  /**
   * Shell-style name filter. * matches any text, ? matches one character.
   * A blank pattern matches every name. The default *.* matches names with a dot.
   */
  function nameMatchesFilter(name, pattern) {
    var text = String(pattern == null ? "*.*" : pattern).trim();
    var escaped = "";
    var i, ch;
    if (!text || text === "*") return true;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (ch === "*") escaped += ".*";
      else if (ch === "?") escaped += ".";
      else escaped += ch.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
    }
    return new RegExp("^" + escaped + "$", "i").test(String(name));
  }

  var api = {
    normalizeDir: normalizeDir,
    imagesFromListing: imagesFromListing,
    buildStoredZip: buildStoredZip,
    crc32: crc32,
    nameMatchesFilter: nameMatchesFilter,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof document === "undefined") return;

  var rootEl = document.getElementById("gallery-root");
  var statusEl = document.getElementById("gallery-status");
  var dirInput = document.getElementById("dir-input");
  var sessionInput = document.getElementById("session-input");
  var newSessionBtn = document.getElementById("new-session-btn");
  var dirForm = document.getElementById("dir-form");
  var introTemplate = document.getElementById("intro-template");
  var lightbox = document.getElementById("gallery-lightbox");
  var lightboxImg = document.getElementById("lightbox-image");
  var lightboxCaption = document.getElementById("lightbox-caption");
  var lightboxClose = document.getElementById("lightbox-close");
  var fullscreenEl = document.getElementById("gallery-fullscreen");
  var fsImage = document.getElementById("fs-image");
  var fsCaption = document.getElementById("fs-caption");
  var fsCounter = document.getElementById("fs-counter");
  var fsClose = document.getElementById("fs-close");
  var fsPrev = document.getElementById("fs-prev");
  var fsNext = document.getElementById("fs-next");
  var fsLike = document.getElementById("fs-like");

  var FILMSTRIP_RADIUS = 24;
  var STRIP_HEIGHT_DEFAULT = 66;
  var state = {
    dir: "",
    session: "",
    multi: false,
    // persistForced: "auto" | "file" | "session" (from ?persist=)
    // persistMode: resolved "file" | "session" after probe
    persistForced: "auto",
    persistMode: "file",
    images: [],
    index: 0,
    liked: {},
    classes: {},
    classDefs: {},
    likeFilter: "all",
    classFilter: "all",
    nameFilter: "*.*",
    showGrid: true,
    stripHeight: STRIP_HEIGHT_DEFAULT,
    startFromQuery: null,
    fitWidth: false,
    fullscreen: false,
    downloading: false,
    progress: "",
    visibleCache: null,
    filmstripStart: -1,
    filmstripEnd: -1,
  };
  var globalsBound = false;
  var prefetchLink = null;
  var positionSaveTimer = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", !!isError);
    statusEl.hidden = !message;
  }

  function queryParams() {
    return new URLSearchParams(window.location.search);
  }

  function queryDir() {
    return queryParams().get("dir") || "";
  }

  function parseLikeFilter(raw) {
    var value = String(raw == null ? "" : raw)
      .toLowerCase()
      .trim()
      .replace(/[_\s]+/g, "-");
    if (
      value === "liked" ||
      value === "like" ||
      value === "liked-only" ||
      value === "starred"
    ) {
      return "liked";
    }
    if (
      value === "unliked" ||
      value === "nolike" ||
      value === "no-like" ||
      value === "nolike-only" ||
      value === "no-like-only" ||
      value === "not-liked"
    ) {
      return "unliked";
    }
    return "all";
  }

  function parseBoolParam(raw, fallback) {
    if (raw == null || raw === "") return fallback;
    var value = String(raw).toLowerCase().trim();
    if (value === "0" || value === "false" || value === "no" || value === "off") {
      return false;
    }
    if (value === "1" || value === "true" || value === "yes" || value === "on") {
      return true;
    }
    return fallback;
  }

  function sessionNameError(raw) {
    var value = String(raw == null ? "" : raw).trim();
    if (!value) return "Enter a session name.";
    if (/\s/.test(value)) return "Session names cannot contain spaces.";
    if (value.length > SESSION_NAME_MAX) {
      return "Session names can be at most " + SESSION_NAME_MAX + " characters.";
    }
    if (!SESSION_NAME_RE.test(value)) {
      return "Session names may only use letters, digits, underscore (_), and hyphen (-).";
    }
    return "";
  }

  function parseSessionId(raw) {
    var value = String(raw == null ? "" : raw).trim();
    if (!value) return "";
    if (!sessionNameError(value)) return value;
    return null;
  }

  function sessionSuffix() {
    return state.session ? "_" + state.session : "";
  }

  function likesFileName() {
    return ".gallapp_likes" + sessionSuffix();
  }

  function positionFileName() {
    return ".gallapp_position" + sessionSuffix();
  }

  function multiFileName() {
    return ".gallapp_multi" + sessionSuffix();
  }

  function classDefsFileName() {
    return ".gallapp_classes";
  }

  function defaultClassDefs() {
    var defs = {};
    var i;
    for (i = 1; i <= MAX_CLASS; i++) {
      defs[i] = { name: "class" + i, glyph: String(i) };
    }
    return defs;
  }

  function ensureClassDefs() {
    if (!state.classDefs || !Object.keys(state.classDefs).length) {
      state.classDefs = defaultClassDefs();
    }
    return state.classDefs;
  }

  function classDisplayName(slot) {
    var def = ensureClassDefs()[slot];
    if (!def || def.name === "class" + slot) return "Class " + slot;
    return def.name;
  }

  function classGlyph(slot) {
    var def = ensureClassDefs()[slot];
    return def && def.glyph ? def.glyph : String(slot);
  }

  function classDisplayWithGlyph(slot) {
    var name = classDisplayName(slot);
    var glyph = classGlyph(slot);
    if (String(glyph) === String(slot)) return name;
    return name + " (" + glyph + ")";
  }

  function classFilterCaption(slot) {
    return classDisplayWithGlyph(slot) + " [" + classSlotCount(slot) + "]";
  }

  function classGlyphLabel(list) {
    return normalizeClassList(list)
      .map(function (slot) {
        return classGlyph(slot);
      })
      .join(",");
  }

  function classNameLabel(list) {
    return normalizeClassList(list)
      .map(function (slot) {
        return classDisplayWithGlyph(slot);
      })
      .join(", ");
  }

  function parseClassFilter(raw) {
    var value = String(raw == null ? "" : raw)
      .toLowerCase()
      .trim();
    var n;
    if (!value || value === "all") return "all";
    if (
      value === "none" ||
      value === "no" ||
      value === "noclass" ||
      value === "no-class" ||
      value === "unclassified"
    ) {
      return "none";
    }
    n = parseInt(value.replace(/^class-?/, ""), 10);
    if (isFinite(n) && n >= 1 && n <= MAX_CLASS) return String(n);
    return "all";
  }

  function normalizeClassList(value) {
    var list = [];
    var seen = {};
    function add(raw) {
      var n = parseInt(raw, 10);
      if (!isFinite(n) || n < 1 || n > MAX_CLASS || seen[n]) return;
      seen[n] = true;
      list.push(n);
    }
    if (Array.isArray(value)) {
      value.forEach(add);
    } else if (typeof value === "number" || typeof value === "string") {
      String(value)
        .split(/[,\s+]+/)
        .forEach(add);
    }
    list.sort(function (a, b) {
      return a - b;
    });
    return list;
  }

  function classesOf(img) {
    if (!img) return [];
    return normalizeClassList(state.classes[img.name]);
  }

  function classOf(img) {
    var list = classesOf(img);
    return list.length ? list[0] : 0;
  }

  function classLabel(list) {
    // Badge / compact mark: glyphs (letter or digit per class).
    return classGlyphLabel(list);
  }

  function classColor(n) {
    return CLASS_COLORS[n] || "";
  }

  function classDefsFileUrl() {
    return directoryUrl(state.dir) + classDefsFileName();
  }

  function classDefsText() {
    var lines = [];
    var i;
    var def;
    ensureClassDefs();
    for (i = 1; i <= MAX_CLASS; i++) {
      def = state.classDefs[i];
      if (!def) continue;
      if (def.name === "class" + i && def.glyph === String(i)) continue;
      lines.push(i + "\t" + def.name + "\t" + def.glyph);
    }
    return lines.length ? lines.join("\n") + "\n" : "";
  }

  function applyClassDefsText(text) {
    var defs = defaultClassDefs();
    String(text || "")
      .split(/\r?\n/)
      .forEach(function (line) {
        var raw = line.trim();
        var parts;
        var slot;
        var name;
        var glyph;
        if (!raw || raw.charAt(0) === "#") return;
        parts = raw.split("\t");
        if (parts.length < 3) return;
        slot = parseInt(parts[0], 10);
        name = String(parts[1] || "").trim();
        glyph = String(parts[2] || "").trim();
        if (!isFinite(slot) || slot < 1 || slot > MAX_CLASS) return;
        if (!CLASS_NAME_RE.test(name) || !CLASS_GLYPH_RE.test(glyph)) return;
        defs[slot] = { name: name, glyph: glyph };
      });
    state.classDefs = defs;
  }

  async function loadClassDefs() {
    var text;
    state.classDefs = defaultClassDefs();
    if (!state.dir) return;
    text = await loadSidecarText(classDefsFileName(), classDefsFileUrl());
    if (text != null && String(text).trim()) {
      applyClassDefsText(text);
    }
  }

  async function saveClassDefs() {
    var body = classDefsText();
    if (!state.dir) return false;
    return saveSidecarText(classDefsFileName(), classDefsFileUrl(), body);
  }

  function hasClass(img, klass) {
    return classesOf(img).indexOf(klass) !== -1;
  }

  function syncSessionInput() {
    if (sessionInput) sessionInput.value = state.session || "";
  }

  function applyQueryOptions() {
    var params = queryParams();
    var filter = params.get("filter");
    var likes = params.get("likes") || params.get("view");
    var classParam = params.get("class");
    var grid = params.get("grid");
    var strip = params.get("strip") || params.get("strip_h");
    var n = params.get("n") || params.get("image") || params.get("i");
    var session = parseSessionId(params.get("session"));
    var height;
    var number;
    state.multi = parseBoolParam(params.get("multi"), false);
    state.persistForced = parsePersistMode(params.get("persist"));
    if (state.persistForced !== "auto") {
      state.persistMode = state.persistForced;
    }
    if (session === null) {
      state.session = "";
      setStatus(
        "Invalid session name. Use letters, digits, _ or - only (or omit session for the default).",
        true
      );
    } else {
      state.session = session;
    }
    syncSessionInput();
    if (filter != null && String(filter).trim() !== "") {
      state.nameFilter = String(filter);
    }
    if (state.multi) {
      if (classParam != null && String(classParam).trim() !== "") {
        state.classFilter = parseClassFilter(classParam);
      } else if (likes != null && String(likes).trim() !== "") {
        // Accept likes= as a soft alias when opening old links in multi mode.
        state.classFilter = parseClassFilter(likes);
      }
    } else if (likes != null && String(likes).trim() !== "") {
      state.likeFilter = parseLikeFilter(likes);
    }
    state.showGrid = parseBoolParam(grid, true);
    if (strip != null && String(strip).trim() !== "") {
      height = parseInt(strip, 10);
      if (isFinite(height) && height >= 32 && height <= 240) {
        state.stripHeight = height;
      }
    }
    if (n != null && String(n).trim() !== "") {
      number = parseInt(n, 10);
      if (isFinite(number) && number >= 1) state.startFromQuery = number;
    }
  }

  function buildStatusParams(options) {
    var params = new URLSearchParams();
    var images = visibleImages();
    var multi = options && options.multi != null ? !!options.multi : !!state.multi;
    params.set("dir", state.dir || "");
    params.set("session", state.session || "");
    params.set("multi", multi ? "true" : "false");
    params.set("n", images.length ? String(state.index + 1) : "1");
    if (multi) {
      params.set("class", state.multi ? state.classFilter || "all" : "all");
      params.set("likes", "all");
    } else {
      params.set("class", "all");
      params.set("likes", state.multi ? "all" : state.likeFilter || "all");
    }
    params.set("filter", state.nameFilter || "*.*");
    params.set("grid", state.showGrid ? "true" : "false");
    params.set("strip", String(state.stripHeight || STRIP_HEIGHT_DEFAULT));
    params.set(
      "persist",
      state.persistForced !== "auto" ? state.persistForced : state.persistMode || "auto"
    );
    return params;
  }

  function buildStatusUrl() {
    return (
      window.location.origin +
      window.location.pathname +
      "?" +
      buildStatusParams().toString()
    );
  }

  function syncUrlState() {
    var url;
    if (!state.dir || window.location.protocol === "file:") return;
    try {
      url = buildStatusUrl();
      if (url !== window.location.href) {
        window.history.replaceState(null, "", url);
      }
    } catch (err) {}
  }

  function modeSwitchUrl(wantMulti) {
    return (
      window.location.origin +
      window.location.pathname +
      "?" +
      buildStatusParams({ multi: wantMulti }).toString()
    );
  }

  function modeSwitchHtml() {
    if (state.multi) {
      return (
        ' · <a class="gallery-mode-link" href="' +
        escapeHtml(modeSwitchUrl(false)) +
        '" title="Switch to like mode">Like mode</a>'
      );
    }
    return (
      ' · <a class="gallery-mode-link" href="' +
      escapeHtml(modeSwitchUrl(true)) +
      '" title="Classify images into classes 1–9">Multi classification</a>'
    );
  }

  var toastTimer = null;

  function showToast(message) {
    var toast = document.getElementById("gallery-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove("is-visible", "is-leaving");
    // Retrigger the enter animation if Copy status is pressed again quickly.
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
      toast.classList.add("is-leaving");
      toastTimer = setTimeout(function () {
        toast.classList.remove("is-leaving");
        toast.hidden = true;
        toastTimer = null;
      }, 280);
    }, 1800);
  }

  function copyStatus() {
    var url = buildStatusUrl();
    function done() {
      showToast("Link copied");
    }
    function fallback() {
      window.prompt("Copy this gallery URL:", url);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function applyStripHeight() {
    var strip = document.getElementById("gallery-filmstrip");
    if (!strip) return;
    strip.style.setProperty("--gallery-strip-h", state.stripHeight + "px");
  }

  function directoryUrl(dir) {
    var path = dir.split("/").map(encodeURIComponent).join("/") + "/";
    return new URL(path, window.location.origin + "/").href;
  }

  function basenameDir(dir) {
    var parts = String(dir || "").split("/");
    return parts[parts.length - 1] || dir;
  }

  function likeStorageKey() {
    return "gallapp-likes:" + state.dir + sessionSuffix();
  }

  function positionStorageKey() {
    return "gallapp-position:" + state.dir + sessionSuffix();
  }

  function likesFileUrl() {
    return directoryUrl(state.dir) + likesFileName();
  }

  function positionFileUrl() {
    return directoryUrl(state.dir) + positionFileName();
  }

  function multiFileUrl() {
    return directoryUrl(state.dir) + multiFileName();
  }

  function multiStorageKey() {
    return "gallapp-multi:" + state.dir + sessionSuffix();
  }

  function persistLabel() {
    return isSessionPersist() ? "browser session" : "folder files";
  }

  function galleryUrl(dir, session) {
    var params = new URLSearchParams();
    params.set("dir", dir || "");
    if (session) params.set("session", session);
    if (state.multi) params.set("multi", "true");
    return (
      window.location.origin +
      window.location.pathname +
      "?" +
      params.toString()
    );
  }

  async function putSidecar(url, body) {
    var res = await fetch(url, {
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: body == null ? "" : body,
    });
    return res;
  }

  function parsePersistMode(raw) {
    var value = String(raw == null ? "" : raw)
      .toLowerCase()
      .trim();
    if (value === "session" || value === "browser" || value === "temp") {
      return "session";
    }
    if (value === "file" || value === "disk" || value === "folder") {
      return "file";
    }
    return "auto";
  }

  function isSessionPersist() {
    return state.persistMode === "session";
  }

  function sidecarBrowserKey(fileName) {
    return "gallapp:sidecar:" + state.dir + ":" + fileName;
  }

  function readBrowserSidecar(fileName) {
    if (!state.dir || !fileName) return null;
    try {
      if (window.sessionStorage.getItem(sidecarBrowserKey(fileName)) != null) {
        return window.sessionStorage.getItem(sidecarBrowserKey(fileName));
      }
    } catch (err) {}
    return null;
  }

  function writeBrowserSidecar(fileName, text) {
    if (!state.dir || !fileName) return false;
    try {
      window.sessionStorage.setItem(
        sidecarBrowserKey(fileName),
        text == null ? "" : String(text)
      );
      return true;
    } catch (err) {
      return false;
    }
  }

  function hasBrowserSidecar(fileName) {
    if (!state.dir || !fileName) return false;
    try {
      return window.sessionStorage.getItem(sidecarBrowserKey(fileName)) != null;
    } catch (err) {
      return false;
    }
  }

  async function fetchSidecarText(url) {
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.text();
    } catch (err) {}
    return null;
  }

  async function detectPersistMode() {
    var probeUrl;
    var existing;
    var res;
    if (state.persistForced === "session") {
      state.persistMode = "session";
      return;
    }
    if (state.persistForced === "file") {
      state.persistMode = "file";
      return;
    }
    probeUrl = state.multi ? multiFileUrl() : likesFileUrl();
    existing = (await fetchSidecarText(probeUrl)) || "";
    try {
      res = await putSidecar(probeUrl, existing);
      state.persistMode = res.ok ? "file" : "session";
    } catch (err) {
      state.persistMode = "session";
    }
  }

  /**
   * Load a sidecar: in session mode prefer the browser entity, else seed from
   * a GET (read-only repo/folder). In file mode use the disk file.
   */
  async function loadSidecarText(fileName, fileUrl) {
    var browserText;
    var remoteText;
    if (isSessionPersist()) {
      if (hasBrowserSidecar(fileName)) {
        return readBrowserSidecar(fileName) || "";
      }
      remoteText = await fetchSidecarText(fileUrl);
      if (remoteText != null) {
        writeBrowserSidecar(fileName, remoteText);
        return remoteText;
      }
      return null;
    }
    remoteText = await fetchSidecarText(fileUrl);
    return remoteText;
  }

  async function saveSidecarText(fileName, fileUrl, body) {
    var text = body == null ? "" : body;
    if (isSessionPersist()) {
      if (!writeBrowserSidecar(fileName, text)) {
        setStatus(
          "Could not store " +
            fileName +
            " in the browser session (storage full or blocked).",
          true
        );
        return false;
      }
      return true;
    }
    try {
      var res = await putSidecar(fileUrl, text);
      if (!res.ok) throw new Error(String(res.status));
      return true;
    } catch (err) {
      // Writable probe said file, but a later PUT failed — fall back once.
      state.persistMode = "session";
      if (!writeBrowserSidecar(fileName, text)) return false;
      if (!state.persistFallbackWarned) {
        state.persistFallbackWarned = true;
        setStatus(
          "Folder writes failed; switched to browser session storage. Use Export sidecars to save your work.",
          true
        );
      }
      return true;
    }
  }

  async function ensureSessionSidecars() {
    var name;
    if (!state.session || !state.dir) return true;
    if (isSessionPersist()) {
      if (state.multi) writeBrowserSidecar(multiFileName(), multiText());
      else writeBrowserSidecar(likesFileName(), likesText());
      name = currentImageName();
      writeBrowserSidecar(positionFileName(), name ? name + "\n" : "");
      return true;
    }
    try {
      if (state.multi) {
        if (!(await saveSidecarText(multiFileName(), multiFileUrl(), multiText()))) {
          throw new Error("multi");
        }
        state.multiInFile = true;
      } else {
        if (!(await saveSidecarText(likesFileName(), likesFileUrl(), likesText()))) {
          throw new Error("likes");
        }
        state.likesInFile = true;
      }
      name = currentImageName();
      if (
        !(await saveSidecarText(
          positionFileName(),
          positionFileUrl(),
          name ? name + "\n" : ""
        ))
      ) {
        throw new Error("position");
      }
      return true;
    } catch (err) {
      if (isSessionPersist()) return true;
      setStatus(
        "Could not create session files. Start with python3 gallapp/server.py, or open with persist=session.",
        true
      );
      return false;
    }
  }

  function downloadTextFile(fileName, text) {
    var blob = new Blob([text == null ? "" : text], {
      type: "text/plain;charset=utf-8",
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function exportSessionSidecars() {
    var entries = [];
    var zip;
    var blob;
    var url;
    var a;
    var i;
    if (!state.dir) return;
    if (state.multi) {
      entries.push({ name: classDefsFileName(), data: classDefsText() });
      entries.push({ name: multiFileName(), data: multiText() });
    } else {
      entries.push({ name: likesFileName(), data: likesText() });
    }
    entries.push({
      name: positionFileName(),
      data: currentImageName() ? currentImageName() + "\n" : "",
    });
    if (entries.length === 1) {
      downloadTextFile(entries[0].name, entries[0].data);
      showToast("Exported " + entries[0].name);
      return;
    }
    try {
      zip = buildStoredZip(
        entries.map(function (entry) {
          return {
            name: entry.name,
            data: new TextEncoder().encode(entry.data || ""),
          };
        })
      );
      blob = new Blob([zip], { type: "application/zip" });
      url = URL.createObjectURL(blob);
      a = document.createElement("a");
      a.href = url;
      a.download =
        "gallapp-sidecars" +
        (state.session ? "_" + state.session : "") +
        ".zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      showToast("Exported " + entries.length + " sidecar files");
    } catch (err) {
      for (i = 0; i < entries.length; i++) {
        downloadTextFile(entries[i].name, entries[i].data);
      }
      showToast("Exported sidecar files");
    }
  }

  function importSidecarFile(file) {
    var name = String(file && file.name ? file.name : "");
    var base = name.replace(/^.*[\\/]/, "");
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve({ name: base, text: String(reader.result || "") });
      };
      reader.onerror = function () {
        reject(reader.error || new Error("Could not read file"));
      };
      reader.readAsText(file);
    });
  }

  async function importSessionSidecars(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var i;
    var item;
    var applied = 0;
    if (!files.length || !state.dir) return;
    for (i = 0; i < files.length; i++) {
      item = await importSidecarFile(files[i]);
      if (item.name === classDefsFileName()) {
        applyClassDefsText(item.text);
        writeBrowserSidecar(item.name, classDefsText());
        if (!isSessionPersist()) {
          await saveSidecarText(item.name, classDefsFileUrl(), classDefsText());
        }
        applied += 1;
      } else if (item.name === likesFileName()) {
        applyLikesText(item.text);
        writeBrowserSidecar(item.name, likesText());
        if (!isSessionPersist()) {
          await saveSidecarText(item.name, likesFileUrl(), likesText());
        }
        applied += 1;
      } else if (item.name === multiFileName()) {
        applyMultiText(item.text);
        writeBrowserSidecar(item.name, multiText());
        if (!isSessionPersist()) {
          await saveSidecarText(item.name, multiFileUrl(), multiText());
        }
        applied += 1;
      } else if (item.name === positionFileName()) {
        writeBrowserSidecar(item.name, item.text);
        applied += 1;
      }
    }
    if (!applied) {
      showToast("No .gallapp_* files recognized");
      return;
    }
    invalidateVisible();
    render();
    showToast("Imported " + applied + " sidecar" + (applied === 1 ? "" : "s"));
  }

  function likesText() {
    var names = Object.keys(state.liked).sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
    return names.length ? names.join("\n") + "\n" : "";
  }

  function applyLikesText(text) {
    state.liked = {};
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var name = line.trim();
      if (!name || name.charAt(0) === "#") return;
      state.liked[name] = true;
    });
  }

  function loadLikesFromLegacyStorage() {
    try {
      var list = JSON.parse(window.localStorage.getItem(likeStorageKey()) || "[]");
      if (Array.isArray(list) && list.length) {
        applyLikesText(list.join("\n") + "\n");
        writeBrowserSidecar(likesFileName(), likesText());
        return true;
      }
    } catch (err) {}
    return false;
  }

  async function loadLikes() {
    var text;
    state.liked = {};
    state.likesInFile = false;
    text = await loadSidecarText(likesFileName(), likesFileUrl());
    if (text != null) {
      applyLikesText(text);
      state.likesInFile = !isSessionPersist();
      return;
    }
    if (loadLikesFromLegacyStorage()) return;
  }

  function saveLikes() {
    var body = likesText();
    var dir = state.dir;
    state.likeSave = Promise.resolve(state.likeSave)
      .catch(function () {})
      .then(function () {
        if (dir !== state.dir) return;
        return saveSidecarText(likesFileName(), likesFileUrl(), body).then(function (ok) {
          if (ok && !isSessionPersist()) state.likesInFile = true;
        });
      });
  }

  function multiText() {
    var names = Object.keys(state.classes).sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
    var lines = [];
    names.forEach(function (name) {
      var list = normalizeClassList(state.classes[name]);
      if (!list.length) return;
      lines.push(name + "\t" + list.join(","));
    });
    return lines.length ? lines.join("\n") + "\n" : "";
  }

  function applyMultiText(text) {
    state.classes = {};
    String(text || "")
      .split(/\r?\n/)
      .forEach(function (line) {
        var raw = line.trim();
        var parts;
        var name;
        var list;
        var existing;
        if (!raw || raw.charAt(0) === "#") return;
        if (raw.indexOf("\t") === -1) return;
        parts = raw.split("\t");
        name = parts[0].trim();
        if (!name) return;
        list = normalizeClassList(parts.slice(1).join("\t"));
        if (!list.length) return;
        existing = state.classes[name] ? state.classes[name].slice() : [];
        state.classes[name] = normalizeClassList(existing.concat(list));
      });
  }

  function loadMultiFromLegacyStorage() {
    try {
      var map = JSON.parse(window.localStorage.getItem(multiStorageKey()) || "{}");
      if (map && typeof map === "object" && Object.keys(map).length) {
        state.classes = {};
        Object.keys(map).forEach(function (name) {
          var list = normalizeClassList(map[name]);
          if (list.length) state.classes[name] = list;
        });
        writeBrowserSidecar(multiFileName(), multiText());
        return true;
      }
    } catch (err) {}
    return false;
  }

  async function loadMulti() {
    var text;
    state.classes = {};
    state.multiInFile = false;
    text = await loadSidecarText(multiFileName(), multiFileUrl());
    if (text != null) {
      applyMultiText(text);
      state.multiInFile = !isSessionPersist();
      return;
    }
    if (loadMultiFromLegacyStorage()) return;
  }

  function saveMulti() {
    var body = multiText();
    var dir = state.dir;
    state.multiSave = Promise.resolve(state.multiSave)
      .catch(function () {})
      .then(function () {
        if (dir !== state.dir) return;
        return saveSidecarText(multiFileName(), multiFileUrl(), body).then(function (ok) {
          if (ok && !isSessionPersist()) state.multiInFile = true;
        });
      });
  }

  function currentImageName() {
    var img = visibleImages()[state.index];
    return img ? img.name : "";
  }

  function indexOfName(name, images) {
    var i;
    if (!name) return -1;
    for (i = 0; i < images.length; i++) {
      if (images[i].name === name) return i;
    }
    return -1;
  }

  function firstNonEmptyLine(text) {
    return (
      String(text || "")
        .split(/\r?\n/)
        .map(function (line) {
          return line.trim();
        })
        .filter(function (line) {
          return line && line.charAt(0) !== "#";
        })[0] || ""
    );
  }

  async function loadPosition() {
    var text = await loadSidecarText(positionFileName(), positionFileUrl());
    var name = firstNonEmptyLine(text);
    if (!name) {
      try {
        name = window.localStorage.getItem(positionStorageKey()) || "";
        if (name) writeBrowserSidecar(positionFileName(), name + "\n");
      } catch (err) {}
    }
    return name;
  }

  function savePositionNow() {
    var name = currentImageName();
    var dir = state.dir;
    syncUrlState();
    if (!name || !dir) return;
    try {
      window.localStorage.setItem(positionStorageKey(), name);
    } catch (err) {}
    state.positionSave = Promise.resolve(state.positionSave)
      .catch(function () {})
      .then(function () {
        if (dir !== state.dir) return;
        return saveSidecarText(positionFileName(), positionFileUrl(), name + "\n");
      });
  }

  function savePosition() {
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(function () {
      positionSaveTimer = null;
      savePositionNow();
    }, 250);
  }

  function flushPositionSave() {
    if (positionSaveTimer) {
      clearTimeout(positionSaveTimer);
      positionSaveTimer = null;
    }
    savePositionNow();
  }

  function loadRecent() {
    try {
      var list = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function rememberDir(dir) {
    var list = [dir].concat(
      loadRecent().filter(function (item) {
        return item !== dir;
      })
    );
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
    } catch (err) {}
  }

  function isLiked(img) {
    return !!(img && state.liked[img.name]);
  }

  function isClassified(img) {
    return classesOf(img).length > 0;
  }

  function invalidateVisible() {
    state.visibleCache = null;
  }

  function visibleImages() {
    if (state.visibleCache) return state.visibleCache;
    var list = state.images.filter(function (img) {
      return nameMatchesFilter(img.name, state.nameFilter);
    });
    if (state.multi) {
      if (state.classFilter === "none") {
        list = list.filter(function (img) {
          return !isClassified(img);
        });
      } else if (state.classFilter !== "all") {
        list = list.filter(function (img) {
          return hasClass(img, parseInt(state.classFilter, 10));
        });
      }
    } else if (state.likeFilter === "liked") {
      list = list.filter(isLiked);
    } else if (state.likeFilter === "unliked") {
      list = list.filter(function (img) {
        return !isLiked(img);
      });
    }
    state.visibleCache = list;
    return list;
  }

  function nameFilteredImages() {
    return state.images.filter(function (img) {
      return nameMatchesFilter(img.name, state.nameFilter);
    });
  }

  function likedImages() {
    return state.images.filter(isLiked);
  }

  function classifiedImages() {
    var list = nameFilteredImages().filter(isClassified);
    if (state.classFilter !== "all" && state.classFilter !== "none") {
      list = list.filter(function (img) {
        return hasClass(img, parseInt(state.classFilter, 10));
      });
    }
    return list;
  }

  function likedCount() {
    return Object.keys(state.liked).length;
  }

  function classifiedCount() {
    return Object.keys(state.classes).length;
  }

  function nameFilteredLikedCount() {
    var n = 0;
    nameFilteredImages().forEach(function (img) {
      if (isLiked(img)) n += 1;
    });
    return n;
  }

  function nameFilteredClassifiedCount() {
    var n = 0;
    nameFilteredImages().forEach(function (img) {
      if (isClassified(img)) n += 1;
    });
    return n;
  }

  function classSlotCount(slot) {
    var n = 0;
    var s = parseInt(slot, 10);
    if (!isFinite(s) || s < 1 || s > MAX_CLASS) return 0;
    nameFilteredImages().forEach(function (img) {
      if (hasClass(img, s)) n += 1;
    });
    return n;
  }

  function nameFilteredUnclassifiedCount() {
    var n = 0;
    nameFilteredImages().forEach(function (img) {
      if (!isClassified(img)) n += 1;
    });
    return n;
  }

  function updateClassFilterCounts() {
    if (!state.multi) return;
    document.querySelectorAll(".gallery-filter-count[data-class-slot]").forEach(function (el) {
      var slot = el.getAttribute("data-class-slot");
      var count;
      if (slot === "none") count = nameFilteredUnclassifiedCount();
      else count = classSlotCount(slot);
      el.textContent = "[" + count + "]";
    });
    document.querySelectorAll(".gallery-filter-class[data-class-slot]").forEach(function (el) {
      var slot = el.getAttribute("data-class-slot");
      el.setAttribute(
        "title",
        classShortcutHint(parseInt(slot, 10)) + " · " + classFilterCaption(slot)
      );
    });
  }

  function updateImageCountLine() {
    var countLine = document.getElementById("gallery-image-count");
    var total;
    var marked;
    if (!countLine) return;
    total = nameFilteredImages().length;
    marked = state.multi ? nameFilteredClassifiedCount() : nameFilteredLikedCount();
    countLine.textContent =
      total +
      (total === 1 ? " image" : " images") +
      " · " +
      marked +
      (state.multi ? " classified" : " liked");
  }

  function filmstripWindow(images, index) {
    var start = Math.max(0, index - FILMSTRIP_RADIUS);
    var end = Math.min(images.length, index + FILMSTRIP_RADIUS + 1);
    return { start: start, end: end };
  }

  function filmstripItemHtml(img, i, activeIndex) {
    var classList = state.multi ? classesOf(img) : [];
    var klass = classList.length ? classList[0] : 0;
    var label = classLabel(classList);
    var liked = !state.multi && isLiked(img);
    return (
      '<button type="button" class="gallery-filmstrip-item' +
      (i === activeIndex ? " is-active" : "") +
      (liked ? " is-liked" : "") +
      (klass ? " is-classified" : "") +
      (classList.length > 1 ? " is-multiclass" : "") +
      '"' +
      (klass
        ? ' data-class="' +
          escapeHtml(label) +
          '" style="--class-color:' +
          classColor(klass) +
          '"'
        : "") +
      ' data-index="' +
      i +
      '" title="' +
      escapeHtml(
        String(i + 1) +
          " · " +
          img.name +
          (classList.length ? " · " + classNameLabel(classList) + " [" + label + "]" : "")
      ) +
      '">' +
      '<img src="' +
      escapeHtml(img.url) +
      '" alt="" loading="lazy" decoding="async">' +
      '<span class="gallery-filmstrip-num" aria-hidden="true">' +
      escapeHtml(String(i + 1)) +
      "</span>" +
      "</button>"
    );
  }

  function refreshFilmstrip(images, force) {
    var strip = document.getElementById("gallery-filmstrip");
    var win, html, i;
    if (!strip || !images.length) return;
    win = filmstripWindow(images, state.index);
    if (
      !force &&
      state.filmstripStart === win.start &&
      state.filmstripEnd === win.end
    ) {
      return;
    }
    html = "";
    for (i = win.start; i < win.end; i++) {
      html += filmstripItemHtml(images[i], i, state.index);
    }
    strip.innerHTML = html;
    state.filmstripStart = win.start;
    state.filmstripEnd = win.end;
  }

  function prefetchAround(images, index) {
    var urls = [];
    var i, img, link;
    [-1, 1, 2].forEach(function (delta) {
      img = images[index + delta];
      if (img) urls.push(img.url);
    });
    if (!urls.length) return;
    if (!prefetchLink) {
      prefetchLink = document.createElement("link");
      prefetchLink.rel = "prefetch";
      prefetchLink.as = "image";
      document.head.appendChild(prefetchLink);
    }
    for (i = 0; i < urls.length; i++) {
      link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "image";
      link.href = urls[i];
      document.head.appendChild(link);
      setTimeout(function (el) {
        el.remove();
      }.bind(null, link), 30000);
    }
  }

  function imageNameLinkHtml(img) {
    if (!img) return "";
    return (
      '<a href="' +
      escapeHtml(img.url) +
      '" target="_blank" rel="noopener noreferrer" title="' +
      escapeHtml(img.name) +
      '">' +
      escapeHtml(img.name) +
      "</a>"
    );
  }

  function setNameLink(el, img) {
    if (!el || !img) return;
    el.innerHTML = imageNameLinkHtml(img);
  }

  function setLikeButton(el, on, withLabel) {
    if (!el) return;
    var label = on ? "Unlike" : "Like";
    el.classList.toggle("is-liked", on);
    el.classList.remove("is-classified");
    el.style.removeProperty("--class-color");
    el.removeAttribute("data-class");
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.setAttribute("title", label);
    if (withLabel) {
      el.textContent = on ? "★ Liked" : "☆ Like";
    } else {
      el.setAttribute("aria-label", label);
      el.textContent = on ? "★" : "☆";
    }
  }

  function setClassButton(el, list, withLabel) {
    var classes = normalizeClassList(list);
    var primary = classes.length ? classes[0] : 0;
    var glyphs = classGlyphLabel(classes);
    var names = classNameLabel(classes);
    var color = classColor(primary);
    if (!el) return;
    el.classList.toggle("is-classified", !!classes.length);
    el.classList.toggle("is-multiclass", classes.length > 1);
    el.classList.remove("is-liked");
    if (classes.length) {
      el.setAttribute("data-class", glyphs);
      el.style.setProperty("--class-color", color);
      el.setAttribute("aria-pressed", "true");
      el.setAttribute(
        "title",
        names +
          " [" +
          glyphs +
          "] (" +
          classShortcutsHint() +
          " · Shift+0 clears all)"
      );
      if (withLabel) {
        el.textContent = names;
      } else {
        el.setAttribute("aria-label", names);
        el.textContent = glyphs;
      }
    } else {
      el.removeAttribute("data-class");
      el.style.removeProperty("--class-color");
      el.setAttribute("aria-pressed", "false");
      el.setAttribute("title", "No class — " + classShortcutsHint() + " · Shift+0 clears");
      if (withLabel) el.textContent = "No class";
      else {
        el.setAttribute("aria-label", "No class");
        el.textContent = "·";
      }
    }
  }

  function downloadLabel(count) {
    if (state.downloading) return state.progress || "Preparing…";
    if (state.multi) {
      if (count > 1) return "Download classified (.zip)";
      return "Download classified";
    }
    if (count > 1) return "Download liked (.zip)";
    return "Download liked";
  }

  function updateLikedActions(count) {
    document.querySelectorAll('[data-action="unlike-all"], [data-action="remove-classification"]').forEach(function (btn) {
      btn.disabled = count === 0;
      btn.title = state.multi
        ? count
          ? "Clear every classification in this session"
          : "No classified images"
        : count
          ? "Remove every like in this directory"
          : "No liked images";
    });
    document
      .querySelectorAll('[data-action="download-liked"], [data-action="download-classified"]')
      .forEach(function (btn) {
        btn.disabled = count === 0 || state.downloading;
        btn.title = state.multi
          ? count
            ? count === 1
              ? "Download the classified image"
              : "Download the " + count + " classified images as a .zip"
            : "Classify an image first"
          : count
            ? count === 1
              ? "Download the liked image"
              : "Download the " + count + " liked images as a .zip"
            : "Like an image first";
        var countEl = btn.querySelector(".gallery-like-count");
        if (countEl) countEl.textContent = String(count);
        var labelEl = btn.querySelector(".gallery-like-label");
        if (labelEl) labelEl.textContent = downloadLabel(count);
      });
    updateImageCountLine();
  }

  function updateCurrentLikeUI() {
    var images = visibleImages();
    var current = images[state.index];
    var klass;
    var on;
    if (state.multi) {
      (function updateMultiMarks() {
        var list = classesOf(current);
        var primary = list.length ? list[0] : 0;
        var glyphs = classGlyphLabel(list);
        var names = classNameLabel(list);
        setClassButton(document.getElementById("gallery-like"), list, true);
        setClassButton(fsLike, list, false);
        document.querySelectorAll(".gallery-liked-mark, .gallery-class-mark").forEach(function (el) {
          if (el.classList.contains("gallery-class-mark")) {
            if (list.length) {
              el.hidden = false;
              el.textContent = glyphs;
              el.title = names;
              el.classList.toggle("is-multiclass", list.length > 1);
              el.style.setProperty("--class-color", classColor(primary));
              el.setAttribute("data-class", glyphs);
            } else {
              el.hidden = true;
              el.textContent = "";
              el.removeAttribute("title");
              el.classList.remove("is-multiclass");
              el.removeAttribute("data-class");
              el.style.removeProperty("--class-color");
            }
          } else {
            el.hidden = true;
          }
        });
        placeLikedMarks();
        updateClassFilterCounts();
        updateLikedActions(
          state.classFilter !== "all" && state.classFilter !== "none"
            ? classifiedImages().length
            : classifiedCount()
        );
      })();
      return;
    }
    on = isLiked(current);
    setLikeButton(document.getElementById("gallery-like"), on, true);
    setLikeButton(fsLike, on, false);
    document.querySelectorAll(".gallery-liked-mark").forEach(function (el) {
      el.hidden = !on;
    });
    document.querySelectorAll(".gallery-class-mark").forEach(function (el) {
      el.hidden = true;
    });
    placeLikedMarks();
    updateLikedActions(likedCount());
  }

  function updateItemLikeUI(index) {
    var images = visibleImages();
    var img = images[index];
    var klass;
    var on;
    var gridItem = document.querySelector(
      '#gallery-grid .gallery-grid-item[data-index="' + index + '"]'
    );
    var stripItem = document.querySelector(
      '#gallery-filmstrip .gallery-filmstrip-item[data-index="' + index + '"]'
    );
    var badge;
    if (state.multi) {
      (function updateMultiItem() {
        var list = classesOf(img);
        var primary = list.length ? list[0] : 0;
        var label = classLabel(list);
        if (gridItem) {
          gridItem.classList.toggle("is-classified", !!list.length);
          gridItem.classList.toggle("is-multiclass", list.length > 1);
          gridItem.classList.remove("is-liked");
          if (list.length) {
            gridItem.setAttribute("data-class", label);
            gridItem.style.setProperty("--class-color", classColor(primary));
          } else {
            gridItem.removeAttribute("data-class");
            gridItem.style.removeProperty("--class-color");
          }
          badge = gridItem.querySelector(".gallery-like-btn, .gallery-class-btn");
          setClassButton(badge, list, false);
        }
        if (stripItem) {
          stripItem.classList.toggle("is-classified", !!list.length);
          stripItem.classList.toggle("is-multiclass", list.length > 1);
          stripItem.classList.remove("is-liked");
          if (list.length) {
            stripItem.setAttribute("data-class", label);
            stripItem.style.setProperty("--class-color", classColor(primary));
          } else {
            stripItem.removeAttribute("data-class");
            stripItem.style.removeProperty("--class-color");
          }
        }
      })();
      return;
    }
    on = isLiked(img);
    if (gridItem) {
      gridItem.classList.toggle("is-liked", on);
      gridItem.classList.remove("is-classified");
      setLikeButton(gridItem.querySelector(".gallery-like-btn"), on, false);
    }
    if (stripItem) {
      stripItem.classList.toggle("is-liked", on);
      stripItem.classList.remove("is-classified");
    }
  }

  function updateLikeUI() {
    updateCurrentLikeUI();
    updateItemLikeUI(state.index);
  }

  function triggerDownload(href, filename, blobUrl) {
    var a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      a.remove();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }, 10000);
  }

  function downloadImage(img) {
    if (!img) return;
    triggerDownload(img.url, img.name);
  }

  function zipFileName() {
    var base = basenameDir(state.dir) || "images";
    var suffix = state.multi ? "-classified" : "-liked";
    return base.replace(/[^\w.-]+/g, "_") + suffix + ".zip";
  }

  async function downloadSelection(list) {
    var entries = [];
    var i, res, bytes, zip, blob, url;
    if (!list.length || state.downloading) return;
    if (list.length === 1) {
      downloadImage(list[0]);
      return;
    }
    state.downloading = true;
    state.progress = "Preparing " + list.length + "…";
    updateLikeUI();
    setStatus(state.progress);
    try {
      for (i = 0; i < list.length; i++) {
        state.progress = "Downloading " + (i + 1) + " / " + list.length + "…";
        updateLikeUI();
        setStatus(state.progress);
        res = await fetch(list[i].url, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not read " + list[i].name);
        bytes = new Uint8Array(await res.arrayBuffer());
        entries.push({ name: list[i].name, data: bytes });
      }
      zip = buildStoredZip(entries);
      blob = new Blob([zip], { type: "application/zip" });
      url = URL.createObjectURL(blob);
      triggerDownload(url, zipFileName(), url);
      setStatus("");
    } catch (err) {
      setStatus(err && err.message ? err.message : "Could not create the zip.", true);
    } finally {
      state.downloading = false;
      state.progress = "";
      updateLikeUI();
    }
  }

  async function downloadLiked() {
    await downloadSelection(likedImages());
  }

  async function downloadClassified() {
    await downloadSelection(classifiedImages());
  }

  function unlikeAll() {
    if (!likedCount()) return;
    state.liked = {};
    saveLikes();
    invalidateVisible();
    state.index = 0;
    render();
  }

  function removeAllClassifications() {
    if (!classifiedCount()) return;
    state.classes = {};
    saveMulti();
    invalidateVisible();
    state.index = 0;
    render();
  }

  function likeFilterActive() {
    return state.likeFilter === "liked" || state.likeFilter === "unliked";
  }

  function classFilterActive() {
    return state.classFilter !== "all";
  }

  function afterMarkChange(index) {
    var next;
    if ((state.multi && classFilterActive()) || (!state.multi && likeFilterActive())) {
      invalidateVisible();
      next = visibleImages();
      if (!next.length) state.index = 0;
      else if (state.index >= next.length) state.index = next.length - 1;
      render();
      savePosition();
      return;
    }
    updateCurrentLikeUI();
    updateItemLikeUI(index);
    savePosition();
  }

  function toggleLike(index) {
    var img = visibleImages()[index];
    if (!img) return;
    if (state.multi) {
      clearClass(index);
      return;
    }
    if (state.liked[img.name]) delete state.liked[img.name];
    else state.liked[img.name] = true;
    saveLikes();
    afterMarkChange(index);
  }

  function assignClass(index, klass) {
    var img = visibleImages()[index];
    var list;
    var pos;
    if (!img || !state.multi) return;
    if (!klass || klass < 1 || klass > MAX_CLASS) return;
    list = classesOf(img).slice();
    pos = list.indexOf(klass);
    if (pos >= 0) list.splice(pos, 1);
    else list.push(klass);
    list = normalizeClassList(list);
    if (list.length) state.classes[img.name] = list;
    else delete state.classes[img.name];
    saveMulti();
    afterMarkChange(index);
  }

  function clearClass(index) {
    var img = visibleImages()[index];
    if (!img || !state.multi) return;
    if (!classesOf(img).length) return;
    delete state.classes[img.name];
    saveMulti();
    afterMarkChange(index);
  }

  function pressedGlyphFromEvent(event) {
    var code = event.code || "";
    var key = event.key || "";
    var digit;
    var letter;
    digit = /^Digit([0-9])$/.exec(code);
    if (digit) return digit[1];
    letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1].toLowerCase();
    if (key.length === 1 && /[A-Za-z0-9]/.test(key)) return key.toLowerCase();
    return "";
  }

  function slotFromGlyphEvent(event) {
    var pressed = pressedGlyphFromEvent(event);
    var i;
    var glyph;
    if (!pressed || pressed === "0") return 0;
    ensureClassDefs();
    for (i = 1; i <= MAX_CLASS; i++) {
      glyph = String(classGlyph(i) || "").toLowerCase();
      if (glyph === pressed) return i;
    }
    return 0;
  }

  function isClearClassShortcut(event) {
    return (
      event.code === "Digit0" ||
      event.key === "0" ||
      event.key === ")"
    );
  }

  function classShortcutHint(slot) {
    return "Shift+" + classGlyph(slot);
  }

  function classShortcutsHint() {
    var parts = [];
    var i;
    ensureClassDefs();
    for (i = 1; i <= MAX_CLASS; i++) {
      parts.push(classShortcutHint(i) + "=" + classDisplayName(i));
    }
    return parts.join(" · ");
  }

  function glyphConflict(slot, glyph) {
    var i;
    var g = String(glyph || "").toLowerCase();
    ensureClassDefs();
    for (i = 1; i <= MAX_CLASS; i++) {
      if (i === slot) continue;
      if (String(classGlyph(i) || "").toLowerCase() === g) {
        return "Glyph \"" + glyph + "\" is already used by " + classDisplayName(i) + ".";
      }
    }
    return "";
  }

  function jumpToNumber(raw) {
    var images = visibleImages();
    var n = images.length;
    var value = parseInt(String(raw || "").trim(), 10);
    if (!n || !isFinite(value)) {
      updateCounterFields(images);
      return;
    }
    if (value < 1) value = 1;
    if (value > n) value = n;
    setIndex(value - 1);
    updateCounterFields(images);
  }

  function updateCounterFields(images) {
    var jump = document.getElementById("gallery-jump");
    var total = document.getElementById("gallery-counter-total");
    images = images || visibleImages();
    if (jump && document.activeElement !== jump) {
      jump.value = images.length ? String(state.index + 1) : "";
      jump.max = String(Math.max(images.length, 1));
      jump.disabled = !images.length;
    }
    if (total) total.textContent = String(images.length);
  }

  function setIndex(next) {
    var images = visibleImages();
    var n = images.length;
    var prev;
    if (!n) return;
    prev = state.index;
    if (next < 0) next = 0;
    if (next >= n) next = n - 1;
    state.index = next;
    if (state.index === prev) {
      updateCounterFields(images);
      return;
    }
    updatePreview(prev);
    updateGridActive(prev);
    updateFullscreen();
    updateCurrentLikeUI();
    prefetchAround(images, state.index);
    savePosition();
  }

  function placeLikedMarks() {
    var pairs = [
      ["#gallery-preview-stage .gallery-liked-mark", "gallery-preview-image"],
      ["#gallery-preview-stage .gallery-class-mark", "gallery-preview-image"],
      ["#gallery-lightbox .gallery-liked-mark", "lightbox-image"],
      ["#gallery-lightbox .gallery-class-mark", "lightbox-image"],
      ["#gallery-fullscreen .gallery-liked-mark", "fs-image"],
      ["#gallery-fullscreen .gallery-class-mark", "fs-image"],
    ];
    pairs.forEach(function (pair) {
      var mark = document.querySelector(pair[0]);
      var img = document.getElementById(pair[1]);
      var stage, stageRect, imgRect, top, right;
      if (!mark || !img || mark.hidden) return;
      stage = mark.parentElement;
      if (!stage) return;
      stageRect = stage.getBoundingClientRect();
      imgRect = img.getBoundingClientRect();
      if (!imgRect.width || !imgRect.height) return;
      top = imgRect.top - stageRect.top + 8;
      right = stageRect.right - imgRect.right + 8;
      mark.style.top = top + "px";
      mark.style.right = right + "px";
    });
  }

  function applyFitWidth() {
    var stage = document.getElementById("gallery-preview-stage");
    var btn = document.getElementById("gallery-fit");
    if (stage) stage.classList.toggle("is-fit-width", !!state.fitWidth);
    if (btn) {
      btn.classList.toggle("is-active", !!state.fitWidth);
      btn.setAttribute("aria-pressed", state.fitWidth ? "true" : "false");
      btn.textContent = state.fitWidth ? "Normal size" : "Fit to width";
    }
    placeLikedMarks();
  }

  function updatePreview(prevIndex) {
    var imgEl = document.getElementById("gallery-preview-image");
    var nameEl = document.getElementById("gallery-preview-name");
    var strip = document.getElementById("gallery-filmstrip");
    var images = visibleImages();
    var img = images[state.index];
    var thumb, prevThumb, target;
    if (!imgEl || !img) return;
    if (imgEl.getAttribute("src") !== img.url) {
      imgEl.addEventListener("load", placeLikedMarks, { once: true });
    }
    imgEl.src = img.url;
    imgEl.alt = img.name;
    requestAnimationFrame(placeLikedMarks);
    if (nameEl) setNameLink(nameEl, img);
    updateCounterFields(images);
    if (!strip) return;
    refreshFilmstrip(images, false);
    if (typeof prevIndex === "number") {
      prevThumb = strip.querySelector('[data-index="' + prevIndex + '"]');
      if (prevThumb) prevThumb.classList.remove("is-active");
    }
    thumb = strip.querySelector('[data-index="' + state.index + '"]');
    if (thumb) {
      thumb.classList.add("is-active");
      target = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
      strip.scrollTo({ left: Math.max(0, target), behavior: "auto" });
    }
  }

  function updateGridActive(prevIndex) {
    var grid = document.getElementById("gallery-grid");
    var prev, next;
    if (!grid) return;
    if (typeof prevIndex === "number") {
      prev = grid.querySelector('[data-index="' + prevIndex + '"]');
      if (prev) prev.classList.remove("is-active");
    }
    next = grid.querySelector('[data-index="' + state.index + '"]');
    if (next) next.classList.add("is-active");
  }

  function updateFullscreen() {
    var images, img;
    if (!state.fullscreen || !fullscreenEl || !fsImage) return;
    images = visibleImages();
    img = images[state.index];
    if (!img) return;
    if (fsImage.getAttribute("src") !== img.url) {
      fsImage.addEventListener("load", placeLikedMarks, { once: true });
    }
    fsImage.src = img.url;
    fsImage.alt = img.name;
    requestAnimationFrame(placeLikedMarks);
    setNameLink(fsCaption, img);
    if (fsCounter) fsCounter.textContent = state.index + 1 + " / " + images.length;
  }

  function openLightbox(index) {
    var img = visibleImages()[index];
    if (!img || !lightbox) return;
    if (lightboxImg.getAttribute("src") !== img.url) {
      lightboxImg.addEventListener("load", placeLikedMarks, { once: true });
    }
    lightboxImg.src = img.url;
    lightboxImg.alt = img.name;
    requestAnimationFrame(placeLikedMarks);
    setNameLink(lightboxCaption, img);
    lightbox.hidden = false;
    document.body.classList.add("gallery-lightbox-open");
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    lightboxImg.removeAttribute("src");
    document.body.classList.remove("gallery-lightbox-open");
  }

  function openFullscreen(index) {
    if (!fullscreenEl || !visibleImages().length) return;
    if (typeof index === "number") state.index = index;
    state.fullscreen = true;
    fullscreenEl.hidden = false;
    document.body.classList.add("gallery-fs-open");
    updateFullscreen();
    updateLikeUI();
    if (fullscreenEl.requestFullscreen) {
      fullscreenEl.requestFullscreen().catch(function () {});
    } else if (fullscreenEl.webkitRequestFullscreen) {
      try {
        fullscreenEl.webkitRequestFullscreen();
      } catch (err) {}
    }
  }

  function closeFullscreen() {
    state.fullscreen = false;
    if (!fullscreenEl) return;
    fullscreenEl.hidden = true;
    if (fsImage) fsImage.removeAttribute("src");
    document.body.classList.remove("gallery-fs-open");
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
      try {
        document.webkitExitFullscreen();
      } catch (err) {}
    }
  }

  function sidecarActionsHtml() {
    return (
      '<button type="button" class="gallery-action-btn" data-action="export-sidecars" title="Download the current .gallapp_* sidecars (likes/classes/position)">Export sidecars</button>' +
      '<label class="gallery-action-btn gallery-import-sidecars" title="Load .gallapp_* text files into this session">' +
      "Import sidecars" +
      '<input type="file" hidden accept="text/plain,.txt,*/*" multiple data-action="import-sidecars">' +
      "</label>"
    );
  }

  function downloadLikedButtonHtml() {
    if (state.multi) {
      return (
        '<span class="gallery-liked-actions">' +
        '<button type="button" class="gallery-action-btn gallery-get-liked gallery-get-classified" data-action="download-classified" disabled>' +
        '<span class="gallery-like-label">Download classified</span> ' +
        '<span class="gallery-like-count">0</span>' +
        "</button>" +
        '<button type="button" class="gallery-action-btn" data-action="remove-classification" disabled>Remove classification</button>' +
        sidecarActionsHtml() +
        '<button type="button" class="gallery-action-btn" data-action="copy-status" title="Copy a URL that restores this gallery state">Copy status</button>' +
        "</span>"
      );
    }
    return (
      '<span class="gallery-liked-actions">' +
      '<button type="button" class="gallery-action-btn gallery-get-liked" data-action="download-liked" disabled>' +
      '<span class="gallery-like-label">Download liked</span> ' +
      '<span class="gallery-like-count">0</span>' +
      "</button>" +
      '<button type="button" class="gallery-action-btn" data-action="unlike-all" disabled>Unlike all</button>' +
      sidecarActionsHtml() +
      '<button type="button" class="gallery-action-btn" data-action="copy-status" title="Copy a URL that restores this gallery state">Copy status</button>' +
      "</span>"
    );
  }

  function renderHeader() {
    return (
      '<header class="gallery-hero">' +
      '<p class="gallery-eyebrow">Local directory</p>' +
      "<h1 class=\"gallery-repo-name\">" +
      escapeHtml(basenameDir(state.dir)) +
      "</h1>" +
      '<p class="gallery-meta"><span id="gallery-image-count"></span> · <code class="gallery-path">' +
      escapeHtml(state.dir) +
      "</code>" +
      (state.session
        ? ' · session <code class="gallery-session">' + escapeHtml(state.session) + "</code>"
        : " · default session") +
      ' · <span class="gallery-persist" title="' +
      (isSessionPersist()
        ? "Likes/classes are temporary .gallapp_* entities in this browser tab (sessionStorage). Export to keep them."
        : "Likes/classes are written as .gallapp_* files in the image folder.") +
      '">' +
      escapeHtml(persistLabel()) +
      "</span>" +
      (state.multi ? ' · <span class="gallery-mode-multi">multi class</span>' : "") +
      modeSwitchHtml() +
      "</p>" +
      '<label class="gallery-name-filter" for="gallery-name-filter">Filter' +
      '<input id="gallery-name-filter" type="text" spellcheck="false" autocomplete="off" value="' +
      escapeHtml(state.nameFilter) +
      '" title="Use * as a wildcard. *.* shows every file.">' +
      "</label>" +
      "</header>"
    );
  }

  function emptyVisibleMessage() {
    if (!state.images.length) return "This directory has no images.";
    var named = state.images.filter(function (img) {
      return nameMatchesFilter(img.name, state.nameFilter);
    });
    if (!named.length) return "No images match " + state.nameFilter + ".";
    if (state.multi) {
      if (state.classFilter === "none") {
        return "Every matching image is classified. Choose All to browse them.";
      }
      if (state.classFilter !== "all") {
        return (
          "No images in class " +
          state.classFilter +
          ". Choose All to browse and classify with Shift+<glyph>."
        );
      }
      return "No images match " + state.nameFilter + ".";
    }
    if (state.likeFilter === "liked") {
      return "No images have been liked yet. Choose All to browse and like images.";
    }
    if (state.likeFilter === "unliked") {
      return "Every matching image is liked. Choose All to browse them.";
    }
    return "No images match " + state.nameFilter + ".";
  }

  function filterRadiosHtml() {
    var html;
    var i;
    if (state.multi) {
      html =
        '<span class="gallery-like-filters gallery-class-filters" role="radiogroup" aria-label="Class filter">' +
        '<label class="gallery-filter"><input type="radio" name="gallery-class-filter" value="all"' +
        (state.classFilter === "all" ? " checked" : "") +
        "> All</label>" +
        '<label class="gallery-filter"><input type="radio" name="gallery-class-filter" value="none"' +
        (state.classFilter === "none" ? " checked" : "") +
        '> No class <span class="gallery-filter-count" data-class-slot="none">[' +
        nameFilteredUnclassifiedCount() +
        "]</span></label>";
      for (i = 1; i <= MAX_CLASS; i++) {
        html +=
          '<label class="gallery-filter gallery-filter-class" data-class-slot="' +
          i +
          '" style="--class-color:' +
          classColor(i) +
          '" title="' +
          escapeHtml(classShortcutHint(i)) +
          " · " +
          escapeHtml(classFilterCaption(i)) +
          '"><input type="radio" name="gallery-class-filter" value="' +
          i +
          '"' +
          (state.classFilter === String(i) ? " checked" : "") +
          "> " +
          escapeHtml(classDisplayWithGlyph(i)) +
          ' <span class="gallery-filter-count" data-class-slot="' +
          i +
          '">[' +
          classSlotCount(i) +
          "]</span></label>";
      }
      html +=
        '<button type="button" class="gallery-action-btn gallery-edit-classes" id="gallery-edit-classes" title="Edit class names and glyphs">Edit classes</button>';
      return html + "</span>";
    }
    return (
      '<span class="gallery-like-filters" role="radiogroup" aria-label="Like filter">' +
      '<label class="gallery-filter"><input type="radio" name="gallery-like-filter" value="all"' +
      (state.likeFilter === "all" ? " checked" : "") +
      "> All</label>" +
      '<label class="gallery-filter"><input type="radio" name="gallery-like-filter" value="liked"' +
      (state.likeFilter === "liked" ? " checked" : "") +
      "> Liked only</label>" +
      '<label class="gallery-filter"><input type="radio" name="gallery-like-filter" value="unliked"' +
      (state.likeFilter === "unliked" ? " checked" : "") +
      "> No like only</label>" +
      "</span>"
    );
  }

  function previewToolbarHtml() {
    return (
      '<div class="gallery-preview-toolbar">' +
      '<button type="button" class="gallery-nav-btn" id="gallery-first" aria-label="First image" title="First image">«</button>' +
      '<button type="button" class="gallery-nav-btn" id="gallery-prev" aria-label="Previous image" title="Previous image">‹</button>' +
      '<span class="gallery-counter" id="gallery-counter">' +
      '<input id="gallery-jump" class="gallery-jump" type="number" min="1" inputmode="numeric" aria-label="Go to image number">' +
      '<span class="gallery-counter-sep">/</span>' +
      '<span id="gallery-counter-total">0</span>' +
      "</span>" +
      '<button type="button" class="gallery-nav-btn" id="gallery-next" aria-label="Next image" title="Next image">›</button>' +
      '<button type="button" class="gallery-nav-btn" id="gallery-last" aria-label="Last image" title="Last image">»</button>' +
      filterRadiosHtml() +
      '<span class="gallery-hint">' +
      (state.multi
        ? "Use ← → to browse · Shift+<glyph> toggles classes · Shift+0 clears"
        : "Use ← → to browse · Shift+Space to like or unlike") +
      "</span>" +
      "</div>"
    );
  }

  function renderPreview() {
    var images = visibleImages();
    var filmstrip;
    var emptyMsg;
    if (!images.length) {
      emptyMsg = emptyVisibleMessage();
      if (!state.images.length) {
        return '<p class="gallery-empty">' + escapeHtml(emptyMsg) + "</p>";
      }
      // Keep filters/actions so Liked only / name filter can be cleared.
      return (
        '<section class="gallery-preview" aria-label="Image preview">' +
        previewToolbarHtml() +
        '<div class="gallery-preview-stage gallery-preview-stage-empty" id="gallery-preview-stage">' +
        '<p class="gallery-empty">' +
        escapeHtml(emptyMsg) +
        "</p>" +
        '<div class="gallery-preview-actions">' +
        downloadLikedButtonHtml() +
        "</div>" +
        "</div>" +
        "</section>"
      );
    }
    (function () {
      var win = filmstripWindow(images, state.index);
      var i;
      filmstrip = "";
      for (i = win.start; i < win.end; i++) {
        filmstrip += filmstripItemHtml(images[i], i, state.index);
      }
      state.filmstripStart = win.start;
      state.filmstripEnd = win.end;
    })();
    return (
      '<section class="gallery-preview" aria-label="Image preview">' +
      previewToolbarHtml() +
      '<div class="gallery-preview-stage" id="gallery-preview-stage">' +
      '<span class="gallery-liked-mark" hidden aria-hidden="true">★</span>' +
      '<span class="gallery-class-mark" hidden aria-hidden="true"></span>' +
      '<img id="gallery-preview-image" alt="" decoding="async">' +
      '<div class="gallery-preview-actions">' +
      '<button type="button" class="gallery-action-btn gallery-like-toggle" id="gallery-like" aria-pressed="false">' +
      (state.multi ? "No class" : "☆ Like") +
      "</button>" +
      '<button type="button" class="gallery-action-btn" id="gallery-view">View</button>' +
      '<button type="button" class="gallery-action-btn" id="gallery-download">Download</button>' +
      '<button type="button" class="gallery-action-btn" id="gallery-fit" aria-pressed="false">Fit to width</button>' +
      '<button type="button" class="gallery-action-btn" id="gallery-fullscreen">Fullscreen</button>' +
      downloadLikedButtonHtml() +
      "</div>" +
      '<p class="gallery-preview-name" id="gallery-preview-name"></p>' +
      "</div>" +
      '<div class="gallery-filmstrip" id="gallery-filmstrip" tabindex="0">' +
      filmstrip +
      "</div>" +
      "</section>"
    );
  }

  function renderGrid() {
    var images = visibleImages();
    var items;
    if (!state.showGrid || !images.length) return "";
    items = images
      .map(function (img, i) {
        var classList = state.multi ? classesOf(img) : [];
        var klass = classList.length ? classList[0] : 0;
        var label = classLabel(classList);
        var liked = !state.multi && isLiked(img);
        return (
          '<button type="button" class="gallery-grid-item' +
          (i === state.index ? " is-active" : "") +
          (liked ? " is-liked" : "") +
          (klass ? " is-classified" : "") +
          (classList.length > 1 ? " is-multiclass" : "") +
          '"' +
          (klass
            ? ' data-class="' +
              escapeHtml(label) +
              '" style="--class-color:' +
              classColor(klass) +
              '"'
            : "") +
          ' data-index="' +
          i +
          '" title="' +
          escapeHtml(
            img.name +
              (classList.length
                ? " · " + classNameLabel(classList) + " [" + label + "]"
                : "")
          ) +
          '">' +
          '<span class="gallery-grid-thumb">' +
          '<img src="' +
          escapeHtml(img.url) +
          '" alt="' +
          escapeHtml(img.name) +
          '" loading="lazy" decoding="async">' +
          (state.multi
            ? '<span class="gallery-class-btn' +
              (klass ? " is-classified" : "") +
              (classList.length > 1 ? " is-multiclass" : "") +
              '" role="button" tabindex="0" aria-pressed="' +
              (klass ? "true" : "false") +
              '" aria-label="' +
              (classList.length ? classNameLabel(classList) : "No class") +
              '" title="' +
              (classList.length
                ? classNameLabel(classList) + " [" + label + "] — click to clear all"
                : "Use Shift+<glyph> to add classes") +
              '" data-like-index="' +
              i +
              '"' +
              (klass
                ? ' data-class="' +
                  escapeHtml(label) +
                  '" style="--class-color:' +
                  classColor(klass) +
                  '"'
                : "") +
              ">" +
              (label || "·") +
              "</span>"
            : '<span class="gallery-like-btn' +
              (liked ? " is-liked" : "") +
              '" role="button" tabindex="0" aria-pressed="' +
              (liked ? "true" : "false") +
              '" aria-label="' +
              (liked ? "Unlike" : "Like") +
              '" title="' +
              (liked ? "Unlike" : "Like") +
              '" data-like-index="' +
              i +
              '">' +
              (liked ? "★" : "☆") +
              "</span>") +
          "</span>" +
          '<span class="gallery-grid-name">' +
          imageNameLinkHtml(img) +
          "</span>" +
          "</button>"
        );
      })
      .join("");
    return (
      '<section class="gallery-grid-section" id="gallery-grid-section" aria-label="All images">' +
      '<div class="gallery-grid-header">' +
      '<h2 class="gallery-section-heading">All images</h2>' +
      downloadLikedButtonHtml() +
      "</div>" +
      '<div class="gallery-grid" id="gallery-grid">' +
      items +
      "</div>" +
      "</section>"
    );
  }

  function bindSwipe(el) {
    var startX = 0;
    var startY = 0;
    var tracking = false;
    if (!el) return;
    el.addEventListener(
      "touchstart",
      function (event) {
        if (!event.touches || event.touches.length !== 1) return;
        if (event.target.closest("button, a, input, textarea, select, label")) return;
        tracking = true;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
      },
      { passive: true }
    );
    el.addEventListener("touchcancel", function () {
      tracking = false;
    });
    el.addEventListener(
      "touchend",
      function (event) {
        var endX, endY, dx, dy;
        if (!tracking) return;
        tracking = false;
        if (!event.changedTouches || !event.changedTouches.length) return;
        endX = event.changedTouches[0].clientX;
        endY = event.changedTouches[0].clientY;
        dx = endX - startX;
        dy = endY - startY;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) || Math.abs(dy) > 80) return;
        setIndex(state.index + (dx < 0 ? 1 : -1));
      },
      { passive: true }
    );
  }

  function onKeydown(event) {
    var key;
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    key = event.key;
    if (key === "Escape") {
      if (state.fullscreen) {
        closeFullscreen();
        return;
      }
      closeLightbox();
      return;
    }
    if (!visibleImages().length) return;
    if (key === "ArrowRight") {
      event.preventDefault();
      setIndex(state.index + 1);
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      setIndex(state.index - 1);
    } else if (key === "Home") {
      event.preventDefault();
      setIndex(0);
    } else if (key === "End") {
      event.preventDefault();
      setIndex(visibleImages().length - 1);
    } else if (
      state.multi &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.repeat
    ) {
      if (isClearClassShortcut(event)) {
        event.preventDefault();
        clearClass(state.index);
      } else if (slotFromGlyphEvent(event)) {
        event.preventDefault();
        assignClass(state.index, slotFromGlyphEvent(event));
      }
    } else if (
      !state.multi &&
      (key === "l" || key === "L") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      toggleLike(state.index);
    } else if (
      !state.multi &&
      (key === " " || event.code === "Space") &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.repeat
    ) {
      event.preventDefault();
      toggleLike(state.index);
    }
  }

  function bindGlobals() {
    if (globalsBound) return;
    globalsBound = true;
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("pagehide", flushPositionSave);
    window.addEventListener("beforeunload", flushPositionSave);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushPositionSave();
    });
    window.addEventListener("resize", placeLikedMarks);
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && state.fullscreen) closeFullscreen();
    });
    document.addEventListener("webkitfullscreenchange", function () {
      if (!document.webkitFullscreenElement && state.fullscreen) closeFullscreen();
    });
    if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
    if (lightbox) {
      lightbox.addEventListener("click", function (event) {
        if (event.target === lightbox) closeLightbox();
      });
    }
    if (fsLike) {
      fsLike.addEventListener("click", function (event) {
        event.stopPropagation();
        toggleLike(state.index);
      });
    }
    if (fsPrev) {
      fsPrev.addEventListener("click", function (event) {
        event.stopPropagation();
        setIndex(state.index - 1);
      });
    }
    if (fsNext) {
      fsNext.addEventListener("click", function (event) {
        event.stopPropagation();
        setIndex(state.index + 1);
      });
    }
    if (fsClose) {
      fsClose.addEventListener("click", function (event) {
        event.stopPropagation();
        closeFullscreen();
      });
    }
    bindSwipe(document.querySelector(".gallery-fs-stage"));
    bindSwipe(fullscreenEl);
    bindSwipe(lightbox);
  }

  function bindView(scope) {
    var prevBtn, nextBtn, likeBtn, viewBtn, downloadBtn, fitBtn, fullscreenBtn;
    var nameFilter, strip, grid, stage;
    scope = scope || "all";

    if (scope === "all" || scope === "preview") {
      prevBtn = document.getElementById("gallery-prev");
      nextBtn = document.getElementById("gallery-next");
      var firstBtn = document.getElementById("gallery-first");
      var lastBtn = document.getElementById("gallery-last");
      likeBtn = document.getElementById("gallery-like");
      viewBtn = document.getElementById("gallery-view");
      downloadBtn = document.getElementById("gallery-download");
      fitBtn = document.getElementById("gallery-fit");
      fullscreenBtn = document.getElementById("gallery-fullscreen");
      strip = document.getElementById("gallery-filmstrip");
      stage = document.getElementById("gallery-preview-stage");
      nameFilter = document.getElementById("gallery-name-filter");

      bindSwipe(stage);
      if (firstBtn) {
        firstBtn.addEventListener("click", function () { setIndex(0); });
      }
      if (prevBtn) prevBtn.addEventListener("click", function () { setIndex(state.index - 1); });
      if (nextBtn) nextBtn.addEventListener("click", function () { setIndex(state.index + 1); });
      if (lastBtn) {
        lastBtn.addEventListener("click", function () {
          var n = visibleImages().length;
          if (n) setIndex(n - 1);
        });
      }
      if (likeBtn) likeBtn.addEventListener("click", function () { toggleLike(state.index); });
      if (viewBtn) viewBtn.addEventListener("click", function () { openLightbox(state.index); });
      if (downloadBtn) {
        downloadBtn.addEventListener("click", function () {
          downloadImage(visibleImages()[state.index]);
        });
      }
      if (fitBtn) {
        fitBtn.addEventListener("click", function () {
          state.fitWidth = !state.fitWidth;
          applyFitWidth();
        });
      }
      if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", function () { openFullscreen(state.index); });
      }
      document.querySelectorAll('input[name="gallery-like-filter"]').forEach(function (radio) {
        radio.addEventListener("change", function () {
          var keep = currentImageName();
          var next, idx;
          if (!radio.checked) return;
          state.likeFilter = radio.value;
          invalidateVisible();
          next = visibleImages();
          idx = indexOfName(keep, next);
          state.index = idx >= 0 ? idx : 0;
          render();
          flushPositionSave();
        });
      });
      document.querySelectorAll('input[name="gallery-class-filter"]').forEach(function (radio) {
        radio.addEventListener("change", function () {
          var keep = currentImageName();
          var next, idx;
          if (!radio.checked) return;
          state.classFilter = radio.value;
          invalidateVisible();
          next = visibleImages();
          idx = indexOfName(keep, next);
          state.index = idx >= 0 ? idx : 0;
          render();
          flushPositionSave();
        });
      });
      (function bindEditClasses() {
        var btn = document.getElementById("gallery-edit-classes");
        if (!btn) return;
        btn.addEventListener("click", function () {
          openClassLabelEditor();
        });
      })();
      (function bindJump() {
        var jump = document.getElementById("gallery-jump");
        if (!jump) return;
        jump.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            jumpToNumber(jump.value);
            jump.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            updateCounterFields();
            jump.blur();
          }
        });
        jump.addEventListener("change", function () {
          jumpToNumber(jump.value);
        });
        jump.addEventListener("focus", function () {
          jump.select();
        });
      })();
      if (nameFilter) {
        nameFilter.addEventListener("input", function () {
          var caret = nameFilter.selectionStart;
          var current = visibleImages()[state.index];
          var currentName = current && current.name;
          var next, i, again;
          state.nameFilter = nameFilter.value;
          invalidateVisible();
          next = visibleImages();
          state.index = 0;
          if (currentName) {
            for (i = 0; i < next.length; i++) {
              if (next[i].name === currentName) {
                state.index = i;
                break;
              }
            }
          }
          render();
          again = document.getElementById("gallery-name-filter");
          if (again) {
            again.focus();
            if (typeof caret === "number") again.setSelectionRange(caret, caret);
          }
        });
      }
      document.querySelectorAll('[data-action="download-liked"]').forEach(function (btn) {
        if (btn.closest("#gallery-grid-section")) return;
        btn.addEventListener("click", function () { downloadLiked(); });
      });
      document.querySelectorAll('[data-action="download-classified"]').forEach(function (btn) {
        if (btn.closest("#gallery-grid-section")) return;
        btn.addEventListener("click", function () { downloadClassified(); });
      });
      document.querySelectorAll('[data-action="unlike-all"]').forEach(function (btn) {
        if (btn.closest("#gallery-grid-section")) return;
        btn.addEventListener("click", unlikeAll);
      });
      document.querySelectorAll('[data-action="remove-classification"]').forEach(function (btn) {
        if (btn.closest("#gallery-grid-section")) return;
        btn.addEventListener("click", removeAllClassifications);
      });
      document.querySelectorAll('[data-action="copy-status"]').forEach(function (btn) {
        if (btn.closest("#gallery-grid-section")) return;
        btn.addEventListener("click", copyStatus);
      });
      document.querySelectorAll('[data-action="export-sidecars"]').forEach(function (btn) {
        if (btn.closest("#gallery-grid-section")) return;
        btn.addEventListener("click", function () {
          exportSessionSidecars();
        });
      });
      document.querySelectorAll('input[data-action="import-sidecars"]').forEach(function (input) {
        if (input.closest("#gallery-grid-section")) return;
        input.addEventListener("change", function () {
          var list = input.files;
          input.value = "";
          importSessionSidecars(list);
        });
      });
      if (strip) {
        strip.addEventListener("click", function (event) {
          var item = event.target.closest("[data-index]");
          if (!item) return;
          setIndex(Number(item.getAttribute("data-index")));
        });
      }
    }

    if (scope === "all" || scope === "grid") {
      grid = document.getElementById("gallery-grid");
      if (!grid) return;
      document.querySelectorAll("#gallery-grid-section [data-action='download-liked']").forEach(function (btn) {
        btn.addEventListener("click", function () { downloadLiked(); });
      });
      document.querySelectorAll("#gallery-grid-section [data-action='download-classified']").forEach(function (btn) {
        btn.addEventListener("click", function () { downloadClassified(); });
      });
      document.querySelectorAll("#gallery-grid-section [data-action='unlike-all']").forEach(function (btn) {
        btn.addEventListener("click", unlikeAll);
      });
      document.querySelectorAll("#gallery-grid-section [data-action='remove-classification']").forEach(function (btn) {
        btn.addEventListener("click", removeAllClassifications);
      });
      document.querySelectorAll("#gallery-grid-section [data-action='copy-status']").forEach(function (btn) {
        btn.addEventListener("click", copyStatus);
      });
      document.querySelectorAll("#gallery-grid-section [data-action='export-sidecars']").forEach(function (btn) {
        btn.addEventListener("click", function () {
          exportSessionSidecars();
        });
      });
      document
        .querySelectorAll("#gallery-grid-section input[data-action='import-sidecars']")
        .forEach(function (input) {
          input.addEventListener("change", function () {
            var list = input.files;
            input.value = "";
            importSessionSidecars(list);
          });
        });
      grid.addEventListener("click", function (event) {
        var like = event.target.closest(".gallery-like-btn, .gallery-class-btn");
        var item;
        var preview;
        if (like) {
          event.preventDefault();
          event.stopPropagation();
          toggleLike(Number(like.getAttribute("data-like-index")));
          return;
        }
        if (event.target.closest("a")) return;
        item = event.target.closest("[data-index]");
        if (!item) return;
        setIndex(Number(item.getAttribute("data-index")));
        preview = document.querySelector(".gallery-preview");
        if (preview) preview.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.addEventListener("keydown", function (event) {
        var like =
          event.target.closest &&
          event.target.closest(".gallery-like-btn, .gallery-class-btn");
        if (!like) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          toggleLike(Number(like.getAttribute("data-like-index")));
        }
      });
    }
  }

  function render() {
    var images = visibleImages();
    var gridHtml;
    if (state.index >= images.length) state.index = 0;
    setStatus("");
    // Paint the preview first so arrow navigation works before the
    // full thumbnail grid (thousands of nodes) is inserted.
    rootEl.innerHTML = renderHeader() + renderPreview();
    document.title = basenameDir(state.dir) + " — Gallery App";
    bindView("preview");
    applyStripHeight();
    if (images.length) {
      updatePreview();
      applyFitWidth();
      updateCurrentLikeUI();
      prefetchAround(images, state.index);
    } else {
      updateCounterFields(images);
      updateCurrentLikeUI();
    }
    gridHtml = renderGrid();
    if (gridHtml) {
      requestAnimationFrame(function () {
        var section = document.createElement("div");
        section.innerHTML = gridHtml;
        while (section.firstChild) rootEl.appendChild(section.firstChild);
        bindView("grid");
        updateGridActive();
        updateItemLikeUI(state.index);
      });
    }
  }

  function showIntro() {
    var recent = loadRecent();
    var slot;
    document.title = "Gallery App";
    rootEl.innerHTML = "";
    if (introTemplate) rootEl.appendChild(introTemplate.content.cloneNode(true));
    slot = document.getElementById("gallery-recent");
    if (slot && recent.length) {
      slot.innerHTML =
        '<h2>Recent directories</h2><ul>' +
        recent
          .map(function (dir) {
            return (
              '<li><a href="?dir=' +
              encodeURIComponent(dir) +
              '">' +
              escapeHtml(dir) +
              "</a></li>"
            );
          })
          .join("") +
        "</ul>";
    }
  }

  function openDir(dir, session, options) {
    var sid;
    var url;
    var win;
    options = options || {};
    if (dir == null) {
      setStatus("The path cannot contain \"..\" or move above the server root.", true);
      return;
    }
    if (!dir) {
      window.location.assign(window.location.pathname);
      return;
    }
    sid = parseSessionId(session);
    if (sid === null) {
      setStatus(
        sessionNameError(session) ||
          "Invalid session name. Use letters, digits, _ or - only.",
        true
      );
      return;
    }
    url = galleryUrl(dir, sid);
    if (options.newWindow) {
      win = window.open(url, "_blank", "noopener,noreferrer");
      if (!win) {
        setStatus("Could not open a new window. Allow pop-ups for this site, or open: " + url, true);
      }
      return;
    }
    window.location.assign(url);
  }

  function askSessionName() {
    var modal = document.getElementById("session-modal");
    var input = document.getElementById("session-modal-input");
    var errorEl = document.getElementById("session-modal-error");
    var confirmBtn = document.getElementById("session-modal-confirm");
    if (!modal || !input || !confirmBtn) {
      return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      var settled = false;

      function setError(message) {
        if (!errorEl) return;
        if (message) {
          errorEl.textContent = message;
          errorEl.hidden = false;
          input.classList.add("is-invalid");
        } else {
          errorEl.textContent = "";
          errorEl.hidden = true;
          input.classList.remove("is-invalid");
        }
      }

      function finish(value) {
        if (settled) return;
        settled = true;
        modal.hidden = true;
        document.removeEventListener("keydown", onKeydown, true);
        modal.removeEventListener("click", onClick);
        confirmBtn.removeEventListener("click", onConfirm);
        input.removeEventListener("input", onInput);
        resolve(value);
      }

      function onConfirm() {
        var err = sessionNameError(input.value);
        if (err) {
          setError(err);
          input.focus();
          input.select();
          return;
        }
        finish(String(input.value).trim());
      }

      function onClick(event) {
        if (event.target && event.target.hasAttribute("data-session-modal-dismiss")) {
          finish(null);
        }
      }

      function onKeydown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
          return;
        }
        if (event.key === "Enter" && event.target === input) {
          event.preventDefault();
          onConfirm();
        }
      }

      function onInput() {
        if (errorEl && !errorEl.hidden) setError("");
      }

      setError("");
      input.value = "";
      modal.hidden = false;
      modal.addEventListener("click", onClick);
      confirmBtn.addEventListener("click", onConfirm);
      input.addEventListener("input", onInput);
      document.addEventListener("keydown", onKeydown, true);
      requestAnimationFrame(function () {
        input.focus();
      });
    });
  }

  function classLabelFormError(name, glyph, slot) {
    var n = String(name == null ? "" : name).trim();
    var g = String(glyph == null ? "" : glyph).trim();
    var conflict;
    if (!n) return "Enter a class name.";
    if (/\s/.test(n)) return "Class names must be a single word (no spaces).";
    if (!CLASS_NAME_RE.test(n)) {
      return "Class names must start with a letter and use only letters, digits, _ or -.";
    }
    if (!g) return "Enter a glyph (one letter or digit).";
    if (!CLASS_GLYPH_RE.test(g)) return "Glyph must be a single letter or digit.";
    conflict = glyphConflict(slot, g);
    if (conflict) return conflict;
    return "";
  }

  function refreshClassModalList() {
    var listEl = document.getElementById("class-modal-list");
    var i;
    var def;
    if (!listEl) return;
    ensureClassDefs();
    listEl.innerHTML = "";
    for (i = 1; i <= MAX_CLASS; i++) {
      def = state.classDefs[i];
      listEl.innerHTML +=
        "<li><code>" +
        escapeHtml(classShortcutHint(i)) +
        "</code> · <strong>" +
        escapeHtml(classDisplayWithGlyph(i)) +
        '</strong> <span class="gallery-class-glyph-sample" style="--class-color:' +
        classColor(i) +
        '">' +
        escapeHtml(classGlyph(i)) +
        "</span></li>";
    }
  }

  function fillClassModalFields(slot) {
    var nameInput = document.getElementById("class-modal-name");
    var glyphInput = document.getElementById("class-modal-glyph");
    var def;
    ensureClassDefs();
    def = state.classDefs[slot] || { name: "class" + slot, glyph: String(slot) };
    if (nameInput) nameInput.value = def.name === "class" + slot ? "" : def.name;
    if (glyphInput) glyphInput.value = def.glyph === String(slot) ? "" : def.glyph;
  }

  function openClassLabelEditor() {
    var modal = document.getElementById("class-modal");
    var slotSelect = document.getElementById("class-modal-slot");
    var nameInput = document.getElementById("class-modal-name");
    var glyphInput = document.getElementById("class-modal-glyph");
    var errorEl = document.getElementById("class-modal-error");
    var confirmBtn = document.getElementById("class-modal-confirm");
    var i;
    if (!modal || !slotSelect || !nameInput || !glyphInput || !confirmBtn) return;

    function setError(message) {
      if (!errorEl) return;
      if (message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        nameInput.classList.add("is-invalid");
        glyphInput.classList.add("is-invalid");
      } else {
        errorEl.textContent = "";
        errorEl.hidden = true;
        nameInput.classList.remove("is-invalid");
        glyphInput.classList.remove("is-invalid");
      }
    }

    function close() {
      modal.hidden = true;
      document.removeEventListener("keydown", onKeydown, true);
      modal.removeEventListener("click", onClick);
      confirmBtn.removeEventListener("click", onConfirm);
      slotSelect.removeEventListener("change", onSlotChange);
      nameInput.removeEventListener("input", onInput);
      glyphInput.removeEventListener("input", onInput);
    }

    function onSlotChange() {
      fillClassModalFields(parseInt(slotSelect.value, 10));
      setError("");
    }

    async function onConfirm() {
      var slot = parseInt(slotSelect.value, 10);
      var name = String(nameInput.value || "").trim();
      var glyph = String(glyphInput.value || "").trim();
      var err = classLabelFormError(name, glyph, slot);
      if (err) {
        setError(err);
        return;
      }
      ensureClassDefs();
      state.classDefs[slot] = { name: name, glyph: glyph };
      confirmBtn.disabled = true;
      if (!(await saveClassDefs())) {
        confirmBtn.disabled = false;
        return;
      }
      confirmBtn.disabled = false;
      close();
      render();
      showToast("Class label saved");
    }

    function onClick(event) {
      if (event.target && event.target.hasAttribute("data-class-modal-dismiss")) {
        close();
      }
    }

    function onKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (
        event.key === "Enter" &&
        (event.target === nameInput || event.target === glyphInput)
      ) {
        event.preventDefault();
        onConfirm();
      }
    }

    function onInput() {
      if (errorEl && !errorEl.hidden) setError("");
    }

    slotSelect.innerHTML = "";
    for (i = 1; i <= MAX_CLASS; i++) {
      slotSelect.innerHTML +=
        '<option value="' +
        i +
        '">' +
        escapeHtml(classShortcutHint(i)) +
        " · " +
        escapeHtml(classDisplayWithGlyph(i)) +
        "</option>";
    }
    if (state.classFilter !== "all" && state.classFilter !== "none") {
      slotSelect.value = state.classFilter;
    } else {
      slotSelect.value = "1";
    }
    fillClassModalFields(parseInt(slotSelect.value, 10));
    refreshClassModalList();
    setError("");
    modal.hidden = false;
    modal.addEventListener("click", onClick);
    confirmBtn.addEventListener("click", onConfirm);
    slotSelect.addEventListener("change", onSlotChange);
    nameInput.addEventListener("input", onInput);
    glyphInput.addEventListener("input", onInput);
    document.addEventListener("keydown", onKeydown, true);
    requestAnimationFrame(function () {
      nameInput.focus();
      nameInput.select();
    });
  }

  async function startNewSession() {
    var dir = normalizeDir(dirInput ? dirInput.value : "");
    var sid;
    if (dir == null) {
      setStatus("The path cannot contain \"..\" or move above the server root.", true);
      return;
    }
    if (!dir) {
      setStatus("Enter a directory path before creating a session.", true);
      if (dirInput) dirInput.focus();
      return;
    }
    sid = await askSessionName();
    if (!sid) return;
    if (newSessionBtn) newSessionBtn.disabled = true;
    setStatus("Opening session \"" + sid + "\" for " + dir + "…");
    openDir(dir, sid, { newWindow: true });
    if (newSessionBtn) newSessionBtn.disabled = false;
    setStatus("");
  }

  async function loadDirectory(dir) {
    var url = directoryUrl(dir);
    var res, type, html, images;
    state.dir = dir;
    if (dirInput) dirInput.value = dir;
    syncSessionInput();
    setStatus(
      "Loading images from " +
        dir +
        (state.session ? " (session " + state.session + ")" : "") +
        "…"
    );
    await detectPersistMode();
    document.title =
      basenameDir(dir) +
      (state.session ? " · " + state.session : "") +
      " — Gallery App";
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (err) {
      showIntro();
      setStatus(
        "Could not read the directory. Open Gallery App through the HTTP server (http://localhost:…/gallapp/), not as a file.",
        true
      );
      return;
    }
    if (!res.ok) {
      showIntro();
      setStatus(
        "Could not find \"" +
          dir +
          "\". The path is relative to the folder where you started the server.",
        true
      );
      return;
    }
    type = res.headers.get("content-type") || "";
    html = await res.text();
    if (type.indexOf("html") === -1 && html.indexOf("<a ") === -1) {
      showIntro();
      setStatus("\"" + dir + "\" is not a directory.", true);
      return;
    }
    images = imagesFromListing(html, url);
    state.images = images;
    invalidateVisible();
    state.index = 0;
    state.filmstripStart = -1;
    state.filmstripEnd = -1;
    if (state.multi) {
      await loadClassDefs();
      await loadMulti();
    } else {
      await loadLikes();
    }
    invalidateVisible();
    if (state.startFromQuery != null) {
      (function applyStartFromQuery() {
        var images = visibleImages();
        var idx = state.startFromQuery - 1;
        if (!images.length) {
          state.index = 0;
          return;
        }
        if (idx < 0) idx = 0;
        if (idx >= images.length) idx = images.length - 1;
        state.index = idx;
      })();
      state.startFromQuery = null;
    } else {
      (function restorePosition(savedName) {
        var visible = visibleImages();
        var idx = indexOfName(savedName, visible);
        // If a class/like filter hides the saved image, widen the filter so
        // resume still lands on it.
        if (idx < 0 && savedName) {
          if (state.multi && state.classFilter !== "all") {
            state.classFilter = "all";
            invalidateVisible();
            visible = visibleImages();
            idx = indexOfName(savedName, visible);
          } else if (!state.multi && state.likeFilter !== "all") {
            state.likeFilter = "all";
            invalidateVisible();
            visible = visibleImages();
            idx = indexOfName(savedName, visible);
          }
        }
        state.index = idx >= 0 ? idx : 0;
      })(await loadPosition());
    }
    if (state.session) {
      if (!(await ensureSessionSidecars())) {
        showIntro();
        return;
      }
    }
    rememberDir(dir);
    if (!images.length) {
      rootEl.innerHTML = renderHeader();
      updateCurrentLikeUI();
      setStatus("No images in " + dir + ".", true);
      return;
    }
    render();
    syncUrlState();
    savePositionNow();
  }

  function boot() {
    var dir;
    bindGlobals();
    applyQueryOptions();
    if (dirForm) {
      dirForm.addEventListener("submit", function (event) {
        event.preventDefault();
        openDir(
          normalizeDir(dirInput ? dirInput.value : ""),
          sessionInput ? sessionInput.value : state.session
        );
      });
    }
    if (newSessionBtn) {
      newSessionBtn.addEventListener("click", function () {
        startNewSession();
      });
    }
    if (window.location.protocol === "file:") {
      showIntro();
      setStatus(
        "This page was opened as a file. Start the server with python3 gallapp/server.py and open http://localhost:8000/gallapp/.",
        true
      );
      return;
    }
    dir = normalizeDir(queryDir());
    if (dir == null) {
      showIntro();
      setStatus("The path cannot contain \"..\" or move above the server root.", true);
      return;
    }
    if (!dir) {
      showIntro();
      if (dirInput) dirInput.focus();
      return;
    }
    loadDirectory(dir);
  }

  boot();
  root.Gallapp = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
