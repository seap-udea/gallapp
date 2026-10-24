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
- **Named sessions.** **New session** opens an on-page name dialog, then a new tab for that session. Each name gets its own likes and position files. Omit `session` for the default session.
- **Like / unlike.** Mark images with **Like**, the star on a thumbnail, `L`, or Shift+Space. Liked images show a gold star and a thick border in the grid. **Unlike all** clears every like in the current session.
- **Like filters.** Radios **All**, **Liked only**, and **No like only** limit what you see.
- **Name filter.** Pattern under the image count. `*` is a wildcard (`plot_*`). Default `*.*`.
- **Jump.** Type a number in `1 / N` and press Enter to go to that image.
- **Resume.** Reopening a directory (and session) continues at the last image you were viewing (unless `n=` is in the URL).
- **Copy status.** Copies a URL with every gallery option set explicitly (`dir`, `session`, `n`, `likes`, `filter`, `grid`, `strip`), including defaults such as `session=` (default session), `likes=all`, and `grid=true`. A short “Link copied” toast confirms it.
- **Download.** **Download** saves the image on screen. **Download liked** saves one file, or a `.zip` when several are liked.
- **View / Fit to width / Fullscreen.** Change how the current image is shown. `Esc` closes lightbox and fullscreen.

## Where things are saved

Each image directory can hold sidecar files written by `gallapp/server.py`:

| File | Contents |
|---|---|
| `.gallapp_likes` | Liked filenames for the **default** session (one per line) |
| `.gallapp_position` | Last viewed filename for the **default** session |
| `.gallapp_likes_<session>` | Liked filenames for a named session (e.g. `alice`) |
| `.gallapp_position_<session>` | Last viewed filename for that session |

Example `.gallapp_likes` (or `.gallapp_likes_alice`):

```text
photo_001.jpg
photo_042.webp
```

Those files live **inside the image folder** you opened (for example `images/my-folder/.gallapp_likes_alice`). Opening a named session creates its sidecar files if they are missing.

If the custom server is not used (`python3 -m http.server` alone), the page can still browse images, but it cannot write those files. In that case likes and position fall back to **browser `localStorage`**, keyed by directory path and session. Recent directories on the start page are always stored in `localStorage` only.

## Query API

Open the gallery with GET parameters. Only `dir` is required to open a folder. **Copy status** always writes every parameter below, even when the value is the default.

| Parameter | Meaning | Default | Example |
|---|---|---|---|
| `dir` | Directory path relative to the server root | — | `images/my-folder` |
| `session` | Session name (`[A-Za-z0-9_-]`, max 40). Empty or omitted = default session. | (default session) | `session=alice` |
| `n` | 1-based image number after filters (`image` and `i` also work). Overrides the saved position on first load. | saved position, else `1` | `n=42` |
| `likes` | Like filter: `all`, `liked`, or `unliked` (`view` is an alias) | `all` | `likes=liked` |
| `filter` | Filename pattern (`*` wildcard) | `*.*` | `filter=plot_*` |
| `grid` | Show the thumbnail grid: `1`/`true` or `0`/`false` | `1` | `grid=0` |
| `strip` | Filmstrip height in pixels, 32–240 (`strip_h` also works) | `66` | `strip=96` |

Example:

```text
http://localhost:8000/gallapp/?dir=images/my-folder&session=alice&n=120&likes=unliked&filter=plot_*&grid=0&strip=90
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
| `server.py` | Local file server. Writes likes/position sidecars (default and named sessions). |
| `assets/logo-seap-banner.webp` | SEAP-UdeA mark shown beside Gallery App. Links to [seap-udea.github.io](https://seap-udea.github.io/). |
| `assets/favicon.*` | SEAP-UdeA favicon (same set as the SEAP site). |

There is no build step. The zip is built in the browser and stores the image bytes as they are.

## AI assistance disclosure

Portions of the implementation, interface copy, debugging, and this documentation were assisted by AI language models (used as coding assistants inside Cursor and related tools).

The human author asserts that the conception of Gallery App, the decision to review a local image directory by liking images and downloading that selection, and the choice to follow the SEAP-UdeA gallery are original contributions of the human author. AI tools were used exclusively as coding and writing assistants — analogous to a spell-checker or a compiler — and bear no intellectual authorship over the design of this application. AI models also assisted with translation from Spanish (the native language of the author) into English, and with English spelling and grammar review.

## Author

- **Jorge I. Zuluaga** — [jorge.zuluaga@udea.edu.co](mailto:jorge.zuluaga@udea.edu.co) · [ORCID 0000-0002-6140-3116](https://orcid.org/0000-0002-6140-3116)

**Affiliation:** [SEAP/FACom](https://www.udea.edu.co), Instituto de Física – FCEN, Universidad de Antioquia, Calle 70 No. 52-21, Medellín, Colombia.
