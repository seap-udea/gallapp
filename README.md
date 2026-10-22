# Gallapp

Gallapp is a small static gallery for reviewing images in a local directory. Open a folder served by a local HTTP server, like the images you want to keep, and download that selection. One liked image downloads as itself. Several liked images are packed into a `.zip`.

It follows the interaction of the [SEAP-UdeA gallery](https://seap-udea.github.io/gallery/), which browses figures in a GitHub repository. Gallapp browses a directory on the machine that is serving the page.

## Run it

The page has to be opened through an HTTP server. Opening `index.html` as a file cannot list a directory.

Start the server in the folder that should be the site root — the folder that contains both `gallapp/` and the image directories. In this project that folder is `code/`:

```bash
cd code
python3 -m http.server
```

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

Any static server works the same way, as long as a request for a directory returns an HTML file listing (the listing from `python3 -m http.server` is the one Gallapp is written for).

## Using the gallery

- **Browse.** The large preview, the filmstrip, and the grid show the same set of images. Use the arrows, the on-screen buttons, or a horizontal swipe.
- **Like.** Use **Like**, the heart on a thumbnail, or the `L` key. **Liked only** hides everything else.
- **Download.** **Download** saves the image on screen. **Download liked** saves the one liked image, or a `.zip` named after the folder when more than one image is liked.
- **View, Fit to width, and Fullscreen** change how the current image is shown. `Esc` closes the lightbox and fullscreen.

Likes are stored in this browser, one list per directory path. They stay after a reload and are not sent anywhere. Directories you have opened are listed on the start page.

## What it reads

Gallapp requests the directory URL and keeps links that point at an image in that folder. It does not walk into subfolders. Recognized suffixes are `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `tif`, `tiff`, and `avif`. Names that start with `.` are skipped.

A path may not contain `..`. The app will not climb above the server root.

If the directory contains `index.html` (or `index.htm`), Python’s server returns that page instead of a file listing, and Gallapp cannot see the images. Rename or remove that file, or serve the folder with a server that always lists directories.

## Files

| File | Role |
|---|---|
| `index.html` | Page shell and the start-up instructions. |
| `gallery.css` | Layout and gallery styling. |
| `gallery.js` | Directory listing, likes, preview, and zip download. |

There is no build step and no server-side code. The zip is built in the browser and stores the image bytes as they are.

## AI assistance disclosure

Portions of the implementation, interface copy, debugging, and this documentation were assisted by AI language models (used as coding assistants inside Cursor and related tools).

The human author asserts that the conception of Gallapp, the decision to review a local image directory by liking images and downloading that selection, and the choice to follow the SEAP-UdeA gallery are original contributions of the human author. AI tools were used exclusively as coding and writing assistants — analogous to a spell-checker or a compiler — and bear no intellectual authorship over the design of this application. AI models also assisted with translation from Spanish (the native language of the author) into English, and with English spelling and grammar review.

## Author

- **Jorge I. Zuluaga** — [jorge.zuluaga@udea.edu.co](mailto:jorge.zuluaga@udea.edu.co) · [ORCID 0000-0002-6140-3116](https://orcid.org/0000-0002-6140-3116)

**Affiliation:** [SEAP/FACom](https://www.udea.edu.co), Instituto de Física – FCEN, Universidad de Antioquia, Calle 70 No. 52-21, Medellín, Colombia.
