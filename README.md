# Carino DICOM Editor

Carino DICOM Editor is a browser-based DICOM file metadata editor (single static
`index.html`, uses [dcmjs](https://github.com/dcmjs-org/dcmjs)). View, edit, create,
compare, validate and **de-identify** DICOM objects entirely client-side — no upload,
no server. The repository was `DICOM-editor` until the rename; GitHub redirects the
old name, so an existing clone keeps working without being touched.

## Tag dictionary

Tag names/VRs come from a **complete bundled DICOM PS3.6 Data Dictionary**
([`dicom-dictionary.js`](dicom-dictionary.js) — 5041 attributes + 88 repeating-group
masks), generated from the [Innolitics `dicom-standard`](https://github.com/innolitics/dicom-standard)
`attributes.json`. Lookup (`descFor` / `vrForTag`) is layered: author overrides → bundled
dictionary → repeating-group masks (`50xx`/`60xx`/`7Fxx`/`1000`/`1010`/`0028,04x0`…) →
dcmjs → generic "Private Tag". Every tag in the NEMA standard resolves — no more "Unknown
tag" for standard attributes (including retired ones).

To regenerate:

```bash
curl -sL https://raw.githubusercontent.com/innolitics/dicom-standard/master/standard/attributes.json -o attributes.json
# map each entry's { id, name, valueRepresentation } into window.DICOM_DICT / window.DICOM_DICT_MASKS
```

## Trying it without a file

The empty state offers five **samples**, built in the browser and dropped through the
ordinary load path — nothing is fetched, nothing is uploaded, and no patient ever existed.
They are chosen for what they make the tool do rather than for what is easy to write:

| Sample | What it exercises |
| --- | --- |
| CT abdomen | 16-bit signed pixels, Rescale Slope/Intercept, a window quoted in Hounsfield units |
| Chest X-ray | `MONOCHROME1` — the inversion most viewers get wrong |
| Ultrasound | interleaved RGB: no windowing, no inversion, no channel swap |
| Cine loop | sixteen frames, `(0008,2144)` Recommended Display Frame Rate 30 |
| Burned-in text | a name, an ID and a date drawn into the pixels, `(0028,0301)` = `YES` |

They are forged by [`tests/dicom-forge.js`](tests/dicom-forge.js), the same oracle the test
suites use, so each one ships with the reference image it is supposed to decode to and
`tests/suites/samples.js` checks the app against it. Two deep links follow from that:
`#sample=<id>` opens one of the five, and `#case=<id>` opens any case in the test corpus —
which is what makes every card in the [reference gallery](https://dcm.carino.systems/tests/gallery.html)
a one-click reproduction. Both refuse to run when a Carino DICOM hand-off is in flight.

## Viewing a study

A dropped folder is a stack, not a list. Files are sorted on load by `(0020,0011)` Series
Number, then `(0020,0013)` Instance Number, falling back to a **natural** sort on the
filename (`img9` before `img10`) for exports that number nothing — so the image on screen
is the first image of the first series, and the file browser's series tiles hold contiguous
runs. The Overview counter names only the levels that have more than one member: a plain
series reads `Image 3 / 40`, and a drop that turned out to hold two studies says so.

The Overview shows a file and never rewrites one. Everything that changes the stored pixels
— rotate, flip, invert, redact — lives in the Edit tab, and **▣ Edit image** on the Overview
is the way across to it. The two tabs share glyphs (⟳ ⇋ ⇅ appear on both) and they mean
different things, so the Overview's row is labelled **View** and its tooltips say so.

In the Overview viewer:

- **Wheel pages the stack** — the next frame inside a multi-frame file, otherwise the next
  image of the **same series**. It stops at the series boundary rather than walking into a
  different acquisition. This is the convention OHIF and Weasis both ship.
- **Ctrl/⌘+wheel zooms** (the web idiom, not the PACS one — it also makes a macOS trackpad
  pinch zoom, since that arrives as a ctrl+wheel event), and drag still pans.
- **Window/level, zoom, pan, invert, colormap, rotate and flip survive a wheel page** within
  one series, which is the entire point of scrolling a CT stack. Moving to a different
  series or file any other way — a series tile, the ◀ ▶ buttons, the arrow keys — still
  starts from the new file's own window.
- **Cine** plays a multi-frame file, with a loop toggle and an fps box seeded from the file:
  `(0008,2144)` Recommended Display Frame Rate, else `(0018,1063)` Frame Time, else
  `(0018,0040)` Cine Rate, else 15 fps, clamped to 1–60. Frames are decoded on demand and
  chained, so a stack the machine cannot hold at the requested rate plays slower rather
  than falling behind a queue.

## Basic image edits

The Overview viewer's ⟳ ⇋ ⇅ turn the picture on screen and change nothing in the file,
which is what a PACS viewer does; they sit behind a **View** label for that reason.
**Image edits**, in the Edit tab's sidebar under the preview, are the other kind: they move
the **stored pixels**, so what comes out of Download is a file every other reader — another
viewer, a printer, an archive — opens the right way up. Rotate 90° either way, rotate 180°,
flip horizontally or vertically, **Invert**, which swaps `MONOCHROME1` ⇄ `MONOCHROME2`, and
**Redact**, which covers burned-in text. That card is the complete set: no operation that
writes pixel data lives anywhere else in the app.

- **Nothing is resampled.** Every op is a permutation of whole samples: no value is ever
  computed from its neighbours, so a rotation is lossless whatever the depth, the sign or
  the photometric interpretation, and four quarter turns give back the original bytes.
  `PALETTE COLOR`, `YBR` and planar-configuration-1 data need no special case.
- **Every frame**, as with redaction. There is no per-frame option.
- **The geometry follows the pixels.** `(0028,0010)` Rows and `(0028,0011)` Columns are
  exchanged by a quarter turn, and so are `(0028,0030)` Pixel Spacing, `(0018,1164)`
  Imager Pixel Spacing, `(0018,2010)` Nominal Scanned Pixel Spacing and `(0028,0034)`
  Pixel Aspect Ratio. `(0020,0037)` Image Orientation (Patient) is [row direction, column
  direction] — the unit vectors increasing Column and increasing Row walk along in patient
  space (PS3.3 C.7.6.2.1.1) — so moving the pixels permutes exactly those two vectors with
  a sign, which is exact rather than rounded. `(0020,0032)` Image Position (Patient) is
  then walked to whichever original pixel has become the top-left one, and `(0020,0020)`
  Patient Orientation is turned with the axes (`L`,`F` → `H`,`L` for a clockwise quarter
  turn). Enhanced multi-frame objects are handled through their functional groups —
  Plane Position, Plane Orientation and Pixel Measures, per frame — and geometry that
  belongs to a *different* instance (a Referenced Image Sequence, an Original Attributes
  Sequence) is deliberately left alone.
- **Compressed images are decompressed**, through the same decoders and with the same
  refusals as redaction below; the file grows and its Transfer Syntax changes, and you are
  told before it happens.
- **Afterwards the instance says so**: `(0008,0008)` Image Type value 1 becomes `DERIVED`,
  `(0008,2111)` Derivation Description gains a line per edit, and a fresh `(0008,0018)`
  SOP Instance UID is assigned — these are no longer the pixels the old UID identified.
- **Undo is one step deep and session-only.** Applying an edit gives up the redaction undo
  and vice versa: a button that could put back the pixels a redaction removed is not a
  thing this tool offers, whatever it is labelled.
- **Invert** touches no pixel at all. `MONOCHROME1` stores its black at the maximum value
  and `MONOCHROME2` at zero, so swapping the two inverts what every reader draws; it is
  one `CS` value, exactly reversible, and refused for anything else.

**⬇ This file** (beside Download All, and again under the edit buttons) exports the file
on screen alone, with this session's edits — a slice that has just been turned no longer
has to go through an archive or the Range picker to come back out.

## De-identification

The **Anonymize** action implements the **DICOM PS3.15 Annex E, Table E.1‑1 — Basic
Application Level Confidentiality Profile**. The attribute action codes are generated from
the machine-readable [Innolitics `dicom-standard`](https://github.com/innolitics/dicom-standard)
table into [`deid-profile.js`](deid-profile.js) (618 attributes), which maps each tag to its
Basic Profile action:

| Code | Meaning | This tool |
| --- | --- | --- |
| `X` | remove | delete the attribute |
| `Z` | zero-length | empty value |
| `D` | dummy | non-zero dummy appropriate to the VR |
| `U` | UID | consistent remap (kept internally consistent across the loaded set) |
| `X/Z`, `X/Z/D`, `Z/D` | remove-or-blank | empty (never drops a maybe-required attribute) |
| `X/D` | remove-or-dummy | dummy |
| `X/Z/U*` | keep & remap | retained so nested UIDs remap (references survive) |

It is applied **recursively** into sequences (so PHI nested in Request Attributes,
Original Attributes, SR content, etc. is cleaned), and additionally:

- removes **private** attributes (all odd groups),
- removes **Curve** (`50xx`) and **Overlay** data/comments (`60xx,3000` / `60xx,4000`),
- remaps instance **UIDs** while preserving standard UIDs under `1.2.840.10008`
  (SOP Class, Transfer Syntax, coding schemes),
- writes the required de-identification markers **`(0012,0062)` Patient Identity Removed =
  `YES`**, **`(0012,0063)` De-identification Method**, and **`(0012,0064)` Method Code
  Sequence** — one item per profile applied, always beginning with
  `(113100, DCM, Basic Application Confidentiality Profile)`,
- warns when **`(0028,0301)` Burned In Annotation = YES** and points at the pixel
  redaction tool below.

**Patient's Name** becomes `ANONYMOUS` — the same value in every file, every time. It is
deliberately not a name: **Randomize** is the action that invents a plausible patient, and
the name is the first place a reader looks to tell one from the other. It is also the one
attribute that has to stay constant across a study, since a set of instances sharing a
PatientID but naming several people is not a study any reader will reassemble.

Two more values are written back after the compliant pass regardless of the options below:
the original **Patient's Sex** and **Patient's Age** `000Y`. Neither identifies anyone, and
a study whose every patient is sexless and ageless is needlessly miserable to read. This is
*not* the PS3.15 Retain Patient Characteristics option — that one is the checkbox below and
keeps nine real attributes, age included.

### Optional profiles

The **⚙** button beside Anonymize opens the PS3.15 optional profiles. All five are off by
default, so the Basic Profile alone remains what happens if you change nothing. Each is
applied on top of the Basic Profile and recorded as its own `(0012,0064)` item and its own
`(0012,0063)` value:

| Option | CID 7050 | Keeps |
| --- | --- | --- |
| Retain UIDs | `113110` | the 59 UID attributes, *and* skips the UID remap entirely |
| Retain device identity | `113109` | 46 attributes — station name, manufacturer, model, serial number, scheduled station |
| Retain institution identity | `113112` | 10 attributes — institution name/address/code, department, clinical trial site |
| Retain patient characteristics | `113108` | 9 attributes — real age, size, weight, ethnic group, sex, pregnancy and smoking status |
| Retain full dates | `113106` | 165 attributes — study/series/acquisition/content dates and times, unshifted |

Table E.1-1 marks each option's attributes either **K** (keep unmodified) or **C** (clean —
"replace with values of similar meaning known not to contain identifying information").
**Only the K rows are honoured.** A C row keeps its Basic Profile action, which removes
*more* than the option promises and never less: Retain device identity therefore still
strips the eleven AE Titles it marks C, and Retain patient characteristics still removes
Allergies, Patient State, Pre-Medication and Special Needs.

The five options that are **not** offered are the ones that are C all the way down, and
that this tool cannot honestly claim: **Clean Descriptors** (125 attributes of free text to
scrub), **Clean Graphics** and **Clean Structured Content** (graphic-annotation and SR
content surgery), **Retain Longitudinal Modified Dates** (date shifting), and **Retain Safe
Private** (a per-vendor safe-private list this repository does not have). Their columns are
generated into `deid-profile.js` all the same, so the data is there if the capability ever
is. Offering a checkbox that writes `113105` into `(0012,0064)` while doing no cleaning
would put a false statement in the file's own audit trail, which is worse than the missing
feature.

### Burned-in pixel redaction

Identity printed *into the image* — the banner an ultrasound or secondary-capture device
burns across the top of every frame — is not reachable by any tag edit. **▣ Redact
burned-in text**, in the Edit tab's Image edits card, overwrites those samples in the stored
pixel data itself.

It opens a full-screen workspace rather than working in the sidebar preview: the images that
carry a burned-in banner are typically 256 square, and placing a box over two lines of text
in a 280-pixel-tall preview is not something anyone can do accurately. The workspace scales
the frame up, draws it unsmoothed so the samples under the box are visible, and puts the
controls in a row beneath it. Drag boxes over the text, drag a box to move it, double-click
to delete one, then apply. **Cancel** and **Esc** leave; a click on the backdrop does not,
because in the workspace a click is a box that missed.

Boxes are kept in image coordinates, so nothing about how the frame is displayed moves them.

- **Every frame, always.** A cine whose first frame is clean and whose frames 2..N still
  carry the name is more dangerous than one that was never redacted, because the user
  believes it is clean. There is no per-frame option.
- **The fill is the darkest value that photometric interpretation can express**, not a
  hard-coded zero: `0` for MONOCHROME2, `-(1 << (bs-1))` for signed data, the **maximum**
  stored value for MONOCHROME1, `(0,128,128)` for YBR_FULL, and for PALETTE COLOR the index
  whose lookup-table entry is darkest — which is very often not index 0.
- **Compressed images are decompressed** to uncompressed Explicit VR Little Endian and the
  pixel module rewritten (RLE Lossless, JPEG Lossless, JPEG 2000 and JPEG-LS without loss —
  a lossy `.91` or `.81` stream lost what it lost before it reached us, and nothing further
  is thrown away here; baseline/extended JPEG at 8 bits per sample, which is stated before
  you confirm). The file grows and its Transfer Syntax changes.
- **Afterwards the instance says so**: `(0028,0301)` Burned In Annotation = `NO`,
  `(0012,0064)` gains `(113101, DCM, Clean Pixel Data Option)` beside any existing
  `113100`, `(0012,0063)` is appended to, `(0008,0008)` Image Type value 1 becomes
  `DERIVED`, `(0008,2111)` Derivation Description records the region and frame counts, and
  a fresh `(0008,0018)` SOP Instance UID is assigned — these are no longer the pixels the
  old UID identified. `(0028,2110)` Lossy Image Compression and its ratio/method are
  deliberately **left alone**: per PS3.3 C.7.6.1.1.5 they describe the pixel data's history,
  and decompressing an image does not restore what a lossy codec threw away.
- **Undo is session-only.** It is offered until you leave the page; once the file has been
  exported the redacted bytes are out in the world.

### Regenerating the profile table

```bash
curl -sL https://raw.githubusercontent.com/innolitics/dicom-standard/master/standard/confidentiality_profile_attributes.json -o /tmp/conf.json
node tools/make-deid-profile.mjs /tmp/conf.json deid-profile.js > /tmp/new.js && mv /tmp/new.js deid-profile.js
```

**The existing file is the second argument, and it is not optional.**
[`tools/make-deid-profile.mjs`](tools/make-deid-profile.mjs) reads it back in as the
authority on the Basic Profile column and lets the Innolitics extract only *add* to it,
reporting on stderr what it added, what upstream does not carry, and any row where the two
disagree — where the existing action wins. Innolitics is the only machine-readable source
for the ten **option** columns, which is why it is used at all, but its extract tracks an
older edition of Annex E than the Basic Profile column here: it is short 39 of the 656 rows
this file ships, including the whole `(0010,0011)`–`(0010,0047)` pronoun and gender-identity
block, the four diagnosis code sequences, both SR observer names and `(0002,0013)`
Implementation Version Name (file-meta, so legitimately not in Table E.1-1). Regenerating
from Innolitics alone once dropped all of them, thirty-five of which are `X` — Anonymize
simply stopped removing them, and nothing failed. Hence the merge, and hence
`tests/suites/deid.js` naming those rows rather than counting them. Node only, run by hand;
nothing at runtime touches the network.

### Not covered / limitations

- Pixel redaction cannot reach **High-Throughput JPEG 2000** (`1.2.840.10008.1.2.4.201`
  and `.202`) or **MPEG/H.264** images: there is no decoder for them here, so those are
  refused by name rather than half-done. **12-bit JPEG Extended** can only be decoded at 8
  bits per sample, so redacting one drops four bits of depth across the whole image, not
  just inside the boxes. **JPEG 2000** and **JPEG-LS** are decoded and redacted at full
  depth, but the decode runs on the main thread — a large mammogram takes a noticeable
  fraction of a second per frame, and an Extract run over a range of them will hold the
  page while it works.
- Redaction applies to the editor's copy of the file. A file dropped separately into the
  **Extract** tab keeps its own copy, and a PNG exported from there will still show the
  banner.
- Rotating and flipping reach the pixel data and the image geometry, and **nothing else
  that names a position**. Overlay planes (`60xx,3000`), Sequence of Ultrasound Regions
  (`0018,6011`) and Graphic Annotation Sequence (`0070,0001`) are left where they are, and
  the confirm dialog names whichever of them the file carries before the turn is applied —
  an annotation that no longer sits over what it annotates is worse than one you were told
  about. `(0020,0032)` is left unmoved, with a line in the log, when the file carries a
  position but neither an orientation nor a spacing to walk it along.
- The same codec limits as redaction apply, for the same reason: it is one decoder set.
- Five of the ten optional profiles are exposed as toggles (above); the other five —
  Clean Descriptors, Clean Graphics, Clean Structured Content, Retain Longitudinal
  Modified Dates and Retain Safe Private — are deliberately not, because every attribute
  they cover is a `C` (clean) row and this tool does no free-text scrubbing, date shifting,
  annotation surgery or safe-private matching. For the same reason a `C` row inside an
  option that *is* offered falls back to the Basic Profile rather than being retained.
- The action table is periodically revised by NEMA; regenerate it before relying on it for
  a production workflow.

## Desktop application

The same page, in a window. [`desktop/`](desktop/) wraps this repository's `index.html`
in Electron and serves it from an internal `app://` origin, so the whole tool — dcmjs, the
dictionary, the fonts, the four WASM codecs, the forge behind the sample buttons — sits
inside the bundle and the app never asks the network for any part of itself. It is for
someone who wants the editor on a workstation and has no reason to stand up
[Carino DICOM](https://github.com/MiguelCarino/Carino-DICOM) around it: an installer, an
icon in the dock, and the offline, no-upload, entirely client-side tool documented above,
unchanged. Files still never leave the machine, and now neither does the page.

Builds come from the **Releases** page of
[MiguelCarino/Carino-DICOM-Editor](https://github.com/MiguelCarino/Carino-DICOM-Editor/releases),
produced by [`.github/workflows/desktop-build.yml`](.github/workflows/desktop-build.yml) —
macOS (`.dmg`, `.zip`), Windows (`.exe` installer) and Linux (`.AppImage`, `.deb`, `.rpm`),
each on its own runner, because electron-builder cannot cross-compile.

### The builds are unsigned

They carry no Apple Developer signature and no Windows publisher certificate, and the
operating systems say so:

- **macOS** — Gatekeeper refuses the first launch outright ("cannot be opened because the
  developer cannot be verified"). Right-click the app and choose **Open**, or allow it once
  under **System Settings → Privacy & Security → Open Anyway**. Double-clicking will keep
  failing until you do.
- **Windows** — SmartScreen interrupts the installer with "Windows protected your PC";
  **More info → Run anyway** is the way past it.
- **Linux** — nothing to allow. Mark the AppImage executable, or install the `.deb`/`.rpm`.

This is a fact about the build, not about the code, and it is worth knowing that the two
warnings mean "nobody paid to be identified", not "this binary was inspected and found
suspect". The workflow already carries the signing and notarization steps; they switch
themselves on the moment the certificate secrets are present, and until then the honest
thing is to say what you will see.

### The update notice is opt-in

There is no auto-updater in this app. Nothing is ever downloaded, installed or replaced
behind you; the most that can happen is being told a newer version exists.

- **It is off unless you ask for it.** A few seconds after the first launch the app asks
  once, in one sentence, with two buttons. Dismissing the dialog counts as **Don't check** —
  the default for anyone who never answers is off.
- **What it does, when on:** at most once a day it reads
  `api.github.com/repos/MiguelCarino/Carino-DICOM-Editor/releases/latest` and compares that
  tag with the running version, field by field. If — and only if — it is strictly newer, a
  small **Update available ↗** pill appears in the header and opens the release page in your
  real browser. Installing it is then something you do yourself.
- **What it sends:** an HTTPS GET, and a `User-Agent` naming the app and its version.
  No identifier, no study, no filename, nothing about what is open, and no telemetry of any
  kind — GitHub sees an anonymous request for a public JSON document, logged the way it logs
  every other one. A failed check is silent: no retry, no dialog, no log line.
- **Turning it off:** **Help → Check for updates automatically**, a checkbox that reflects
  the current state. **Help → Check for updates now** is the manual one, which reports back
  whatever it finds, including nothing. The answer is remembered in `updates.json` in the
  app's user-data directory and nowhere else.

### The Carino DICOM hand-off does not reach this build

Opening a study straight from a running Carino DICOM — the `#load=` deep link — does not
work in the standalone desktop app. The desktop page's origin is `app://carino`, and the
PACS echoes CORS headers only for the http(s) editor URL an operator configured, so the
manifest fetch is refused before it starts. There is no setting on either side that fixes
it. Use the editor **bundled inside Carino DICOM**, which is served from the PACS's own
origin and needs no CORS at all, or the web version at
[dcm.carino.systems](https://dcm.carino.systems) with the PACS pointed at it. Everything
else in the app — every tab, every sample, the self-test, the gallery — behaves identically
in the desktop build.

The shell adds no native file features in this version: there is no **Open** item in the
File menu, and drag-and-drop and the in-page picker are the way in, working exactly as they
do in the browser.

## Tests

```bash
./tests/run.sh              # everything
./tests/run.sh pixels       # named suites only
```

Each suite is injected into a copy of the real `index.html` and run in headless Chromium
against the real functions — there is no build step and nothing is mocked. The oracle is
[`tests/dicom-forge.js`](tests/dicom-forge.js), which writes DICOM files byte by byte and,
separately, computes what each one is *supposed* to look like from the samples it was built
from rather than from the bytes. A decoder that is self-consistently wrong still fails.

[**tests/gallery.html**](https://dcm.carino.systems/tests/gallery.html) renders that
oracle: every case in the corpus, its reference picture, what it is for, and a button to
open it straight in the viewer. It is the picture to compare against when the app shows
something suspicious — if the two disagree, the bug is in the app, not in the file.
[`tests/README.md`](tests/README.md) is the long version, including a list of the rendering
defects the corpus was written to catch.

`tests/dicom-forge.js` is therefore **not** dead weight in a deployment: the empty state's
sample buttons lazy-load it. Prune `tests/` and those buttons stop working.

### Running the suites in your own browser

[**dcm.carino.systems/#selftest**](https://dcm.carino.systems/#selftest) runs the same
suites in the browser you are reading this in, and prints what came back:

> Your browser decoded 18 of 18 DICOM encodings correctly.
> Encodings that no browser can decode: 3 — every one of them was refused with an
> explanation, as it should be. 1128 of 1128 assertions passed.

It takes a few seconds — the whole corpus is built, decoded, redacted, edited and exported
while you watch the progress line.

Under it is a row per **transfer syntax × photometric interpretation** — 21 of them, from
Implicit VR Little Endian through JPEG-LS and JPEG 2000 — saying which of the test files in
that encoding this browser got right, which it correctly refused, and, where something
failed, the name of the assertion that failed. That is a conformance claim with its
evidence attached, and it is browser-specific: the JPEG baseline path goes through the
browser's own image decoder, and JPEG 2000, JPEG-LS and JPEG Lossless go through WASM
builds whose behaviour is not identical everywhere. **Copy report** puts the whole thing on
the clipboard as plain text, with the user agent and the URL, ready to paste into an issue.

Nothing is uploaded and nothing is fetched: every file is forged in the page.

It is a page-load route rather than a button, and it is reached from the Info dropdown and
from the gallery. The suites drive the real `handleFiles()`, the real tab switcher and the
real redaction tool, so they cannot be let loose on a session with a study open — the link
asks first, then reloads, and the way back out is another reload.

## Licensing

**Mine — Mozilla Public License 2.0.** Everything in this repository *except*
the paths listed below. Copyright © 2026 Miguel Carino. Full terms in
[LICENSE](LICENSE).

**Not mine.** The files below are third-party works redistributed here. This
project's licence does not cover them and could not: they are not mine to
relicense. Each keeps its own terms, and each carries its own notice.

| Path | What it is | Licence | Notice |
| --- | --- | --- | --- |
| [`fonts/`](fonts/) | IBM Plex Mono, IBM Plex Sans, Red Hat Display, Red Hat Text | SIL OFL 1.1 | [`fonts/OFL.txt`](fonts/OFL.txt) |
| [`vendor/`](vendor/) | third-party JavaScript and WebAssembly | per package — see the notice | [`vendor/README.md`](vendor/README.md) |

| Under `vendor/` | What it is | Licence | Notice |
| --- | --- | --- | --- |
| [`dcmjs.min.js`](vendor/dcmjs.min.js) | DICOM parser/writer | MIT | [`vendor/LICENSE-dcmjs.txt`](vendor/LICENSE-dcmjs.txt) |
| [`lossless-min.js`](vendor/lossless-min.js) | JPEG Lossless decoder | MIT | [`vendor/LICENSE-jpeg-lossless-decoder-js.txt`](vendor/LICENSE-jpeg-lossless-decoder-js.txt) |
| `openjpegwasm_decode.js` / `.wasm` | JPEG 2000 decoder (`@cornerstonejs/codec-openjpeg` 1.3.0) | MIT wrapper over BSD 2-Clause OpenJPEG | [`vendor/LICENSE-codec-openjpeg.txt`](vendor/LICENSE-codec-openjpeg.txt), [`vendor/LICENSE-openjpeg.txt`](vendor/LICENSE-openjpeg.txt) |
| `charlswasm_decode.js` / `.wasm` | JPEG-LS decoder (`@cornerstonejs/codec-charls` 1.2.3) | MIT wrapper over BSD 3-Clause CharLS | [`vendor/LICENSE-codec-charls.txt`](vendor/LICENSE-codec-charls.txt), [`vendor/LICENSE-charls.txt`](vendor/LICENSE-charls.txt) |

The two WebAssembly codecs each carry **two** notices, not one: the npm package
is MIT and covers the emscripten wrapper, while the C library compiled into the
`.wasm` is BSD and requires its own notice to be reproduced in exactly this kind
of binary redistribution. Both texts are in `vendor/`, and
[`vendor/README.md`](vendor/README.md) has the `npm pack` recipe that keeps them
in step with the bytes.

Those files travel with any fork, mirror or repackaging of this repository, and
their notices must travel with them.

**Why MPL and not AGPL.** MPL is *file-level* copyleft: modifications to existing
source files must be shared under the MPL, but the tool may be combined with, or
integrated into, proprietary software. MPL-2.0 also carries an explicit patent
grant. Each source file should carry the standard header:

```
This Source Code Form is subject to the terms of the Mozilla Public License, v.
2.0. If a copy of the MPL was not distributed with this file, You can obtain one
at http://mozilla.org/MPL/2.0/.
```
