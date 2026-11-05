# Gallery App

Gallery App is a small static gallery for reviewing images in a local directory. Open a folder served by a local HTTP server, like the images you want to keep, and download that selection. One liked image downloads as itself. Several liked images are packed into a `.zip`.

It follows the interaction of the [SEAP-UdeA gallery](https://seap-udea.github.io/gallery/), which browses figures in a GitHub repository. Gallery App browses a directory on the machine that is serving the page.

## Run it

The page has to be opened through an HTTP server. Opening `index.html` as a file cannot list a directory.

Start the server in the folder that should be the site root — the folder that contains both `gallapp/` and the image directories you want to browse:

```bash
cd /path/to/site-root
python3 gallapp/server.py
```

That server lists directories the same way as `python3 -m http.server`, and it is what writes likes and position to disk. It listens on `127.0.0.1` port `8000`. Pass another port as the argument (`python3 gallapp/server.py 8080`).

Then open:

```text
http://localhost:8000/gallapp/
```

Type a directory path relative to the server root and press **Open** (default session). For example:

```text
images/my-folder
```

The same folder can be opened directly:

```text
http://localhost:8000/gallapp/?dir=images/my-folder
```

**Sessions.** Several people can review the same directory with separate likes and resume positions.

1. Enter the directory path.
2. Press **New session** beside **Open**.
3. In the on-page dialog, type a **session name**: letters, digits, `_`, or `-` only (no spaces; max 40 characters). Examples: `alice`, `review_1`, `team-b`.
4. Confirm **Open session** — Gallery App opens that session in a **new browser tab**.

Likes and last-viewed position are stored per session in the image folder. Share the tab URL (or use **Copy status**) so others join the same named session. **Open** without a session uses the **default** session. Reusing an existing name rejoins that session.

```text
http://localhost:8000/gallapp/?dir=images/my-folder&session=alice
```

## Features

- **Browse.** Large preview, horizontal filmstrip, and optional thumbnail grid. Move with the arrows, first/last, swipe, or the counter field.
- **Named sessions.** **New session** opens an on-page name dialog, then a new tab for that session. Each name gets its own likes/classifications and position files. Omit `session` for the default session.
- **Like / unlike** (default mode). Mark images with **Like**, the star on a thumbnail, `L`, or Shift+Space. Liked images show a gold star and a thick border. **Unlike all** clears every like in the current session.
- **Like filters** (default mode). Radios **All**, **Liked only**, and **No like only**.
- **Multi-class mode** (`multi=true`). Open it from the **Multi classification** link in the gallery header (or set `multi=true` in the URL). An image may carry **several classes** at once (multi-label). Buttons become **Download classified** and **Remove classification**. Use **Like mode** in the header to switch back.
- **Edit classes.** In multi mode, **Edit classes** opens a form for each of the nine slots (`1`–`9`): a one-word **name** and a one-character **glyph** (letter or digit). Labels are saved in `.gallapp_classes` in the image folder and are **shared by all sessions** in that directory. Glyphs must be unique across classes. Until you customize a slot, its default name is `classN` and its glyph is the digit `N`.
- **Class shortcuts.** Classify with **Shift+glyph** for the glyph you assigned (e.g. glyph `c` → Shift+c). Shortcuts rematch as soon as you save new labels. **Shift+0** clears every class on the current image.
- **Class labels in the UI.** Filters, button labels, and the edit-classes list show the class **name**, and the glyph in parentheses only when it differs from the slot number (e.g. `success (s)`, but `Class 6` not `Class 6 (6)`). Each class filter also shows how many matching images carry that tag (e.g. `success (s) [142]`). Thumbnail and preview badges still show glyphs only (color-coded).
- **Name filter.** Pattern under the image count. `*` is a wildcard (`plot_*`). Default `*.*`.
- **Jump.** Type a number in `1 / N` and press Enter to go to that image.
- **Resume.** Reopening a directory (and session) continues at the last image you were viewing (unless `n=` is in the URL).
- **Copy status.** Copies a URL with every gallery option set explicitly (`dir`, `session`, `multi`, `persist`, `n`, `likes` / `class`, `filter`, `grid`, `strip`). A short “Link copied” toast confirms it.
- **Persist + export/import.** Sidecars write to the image folder when the server allows PUT; otherwise they live as temporary browser-session entities (`persist=session`). **Export sidecars** / **Import sidecars** move that data as `.gallapp_*` files.
- **Download.** **Download** saves the image on screen. **Download liked** / **Download classified** saves one file, or a `.zip` when several are selected.
- **View / Fit to width / Fullscreen.** Change how the current image is shown. `Esc` closes lightbox and fullscreen.

## Where things are saved

Each image directory can hold sidecar files written by `gallapp/server.py`:

| File | Contents |
|---|---|
| `.gallapp_likes` | Liked filenames for the **default** session (one per line) |
| `.gallapp_position` | Last viewed filename for the **default** session |
| `.gallapp_multi` | Classifications for the **default** session (`filename<TAB>class`) |
| `.gallapp_classes` | Class labels for the directory (`slot<TAB>name<TAB>glyph`); shared by all sessions |
| `.gallapp_likes_<session>` | Liked filenames for a named session (e.g. `alice`) |
| `.gallapp_position_<session>` | Last viewed filename for that session |
| `.gallapp_multi_<session>` | Classifications for that session |

Example `.gallapp_likes` (or `.gallapp_likes_alice`):

```text
photo_001.jpg
photo_042.webp
```

Example `.gallapp_multi` (or `.gallapp_multi_alice`):

```text
photo_001.jpg	1
photo_042.webp	1,3
photo_100.png	2,5,9
```

Each line is `filename`, a tab, then one or more class slots (`1`–`9`) separated by commas.

Example `.gallapp_classes`:

```text
1	clean-fold	c
2	scattered	s
3	contaminated	x
6	misaligned	m
```

Each line is keyboard slot (`1`–`9`), a tab, a one-word class name, a tab, and a one-character glyph. The glyph appears beside the name in the UI (`clean-fold (c)`), on badges, and as the **Shift+glyph** shortcut. Slots omitted from the file keep the defaults `classN` / digit `N`.

Those files live **inside the image folder** you opened (for example `images/my-folder/.gallapp_multi_alice`). Opening a named session creates its sidecar files if they are missing.

### Persist modes: folder vs browser session

Gallery App treats `.gallapp_*` as the same logical entities whether or not the host can write to disk.

| Mode | When | Where data lives |
|---|---|---|
| **folder files** (`persist=file` or auto when PUT works) | `python3 gallapp/server.py` | Real `.gallapp_*` files in the image directory |
| **browser session** (`persist=session` or auto when PUT fails) | static host / GitHub Pages / plain `http.server` | Virtual sidecars in **`sessionStorage`**, same text format as the files |

On open, Gallery App probes whether PUT is allowed (unless `persist=` forces a mode). In **browser session** mode:

1. It still **reads** any existing `.gallapp_*` from the folder/repo (seed).
2. Edits update the temporary browser entities only (survive reload of the same tab; cleared when the tab is closed).
3. **Export sidecars** downloads the current entities as `.gallapp_*` files (or a zip) so you can keep or commit them.
4. **Import sidecars** loads those text files back into the session.

Force session mode locally to rehearse the online case:

```text
http://localhost:8000/gallapp/?dir=images/my-folder&persist=session&multi=true
```

Recent directories on the start page remain in `localStorage` only.

## Query API

Open the gallery with GET parameters. Only `dir` is required to open a folder. **Copy status** always writes every parameter below, even when the value is the default.

| Parameter | Meaning | Default | Example |
|---|---|---|---|
| `dir` | Directory path relative to the server root (or to the repository root when `repo` is set) | — | `images/my-folder` |
| `repo` | Browse a public GitHub repository instead of a local folder: `name` (owner defaults to `seap-udea`) or `owner/name`. Reads `.seap-udea-gallery.json` from the repo root; `dir` is then optional. Likes stay in the browser session (`persist=session`). | — | `repo=MVROC` |
| `ref` | Branch, tag or commit used with `repo` | `HEAD` (default branch) | `ref=main` |
| `id` | Entry of `.seap-udea-gallery.json` when it is an array (used with `repo`) | first entry | `id=medellin` |
| `preview` | Show the filmstrip (used with `repo`; `.seap-udea-gallery.json` sets the default) | `1` | `preview=0` |
| `session` | Session name (`[A-Za-z0-9_-]`, max 40). Empty or omitted = default session. | (default session) | `session=alice` |
| `multi` | Enable multi-class mode instead of likes | `false` | `multi=true` |
| `n` | 1-based image number after filters (`image` and `i` also work). Overrides the saved position on first load. | saved position, else `1` | `n=42` |
| `likes` | Like filter (default mode): `all`, `liked`, or `unliked` (`view` is an alias) | `all` | `likes=liked` |
| `class` | Class filter (multi mode): `all`, `none`, or `1`…`9` | `all` | `class=3` |
| `filter` | Filename pattern (`*` wildcard) | `*.*` | `filter=plot_*` |
| `grid` | Show the thumbnail grid: `1`/`true` or `0`/`false` | `1` | `grid=0` |
| `strip` | Filmstrip height in pixels, 32–240 (`strip_h` also works) | `66` | `strip=96` |
| `persist` | Where to write sidecars: `auto` (probe PUT), `file` (folder), or `session` (browser `sessionStorage`) | `auto` | `persist=session` |

### GitHub repositories (`repo=`)

`?repo=NAME` lists images through the GitHub API and loads them from `raw.githubusercontent.com`, so no server is needed. The optional `.seap-udea-gallery.json` at the repo root (an object or an array of objects) accepts:

| Key | Meaning |
|---|---|
| `id` | Entry name, selected with `id=` |
| `title` | Title shown in the header |
| `path` | Directory with the images, relative to the repo root; used when `dir` is not given |
| `start_with` | Image name to open first (a saved position or `n=` wins); `null` for the first image |
| `configuration` | Object with any option of the [Query API](#query-api) except `dir`, `repo`, `ref` and `id`: `multi`, `session`, `n`, `likes`, `class`, `filter`, `grid`, `strip`, `persist`, `preview`. Used as defaults; parameters in the URL override them. |

Example: `"configuration": { "multi": true, "filter": "plot_*", "grid": false, "strip": 96 }`.

The **Directory** field is always relative to the repository root. Directory listings use the GitHub API (60 unauthenticated calls per hour per IP), so they are cached in `sessionStorage` for 10 minutes; reloading or reopening the same directory in that time makes no API call. Images and `.seap-udea-gallery.json` come from `raw.githubusercontent.com` and do not count.

Examples:

```text
http://localhost:8000/gallapp/?dir=images/my-folder&session=alice&n=120&likes=unliked&filter=plot_*&grid=0&strip=90
http://localhost:8000/gallapp/?dir=images/my-folder&multi=true&class=2&session=reviewer
```

## What it reads

Gallery App requests the directory URL and keeps links that point at an image in that folder. It does not walk into subfolders. Recognized suffixes are `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `tif`, `tiff`, and `avif`. Names that start with `.` are skipped.

A path may not contain `..`. The app will not climb above the server root.

If the directory contains `index.html` (or `index.htm`), Python’s server returns that page instead of a file listing, and Gallery App cannot see the images. Rename or remove that file, or serve the folder with a server that always lists directories.

## Files

| File | Role |
|---|---|
| `index.html` | Page shell and the start-up instructions. |
| `gallery.css` | Layout and gallery styling. |
| `gallery.js` | Directory listing, likes, preview, query API, and zip download. |
| `server.py` | Local file server. Writes likes/position/multi sidecars (default and named sessions). |
| `assets/logo-seap-banner.webp` | SEAP-UdeA mark shown beside Gallery App. Links to [seap-udea.github.io](https://seap-udea.github.io/). |
| `assets/favicon.*` | SEAP-UdeA favicon (same set as the SEAP site). |

There is no build step. The zip is built in the browser and stores the image bytes as they are.

## AI assistance disclosure

Portions of the implementation, interface copy, debugging, and this documentation were assisted by AI language models (used as coding assistants inside Cursor and related tools).

The human author asserts that the conception of Gallery App, the decision to review a local image directory by liking images and downloading that selection, and the choice to follow the SEAP-UdeA gallery are original contributions of the human author. AI tools were used exclusively as coding and writing assistants — analogous to a spell-checker or a compiler — and bear no intellectual authorship over the design of this application. AI models also assisted with translation from Spanish (the native language of the author) into English, and with English spelling and grammar review.

## Author

- **Jorge I. Zuluaga** — [jorge.zuluaga@udea.edu.co](mailto:jorge.zuluaga@udea.edu.co) · [ORCID 0000-0002-6140-3116](https://orcid.org/0000-0002-6140-3116)

**Affiliation:** [SEAP/FACom](https://www.udea.edu.co), Instituto de Física – FCEN, Universidad de Antioquia, Calle 70 No. 52-21, Medellín, Colombia.
