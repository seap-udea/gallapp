(function (root) {
  "use strict";

  var IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif)$/i;
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
  var state = {
    dir: "",
    images: [],
    index: 0,
    liked: {},
    likeFilter: "all",
    nameFilter: "*.*",
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

  function queryDir() {
    return new URLSearchParams(window.location.search).get("dir") || "";
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
    return "gallapp-likes:" + state.dir;
  }

  function positionStorageKey() {
    return "gallapp-position:" + state.dir;
  }

  function likesFileUrl() {
    return directoryUrl(state.dir) + ".gallapp_likes";
  }

  function positionFileUrl() {
    return directoryUrl(state.dir) + ".gallapp_position";
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

  function loadLikesFromStorage() {
    state.liked = {};
    try {
      var list = JSON.parse(window.localStorage.getItem(likeStorageKey()) || "[]");
      if (Array.isArray(list)) {
        list.forEach(function (name) {
          state.liked[String(name)] = true;
        });
      }
    } catch (err) {}
  }

  function saveLikesToStorage() {
    try {
      window.localStorage.setItem(likeStorageKey(), JSON.stringify(Object.keys(state.liked)));
    } catch (err) {}
  }

  async function loadLikes() {
    state.liked = {};
    state.likesInFile = false;
    try {
      var res = await fetch(likesFileUrl(), { cache: "no-store" });
      if (res.ok) {
        applyLikesText(await res.text());
        state.likesInFile = true;
        return;
      }
    } catch (err) {}
    loadLikesFromStorage();
  }

  function saveLikes() {
    var body = likesText();
    var dir = state.dir;
    var url = likesFileUrl();
    state.likeSave = Promise.resolve(state.likeSave)
      .catch(function () {})
      .then(function () {
        if (dir !== state.dir) return;
        return fetch(url, {
          method: "PUT",
          cache: "no-store",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: body,
        }).then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          state.likesInFile = true;
        });
      })
      .catch(function () {
        if (dir !== state.dir) return;
        saveLikesToStorage();
        if (!state.likesSaveWarned) {
          state.likesSaveWarned = true;
          setStatus(
            "Could not write .gallapp_likes. Start with python3 gallapp/server.py so likes are saved in the image folder.",
            true
          );
        }
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

  async function loadPosition() {
    var name = "";
    try {
      var res = await fetch(positionFileUrl(), { cache: "no-store" });
      if (res.ok) {
        name = String(await res.text())
          .split(/\r?\n/)
          .map(function (line) {
            return line.trim();
          })
          .filter(function (line) {
            return line && line.charAt(0) !== "#";
          })[0] || "";
      }
    } catch (err) {}
    if (!name) {
      try {
        name = window.localStorage.getItem(positionStorageKey()) || "";
      } catch (err) {}
    }
    return name;
  }

  function savePositionNow() {
    var name = currentImageName();
    var dir = state.dir;
    var url = positionFileUrl();
    if (!name || !dir) return;
    try {
      window.localStorage.setItem(positionStorageKey(), name);
    } catch (err) {}
    state.positionSave = Promise.resolve(state.positionSave)
      .catch(function () {})
      .then(function () {
        if (dir !== state.dir) return;
        return fetch(url, {
          method: "PUT",
          cache: "no-store",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: name + "\n",
        }).then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
        });
      })
      .catch(function () {});
  }

  function savePosition() {
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(function () {
      positionSaveTimer = null;
      savePositionNow();
    }, 250);
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

  function invalidateVisible() {
    state.visibleCache = null;
  }

  function visibleImages() {
    if (state.visibleCache) return state.visibleCache;
    var list = state.images.filter(function (img) {
      return nameMatchesFilter(img.name, state.nameFilter);
    });
    if (state.likeFilter === "liked") list = list.filter(isLiked);
    else if (state.likeFilter === "unliked") {
      list = list.filter(function (img) {
        return !isLiked(img);
      });
    }
    state.visibleCache = list;
    return list;
  }

  function likedImages() {
    return state.images.filter(isLiked);
  }

  function likedCount() {
    return Object.keys(state.liked).length;
  }

  function filmstripWindow(images, index) {
    var start = Math.max(0, index - FILMSTRIP_RADIUS);
    var end = Math.min(images.length, index + FILMSTRIP_RADIUS + 1);
    return { start: start, end: end };
  }

  function filmstripItemHtml(img, i, activeIndex) {
    return (
      '<button type="button" class="gallery-filmstrip-item' +
      (i === activeIndex ? " is-active" : "") +
      (isLiked(img) ? " is-liked" : "") +
      '" data-index="' +
      i +
      '" title="' +
      escapeHtml(img.name) +
      '">' +
      '<img src="' +
      escapeHtml(img.url) +
      '" alt="" loading="lazy" decoding="async">' +
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
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.setAttribute("title", label);
    if (withLabel) {
      el.textContent = on ? "★ Liked" : "☆ Like";
    } else {
      el.setAttribute("aria-label", label);
      el.textContent = on ? "★" : "☆";
    }
  }

  function downloadLabel(count) {
    if (state.downloading) return state.progress || "Preparing…";
    if (count > 1) return "Download liked (.zip)";
    return "Download liked";
  }

  function updateLikedActions(count) {
    document.querySelectorAll('[data-action="unlike-all"]').forEach(function (btn) {
      btn.disabled = count === 0;
      btn.title = count ? "Remove every like in this directory" : "No liked images";
    });
    document.querySelectorAll('[data-action="download-liked"]').forEach(function (btn) {
      btn.disabled = count === 0 || state.downloading;
      btn.title = count
        ? count === 1
          ? "Download the liked image"
          : "Download the " + count + " liked images as a .zip"
        : "Like an image first";
      var countEl = btn.querySelector(".gallery-like-count");
      if (countEl) countEl.textContent = String(count);
      var labelEl = btn.querySelector(".gallery-like-label");
      if (labelEl) labelEl.textContent = downloadLabel(count);
    });
    var countLine = document.getElementById("gallery-image-count");
    if (countLine) {
      var total = state.images.length;
      countLine.textContent =
        total +
        (total === 1 ? " image" : " images") +
        " · " +
        count +
        " liked";
    }
  }

  function updateCurrentLikeUI() {
    var images = visibleImages();
    var current = images[state.index];
    var on = isLiked(current);
    setLikeButton(document.getElementById("gallery-like"), on, true);
    setLikeButton(fsLike, on, false);
    document.querySelectorAll(".gallery-liked-mark").forEach(function (el) {
      el.hidden = !on;
    });
    placeLikedMarks();
    updateLikedActions(likedCount());
  }

  function updateItemLikeUI(index) {
    var images = visibleImages();
    var img = images[index];
    var on = isLiked(img);
    var gridItem = document.querySelector(
      '#gallery-grid .gallery-grid-item[data-index="' + index + '"]'
    );
    var stripItem = document.querySelector(
      '#gallery-filmstrip .gallery-filmstrip-item[data-index="' + index + '"]'
    );
    if (gridItem) {
      gridItem.classList.toggle("is-liked", on);
      setLikeButton(gridItem.querySelector(".gallery-like-btn"), on, false);
    }
    if (stripItem) stripItem.classList.toggle("is-liked", on);
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
    return base.replace(/[^\w.-]+/g, "_") + "-liked.zip";
  }

  async function downloadLiked() {
    var list = likedImages();
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

  function unlikeAll() {
    if (!likedCount()) return;
    state.liked = {};
    saveLikes();
    invalidateVisible();
    state.index = 0;
    render();
  }

  function likeFilterActive() {
    return state.likeFilter === "liked" || state.likeFilter === "unliked";
  }

  function toggleLike(index) {
    var img = visibleImages()[index];
    var next;
    if (!img) return;
    if (state.liked[img.name]) delete state.liked[img.name];
    else state.liked[img.name] = true;
    saveLikes();
    if (likeFilterActive()) {
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
    state.index = ((next % n) + n) % n;
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
      ["#gallery-lightbox .gallery-liked-mark", "lightbox-image"],
      ["#gallery-fullscreen .gallery-liked-mark", "fs-image"],
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

  function downloadLikedButtonHtml() {
    return (
      '<span class="gallery-liked-actions">' +
      '<button type="button" class="gallery-action-btn gallery-get-liked" data-action="download-liked" disabled>' +
      '<span class="gallery-like-label">Download liked</span> ' +
      '<span class="gallery-like-count">0</span>' +
      "</button>" +
      '<button type="button" class="gallery-action-btn" data-action="unlike-all" disabled>Unlike all</button>' +
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
      "</code></p>" +
      '<label class="gallery-name-filter" for="gallery-name-filter">Filter' +
      '<input id="gallery-name-filter" type="text" spellcheck="false" autocomplete="off" value="' +
      escapeHtml(state.nameFilter) +
      '" title="Use * as a wildcard. *.* shows every file.">' +
      "</label>" +
      "</header>"
    );
  }

  function renderPreview() {
    var images = visibleImages();
    var filmstrip;
    if (!images.length) {
      return (
        '<p class="gallery-empty">' +
        (function () {
          if (!state.images.length) return "This directory has no images.";
          var named = state.images.filter(function (img) {
            return nameMatchesFilter(img.name, state.nameFilter);
          });
          if (!named.length) return "No images match " + state.nameFilter + ".";
          if (state.likeFilter === "liked") return "No images have been liked yet.";
          if (state.likeFilter === "unliked") return "Every matching image is liked.";
          return "No images match " + state.nameFilter + ".";
        })() +
        "</p>"
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
      '<div class="gallery-preview-toolbar">' +
      '<button type="button" class="gallery-nav-btn" id="gallery-prev" aria-label="Previous image">‹</button>' +
      '<span class="gallery-counter" id="gallery-counter">' +
      '<input id="gallery-jump" class="gallery-jump" type="number" min="1" inputmode="numeric" aria-label="Go to image number">' +
      '<span class="gallery-counter-sep">/</span>' +
      '<span id="gallery-counter-total">0</span>' +
      "</span>" +
      '<button type="button" class="gallery-nav-btn" id="gallery-next" aria-label="Next image">›</button>' +
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
      "</span>" +
      '<span class="gallery-hint">Use ← → to browse · Shift+Space to like or unlike</span>' +
      "</div>" +
      '<div class="gallery-preview-stage" id="gallery-preview-stage">' +
      '<span class="gallery-liked-mark" hidden aria-hidden="true">★</span>' +
      '<img id="gallery-preview-image" alt="" decoding="async">' +
      '<div class="gallery-preview-actions">' +
      '<button type="button" class="gallery-action-btn gallery-like-toggle" id="gallery-like" aria-pressed="false">☆ Like</button>' +
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
    if (!images.length) return "";
    items = images
      .map(function (img, i) {
        return (
          '<button type="button" class="gallery-grid-item' +
          (i === state.index ? " is-active" : "") +
          (isLiked(img) ? " is-liked" : "") +
          '" data-index="' +
          i +
          '" title="' +
          escapeHtml(img.name) +
          '">' +
          '<span class="gallery-grid-thumb">' +
          '<img src="' +
          escapeHtml(img.url) +
          '" alt="' +
          escapeHtml(img.name) +
          '" loading="lazy" decoding="async">' +
          '<span class="gallery-like-btn" role="button" tabindex="0" data-like-index="' +
          i +
          '">☆</span>' +
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
    } else if ((key === "l" || key === "L") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      toggleLike(state.index);
    } else if (
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
      likeBtn = document.getElementById("gallery-like");
      viewBtn = document.getElementById("gallery-view");
      downloadBtn = document.getElementById("gallery-download");
      fitBtn = document.getElementById("gallery-fit");
      fullscreenBtn = document.getElementById("gallery-fullscreen");
      strip = document.getElementById("gallery-filmstrip");
      stage = document.getElementById("gallery-preview-stage");
      nameFilter = document.getElementById("gallery-name-filter");

      bindSwipe(stage);
      if (prevBtn) prevBtn.addEventListener("click", function () { setIndex(state.index - 1); });
      if (nextBtn) nextBtn.addEventListener("click", function () { setIndex(state.index + 1); });
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
          savePosition();
        });
      });
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
      document.querySelectorAll('[data-action="unlike-all"]').forEach(function (btn) {
        if (btn.closest("#gallery-grid-section")) return;
        btn.addEventListener("click", unlikeAll);
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
      document.querySelectorAll("#gallery-grid-section [data-action='unlike-all']").forEach(function (btn) {
        btn.addEventListener("click", unlikeAll);
      });
      grid.addEventListener("click", function (event) {
        var like = event.target.closest(".gallery-like-btn");
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
        var like = event.target.closest && event.target.closest(".gallery-like-btn");
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
    if (images.length) {
      updatePreview();
      applyFitWidth();
      updateCurrentLikeUI();
      prefetchAround(images, state.index);
    } else {
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

  function openDir(dir) {
    if (dir == null) {
      setStatus("The path cannot contain \"..\" or move above the server root.", true);
      return;
    }
    if (!dir) {
      window.location.assign(window.location.pathname);
      return;
    }
    window.location.assign(window.location.pathname + "?dir=" + encodeURIComponent(dir));
  }

  async function loadDirectory(dir) {
    var url = directoryUrl(dir);
    var res, type, html, images;
    state.dir = dir;
    if (dirInput) dirInput.value = dir;
    setStatus("Loading images from " + dir + "…");
    document.title = basenameDir(dir) + " — Gallery App";
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
          "\". The path is relative to the folder where you started the server (code).",
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
    await loadLikes();
    (function restorePosition(savedName) {
      var idx = indexOfName(savedName, visibleImages());
      state.index = idx >= 0 ? idx : 0;
    })(await loadPosition());
    rememberDir(dir);
    if (!images.length) {
      rootEl.innerHTML = renderHeader();
      updateCurrentLikeUI();
      setStatus("No images in " + dir + ".", true);
      return;
    }
    render();
  }

  function boot() {
    var dir;
    bindGlobals();
    if (dirForm) {
      dirForm.addEventListener("submit", function (event) {
        event.preventDefault();
        openDir(normalizeDir(dirInput ? dirInput.value : ""));
      });
    }
    if (window.location.protocol === "file:") {
      showIntro();
      setStatus(
        "This page was opened as a file. Start the server in code and open http://localhost:8000/gallapp/.",
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
