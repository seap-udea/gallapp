# Gallery App

Gallery App is a small static gallery for reviewing images in a local directory. Open a folder served by a local HTTP server, like the images you want to keep, and download that selection. One liked image downloads as itself. Several liked images are packed into a `.zip`.

It follows the interaction of the [SEAP-UdeA gallery](https://seap-udea.github.io/gallery/), which browses figures in a GitHub repository. Gallery App browses a directory on the machine that is serving the page.

## Run it

The page has to be opened through an HTTP server. Opening `index.html` as a file cannot list a directory.

Start the server in the folder that should be the site root — the folder that contains both `gallapp/` and the image directories. In this project that folder is `code/`:

```bash
cd code
python3 gallapp/server.py
```

That server lists directories the same way as `python3 -m http.server`, and it is what writes likes to disk. It listens on `127.0.0.1` port `8000`. Pass another port as the argument (`python3 gallapp/server.py 8080`).

Then open:

```text
http://localhost:8000/gallapp/
```

Type a directory path relative to the server root and press **Open**. For example:

```text
test_dev/paper_workshop_LSST/figs
```

The same folder can be opened directly:

```text
http://localhost:8000/gallapp/?dir=test_dev/paper_workshop_LSST/figs
```

Any static server works the same way, as long as a request for a directory returns an HTML file listing (the listing from `python3 -m http.server` is the one Gallery App is written for).

## Using the gallery

- **Browse.** The large preview, the filmstrip, and the grid show the same set of images. Use the arrows, the on-screen buttons, or a horizontal swipe.
- **Filter.** The box under the image count takes a filename pattern. `*` matches any text, so `1998_*` shows names that start with `1998_`. The default `*.*` shows every file.
- **Like.** Use **Like**, the star on a thumbnail, `L`, or Shift+Space. Shift+Space toggles the image on screen. A star appears in the top-right corner while it is liked. **Unlike all** clears every like in the directory. **Liked only** and **No like only** filter by like state; **All** shows everything.
- **Jump.** Type a number in the counter (`1 / N`) and press Enter to go to that image.
- **Resume.** The current image name is saved in `.gallapp_position` in the folder (and in the browser as a backup), so reopening the directory continues where you left off.
- **Download.** **Download** saves the image on screen. **Download liked** saves the one liked image, or a `.zip` named after the folder when more than one image is liked.
- **View, Fit to width, and Fullscreen** change how the current image is shown. `Esc` closes the lightbox and fullscreen.

Likes are saved in a `.gallapp_likes` file inside the image folder, one filename per line. The current image is saved in `.gallapp_position` as a single filename. Both stay after a reload and are shared by anyone using that folder. With `python3 -m http.server` the page can still browse images, but it cannot write those files, so likes and position stay in the browser instead. Directories you have opened are listed on the start page.

```text
1997_SX3_multiband_photometry_compare.webp
1998_HH100_multiband_photometry_compare.webp
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
| `gallery.js` | Directory listing, likes, preview, and zip download. |
| `server.py` | Local file server. Also writes `.gallapp_likes` and `.gallapp_position` into the image folder. |
| `assets/logo-seap-banner.webp` | SEAP-UdeA mark shown beside Gallery App. It links to [seap-udea.github.io](https://seap-udea.github.io/). |

There is no build step. The zip is built in the browser and stores the image bytes as they are.

## AI assistance disclosure

Portions of the implementation, interface copy, debugging, and this documentation were assisted by AI language models (used as coding assistants inside Cursor and related tools).

The human author asserts that the conception of Gallery App, the decision to review a local image directory by liking images and downloading that selection, and the choice to follow the SEAP-UdeA gallery are original contributions of the human author. AI tools were used exclusively as coding and writing assistants — analogous to a spell-checker or a compiler — and bear no intellectual authorship over the design of this application. AI models also assisted with translation from Spanish (the native language of the author) into English, and with English spelling and grammar review.

## Author

- **Jorge I. Zuluaga** — [jorge.zuluaga@udea.edu.co](mailto:jorge.zuluaga@udea.edu.co) · [ORCID 0000-0002-6140-3116](https://orcid.org/0000-0002-6140-3116)

**Affiliation:** [SEAP/FACom](https://www.udea.edu.co), Instituto de Física – FCEN, Universidad de Antioquia, Calle 70 No. 52-21, Medellín, Colombia.
