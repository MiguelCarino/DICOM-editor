# Tests

    ./tests/run.sh              # every suite
    ./tests/run.sh pixels       # named suites only

Needs `chromium-browser` on PATH (override with `CHROME=...`). No npm, no build
step — the app is static files and the tests run it as the browser would, over a
throwaway HTTP server rather than `file://`.

There are no fixture files. `dicom-forge.js` writes real Part-10 byte streams in
the browser at run time — preamble, file meta group, dataset, encapsulated
fragments and all — and hands each one to the app through `DicomMessage.readFile`,
the same entry point a dropped file goes through. It carries small encoders for
PackBits and for JPEG Lossless, so those compressed syntaxes are exercised by
streams an independent implementation produced rather than by recorded bytes.

The one exception is JPEG 2000 and JPEG-LS, which the browser has no encoder
for: five codestreams are carried as base64 constants inside `dicom-forge.js`
and regenerated out of band by `tests/fixtures/make-codec-fixtures.mjs` (needs
npm and the network; `run.sh` never touches it). That makes them a weaker
oracle, in a specific way — see below.

## The oracle

Every case carries two things that never touch each other:

* **the bytes**, encoded from a set of sample values
* **the reference image**, computed *from those same sample values* by a separate
  implementation of windowing, rescale and photometric interpretation

So a case passes only when the app's decoder and PS3.3 agree. A decoder that is
wrong in a self-consistent way still fails, which is the whole point — comparing
the app against itself would have found none of the problems below.

`tests/gallery.html` is the same corpus with the reference images drawn out. Each
card has two buttons: **Download .dcm**, and **Open in the viewer**, which is a
`#case=<id>` link the app resolves by rebuilding that case from this same forge.
So a suspicious rendering is a URL — paste `…/#case=rle-mono16` into a bug report
and the other person lands on the same picture, with the gallery's reference card
beside it to compare against.

### Where the oracle is weaker

Two families of case do not meet that standard, and you should know which.

PackBits, RLE, JPEG Lossless and every raw layout are encoded by
`tests/dicom-forge.js` itself, from scratch, in code the app has never run. That
is a genuine oracle: the encoder and the decoder share nothing.

JPEG 2000 and JPEG-LS are not. The app vendors decode-only WASM, so there is no
encoder in the browser to forge a codestream with; the five fixtures are
checked-in base64, produced out of band by
`tests/fixtures/make-codec-fixtures.mjs` from **the same OpenJPEG and CharLS
codebases that decode them**. A defect symmetric across encode and decode would
cancel out and these tests would not see it.

What they do still catch is the wiring, which is what every rendering defect in
the table below actually was: interleave order, byte order, bit depth, sign
extension, planar configuration, photometric interpretation, frame offsets. The
reference image is still the forge's own `pattern()` and `colorPattern()`,
computed in the browser from first principles and never round-tripped through
either codec — so a decoder that hands back the right bytes in the wrong shape
fails here exactly as loudly as anywhere else.

There is no honest way to do better in a checked-in browser test. Pillow and
ImageMagick both link the same OpenJPEG; Kakadu is proprietary; and writing a
conforming EBCOT encoder to serve as an oracle is not a proportionate amount of
work for what it would add.

## The forge is also a product dependency

The empty state of the app has a **Load a sample** row, and the five files behind
it come from `Forge.samples()` in this directory — lazily `<script>`-injected on
the first click, never as part of the page. `tests/gallery.html` lists them in
their own section above the corpus.

They live here rather than in `index.html` for the reason everything else here
does: each sample carries the reference image it is supposed to decode to, and
`tests/suites/samples.js` holds the app to it. A demo built in the app itself
would be a picture nobody checks. The corpus is written to *break* decoders —
32×32 ramps and corner flags — so the samples are the one part of this directory
drawn to be looked at: an abdominal CT in real Hounsfield units, a MONOCHROME1
chest film, colour Doppler, a sixteen-frame cine, and a screen capture with a
patient banner burned into the pixels for the redaction tool to find.

Two consequences worth writing down. `tests/` cannot be pruned from a deployment
without breaking those buttons. And `Forge.samples()` has to stay byte-for-byte
deterministic — fixed UIDs, no `Math.random` in the phantom generators — or a
`#sample=` link stops reproducing and the reference stops referring to anything.
The suite asserts exactly that.

## Two ways to run a suite

A suite file is a registration, not a program. Each one ends like this:

```js
(window.SUITES || (window.SUITES = {})).pixels = async () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}…`);
  …
  return out;
};

if (!window.SELFTEST) window.addEventListener('load', async () => { …write <pre id="TESTOUT">… });
```

`run.sh` injects one suite into a copy of `index.html` and scrapes the `<pre>` the
fallback writes — unchanged, and it must stay that way, because it is the safety
net for everything else.

The second caller is **`index.html#selftest`**, which loads *every* suite into the
live page at once, sets `window.SELFTEST` first so none of them self-starts, and
awaits the returned lines instead. That mode is the reason for the shape: a dozen
suites in one page would otherwise append a dozen elements sharing one id, and a
suite appended after the page's `load` event would never fire at all.

It also has to live inside `index.html` rather than in a page of its own. The
suites reach `DicomMessage`, `DicomDict` and `files` by bare name, and those are
`const` bindings in the app's classic-script global scope — visible to another
classic script on the same page and to nothing else. A separate `selftest.html`
would see none of them.

Two things follow for anyone writing a suite. **Leave the app the way you found
it** — a search box still holding a query, a stubbed global, an open dialog: under
`run.sh` each suite gets a fresh page and never notices, but in one page it lands
on whoever runs next. (`render` leaked a search query into `sequences` exactly
this way, and nine assertions went red the first time all fourteen ran together.)
**Name assertions `<case id>: what it checks`**, because that convention is what
the self-test's report uses to attribute a failure to a file, and through the file
to a transfer syntax. And **assert on UI text through `t()`, never against the
English** — `run.sh` always loads the page in English, but a visitor does not, and
six assertions in `compare`, `series` and `redact` reported failures to a Japanese
reader that an English one never saw.

## The suites

**`pixels`** — `decodeDicomPixels()` on its own. For greyscale it asserts on
`rawFloats`, the decoder's buffer of values in output units, because sign
handling, bit masking, byte order, rescale and frame offsets all surface there as
a wrong minimum or maximum before any windowing can hide them. Colour has nothing
applied after it, so colour cases are compared pixel for pixel.

**`viewer`** — what a person actually sees. Installs each forged file into the
app's own state and drives both display surfaces: the Overview viewer
(`renderOverview`) and the editor's preview thumbnail (`drawPreview`). It also
checks the two against *each other*, independent of which one is right — a file
cannot legitimately look like two different images in two panels of one page.

**`edits`** — whose edits are whose. Loads a three-slice series through the real
drop handler and checks that each file keeps its own working copy: that an edit
does not follow you when you switch files, that it is still there when you come
back, and above all that downloading writes each file's own identity rather than
the one you happened to be looking at. It also guards the shallow copy the writer
is handed. Saving a file must not change it, so the dataset is fingerprinted
before and after — every VR, every value, the bytes behind every buffer, into
every sequence item — and a nested edit has to reach the exported file without
reaching the loaded one. That the copy really is shallow is not something an
assertion can see from outside, so `DicomDict.prototype.write` is borrowed for a
single call and the dataset it is handed is checked for the file's own buffer
objects: a deep copy would hand it a second copy of the image, per file, per
download.

**`compare`** — what happens when a second file is shown beside the first.
Comparing is a mode of the editor's table rather than a separate screen, so this
asserts the things that only hold if it really is the same table — the category
filter and search still rule it, both columns are editable and belong to their own file, and
closing the comparison leaves the editor exactly as it was. It also holds the
Overview's Compare launcher to landing in the editor with a comparison open,
since there is no longer a tab for it to point at.

**`sequences`** — the table as a tree. A DICOM dataset nests, so this forges a
file with a two-item Referenced Image Sequence, a code sequence inside one of its
items and an Icon Image Sequence carrying its own pixel data, then asserts that
the tree can be opened, searched, filtered, exported and edited — and that a
nested edit lands on the nested element and on nothing else. Rows are addressed
by their path (`00081140/0/00400555/0/00080100`), never by their tag code: a
nested `(0010,0010)` is a legal thing for a file to hold, so matching on the code
alone finds the wrong row.

**`folder`** — loading a whole study. A real folder drop cannot be synthesised
from page script, so this drives the parts that can be: the `DICM` sniff that
decides what is a DICOM file (against a forged file with no extension, and
against a `.dcm` that is not one), the entry-tree walk over duck-typed
`FileSystemEntry` fakes — including a reader that hands back partial batches, the
way Chrome's does — the `DataTransfer` snapshot, the window-level drop routing,
and what `loadStudy` keeps: DICOMDIR out, junk out without a failure banner,
a large folder gated by a question asked *before* the editor is wiped.

**`redact`** — burned-in pixel redaction, the one thing here that writes pixels
rather than reading them. Two different questions are asked of every case:
*inside* the box the decoded image has to be the darkest thing that photometric
interpretation can express — which is `0` for MONOCHROME2, the **maximum** stored
value for MONOCHROME1, `-(1 << (bs-1))` for signed data, `(0,128,128)` for
YBR_FULL and a searched lookup-table index for PALETTE COLOR — and *outside* it
the picture has to still be the picture, byte for byte wherever the codec was
lossless. Both are then asked again of the file that comes back out of
`buildEditedFile`, because a redaction that only exists in memory is not one. It
also proves the screen-to-image mapping through all eight rotate/flip
combinations plus zoom and pan against a forward transform built by hand from the
view state — measuring the untransformed canvas box itself, since borrowing the
app's own measurement would make the round trip self-consistent and let the
rotated-bounding-box mistake straight through — drives the real pointer handlers
and the Apply button, and checks that a codec with no decoder is refused by name
with the dataset left byte-identical.

**`boot`** — where the three library `<script>` tags sit. They are 1.4 MB of
classic, parser-blocking script, and in `<head>` they held the first paint for
three seconds on a 5 Mbps cold load; below the markup they hold nothing. No
other suite would notice them moving back, because every one of them loads the
finished page and would pass just as happily on the slow one. So this asserts the
arrangement itself, and the two ways of undoing it that look like tidying —
putting them back in `<head>`, or adding `defer` so they are non-blocking there,
which would run all three *after* the inline app script and kill the page on its
first line.

**`zip`** — Download All has to deliver every file it was asked for. Twelve
forged slices go in through the real loader and out through the real
`downloadRange`, with the app's single exit to the disk intercepted, and the
archive that comes back is read by a reader written inside the suite with its own
CRC-32 table: local headers walked forward by signature, the central directory
walked separately from the offset the EOCD gives, the two never consulting each
other. Twelve entries existing is not enough — every payload is fed back to
`DicomMessage.readFile` and has to carry the SOP Instance UID of the slice it
came from, which is the assertion that would have caught fifty of sixty files
quietly not arriving. It also holds the 32-bit ceilings (more entries than the
EOCD can count, and a payload too large for a 32-bit offset, both refused rather
than wrapped), the de-duplication of two files that share a name, and the same
one-download-not-n property on the Extract tab.

**`loading`** — the read-ahead in `handleFiles`. The loader keeps several file
reads in flight while it parses, which is a concurrency change on the one path
every file enters through, so this measures the concurrency instead of trusting
it: the files are fakes that record the moment their read begins, and
`DicomMessage.readFile` is borrowed to record how many reads had started by the
time each file was parsed. From that it asserts that reads do run ahead, that
they never run ahead by more than four files, and — with a fake that claims to be
100 MB while holding four kilobytes, the only way to reach the byte cap without
asking the runner for 100 MB — that the queue stops at a file too big for the
budget and still lets it through on its own. Everything a user can see is
asserted alongside: same files, same order, each one built from its own bytes,
and a read that rejects reported in the banner with the files after it still
loading.

**`render`** — how often the tag table is rebuilt. The search box stashes the
query on the keystroke but debounces the render, so this drives the real input
element and asserts that eight characters produce one rebuild rather than eight,
while `renderTable` called directly is still finished when it returns — the
contract `compare`, and a dozen call sites in the app, are written to. It also
holds the UID-prefix scan, which walks every element of every loaded file and
depends on `files[]` and nothing else, to running on an ordinary render and not
on one that only moves rows around.

**`series`** — a study as a stack. The oracle is the drop order itself: a two-series study
is handed to the real loader with the second series first and the last instance of each
series ahead of the rest of it, and what comes back has to be series/instance order, with
`groupSeries()` runs contiguous. The fallbacks get their own cases — unnumbered files
sorting `img1, img9, img10` rather than `img1, img10, img9`, and a three-way tie keeping
drop order, because a re-sort must never shuffle a study that was already right. On top of
that it drives the gesture: the wheel pages within a series and stops at its boundary, the
window/level and zoom the reader set survive a page and a move to another series still
resets them, ctrl+wheel and ⌘+wheel still zoom, and the tag table the light path skipped is
redrawn the moment the Edit tab is opened. Cine is asserted on frames advanced, never on
elapsed time — `--virtual-time-budget` freezes `performance.now()` inside a task — so
playback with loop off has to park on the last frame with no timer left behind, and with
loop on it has to wrap. `requestAnimationFrame` never fires at all under the harness
(measured: zero callbacks in a second of virtual time), so the wheel's frame-coalescing
flush is driven directly rather than waited on. Last, the decode-ordering guard: a stubbed
decoder that answers slowly for one frame and quickly for another is asked for both, and
the canvas has to hold the one that was asked for second.

**`deid`** — the PS3.15 optional profiles. The oracle here is the generated table in
`deid-profile.js` itself, which the suite first audits against the shape the standard has:
ten option columns, only `K` and `C` in them, and the exact keep/clean split per option
(59/0 for Retain UIDs, 46/11 for Retain Device Identity, 9/4 for Retain Patient
Characteristics, and so on). Then one forged subject carrying every attribute the five
offered options touch is run through the real Anonymize button — checkbox panel,
confirmation dialog and all, because the Retain-UIDs guard around `remapUIDs()` lives in
that click handler and a suite that called `anonymize()` by hand would test neither. Each
option is asserted twice over: the attributes it keeps come back byte for byte, and the
attributes it marks `C` do not, because this tool cannot clean and falls back to the Basic
Profile instead. The codes are the other half — `(0012,0064)` has to grow exactly one item
per profile applied, in a fixed order, with the CID 7050 code values PS3.16 lists, and
`(0012,0063)` has to stay multi-valued so that no value overflows LO's 64 characters.

**`samples`** — the demo study on the empty state, which is the first thing a visitor with
no DICOM file of their own can do. Each of the five is pushed through the real
`handleFiles()` and compared against the reference the forge computed for it, on the real
`#ovCanvas`, frame by frame for the cine. Beyond the pictures it holds three things the
corpus cannot: that `Forge.samples()` is byte-for-byte deterministic, so a `#sample=` link
keeps reproducing; that the buttons are siblings of `#ovDrop` and not children of it, since
`#ovDrop` is itself a click-to-browse target and a nested button would pop the OS file
dialog on every sample click; and that each sample's header is complete enough for the
Overview's own Conformance card to come back with zero errors *and* zero warnings — a demo
that opens with a wall of red is worse than no demo, and this is the assertion that makes
the samples grow when `SOP_ATTRS` does.

**`selftest`** — the report the other suites feed. `index.html#selftest` turns a flat list
of `PASS ::` lines into a public conformance claim ("your browser decoded 18 of 18 DICOM
encodings correctly"), and a number somebody pastes into an issue has to be as carefully
checked as the decoder it describes. So this suite never runs the other fourteen: it feeds
the summariser hand-built specimens whose right answer is known — two files sharing an
encoding, one encoding with a failing assertion, one unsupported by design, one nothing
asserts on — and checks that they land in the right rows, that a deliberately unsupported
file is counted as *refused* rather than as a decode, and that a single broken file does
not demote an encoding that also has good files in it. Around that: the attribution rule's
edges (`jls-rgb` must not swallow `jls-rgb-planar`), the transfer syntax and photometric
interpretation read back out of every corpus case's own bytes, the copied bug report's text,
the rendered tables, the route's three guards, and the Info-dropdown link's refusal to
discard an open study without asking. One assertion runs the harness for real, on `boot`,
because everything else is arithmetic on made-up input. It also checks its own list of
suites against the directory listing, where one is being served — `run.sh` globs the
directory and a browser cannot, so that list is the one thing that drifts in silence.

## What the corpus covers

8- and 16-bit greyscale; 12 and 16 bits stored; signed and unsigned; MONOCHROME1
raw and JPEG-compressed; Rescale Slope/Intercept in Hounsfield and PET scalings;
missing Window Center/Width; RGB in both planar configurations; YBR_FULL;
YBR_FULL_422; PALETTE COLOR with 16-bit lookup tables; multi-frame greyscale,
colour and JPEG; Implicit VR LE; Explicit VR BE; encapsulated baseline JPEG;
JPEG Lossless in colour and in 12-bit greyscale; RLE Lossless in
colour, 16-bit greyscale and multi-frame; JPEG 2000 in 12-bit greyscale and in
RGB with the reversible colour transform; JPEG-LS in 12-bit greyscale and in RGB
at both interleave modes; a single
JPEG frame split across three fragments; raw pixels whose first two bytes are
`FF D8` and so look like a JPEG SOI marker; and seven deliberately malformed or
undecodable files (truncated pixel data, window width zero, uncompressed
YBR_FULL_422, MPEG-2 video, a JPEG 2000 header with nothing behind it, the same
codestream cut off at 200 bytes, and High-Throughput JPEG 2000). The `redact` suite forges three more shapes of
its own on top of that corpus: a file whose High Bit is 15 with only 12 bits
stored, one already marked `(0028,0301) = YES` with the Lossy Image Compression
tags set, and an unreadable JPEG-LS stream, to check the refusal names the codec.

## What it caught

The first run was 20 of 196 assertions red, from six rendering defects. Those are
fixed, and the suites have since grown into the editor, where they found three
more. Everything below is what the tests now hold in place.

### Rendering

| Case | The defect | The fix |
| --- | --- | --- |
| `mono1-u16`, `mono1-jpeg` | MONOCHROME1 rendered as a photographic negative — nothing inverted for it except the Overview's manual Invert button, and the preview has no such button. Most CR, DX and mammography. | `applyWindowToFloats` takes an `invert` flag; the decoder sets it from the photometric interpretation and `fromBitmap` handles the compressed case. The toolbar button composes on top rather than substituting for it. |
| `mono2-s16-b16` | Signed pixels with Bits Stored 16 were sign-extended twice, sending every negative value to around −67000 so the dark half clipped to black. Bits Stored 12 was fine, which is why it looked intermittent. | Re-sign only when Bits Stored is narrower than the 16 allocated; shift arithmetically so the sign survives. |
| `ct-rescale-hu`, `pt-rescale-slope` | The Overview applied Rescale Slope/Intercept before windowing and the preview did not, so one CT was correct in one panel and blown out in the other. | Rescale moved into `decodeDicomPixels`. `rawFloats` now comes back in output units, which is the scale Window Center/Width are quoted in, and both surfaces window the same numbers. |
| `rgb-planar1` | Planar Configuration 1 was never read, so plane-ordered RGB was unpacked as interleaved and came out as three coloured bands. | Read (0028,0006) and index per plane. |
| `ybr-full` | YBR_FULL was matched as if it were RGB and copied channel for channel, with no YCbCr conversion. | Convert per PS3.3 C.7.6.3.1.2. |
| `palette-color` | PALETTE COLOR was refused outright — "No renderable pixel data in this file" — with the lookup tables in the file never read. | `readPaletteLut` reads the descriptor/data pairs, including 16-bit tables and the first-mapped offset. |
| `jpeg-lossless-rgb` | The JPEG Lossless branch windowed its output as greyscale whatever Samples per Pixel said, so a three-component image had one sample per pixel read out of a three-sample stream. Every row advanced a third as fast as it should: the picture came out stretched and torn rather than failing, which reads as a transmission fault. This is what UIH CT workstations write their secondary captures as. | The decoder already returns interleaved samples — raw pixel data by another name. It now feeds the uncompressed path, which handles samples per pixel, photometric interpretation, sign, rescale and windowing for every syntax alike. |
| `rle-rgb`, `rle-mono16`, `rle-multiframe` | RLE Lossless was in none of the transfer-syntax sets, so its fragments matched no magic bytes and execution fell through to the uncompressed path — drawing the compressed stream as pixels. Because run-length coding keeps bytes near their neighbours the result is not noise: it is the picture, torn diagonally, which reads as a transmission fault rather than a missing decoder. | `rleToRaw` unpacks the PackBits segments into the byte layout raw pixels would have had, so planar configuration, photometric interpretation and windowing are all served by the code that already existed. |
| `mpeg2-unsupported` | Same fall-through, general case: any encapsulated syntax without a decoder was rendered as though its bytes were pixels. | Anything still compressed when it reaches the raw path is refused by name. The exception is a buffer exactly the size raw pixels would occupy — then the syntax is simply mislabelled and the data really is raw. |
| `jpeg-split-fragments` | Only the first fragment of a split frame carries the SOI marker, so the rest were skipped as non-JPEG and the browser got a truncated image. | A single frame spread over several fragments is concatenated before decoding. |
| `ybr-422-jpeg` | Found while fixing the above: JPEG ultrasound cine is almost always YBR_FULL_422, and the old photometric test refused it before the JPEG decoder — which returns RGB anyway — ever ran. | Accept every YBR flavour at the gate; uncompressed subsampled chroma still refuses, but now says which photometric it cannot handle. |
| `j2k-mono16-b12`, `jls-mono16-b12` | JPEG 2000 and JPEG-LS were refused outright — the two syntaxes mammography and dental CR are most often archived in. Redaction refused them too, so identity burned into a J2K mammogram could not be removed by any means the tool offered. | Decode-only OpenJPEG and CharLS WASM, vendored and lazily loaded, feeding the same uncompressed path everything else uses. `decodeStoredFrames` reads them as well, so those files can now be redacted without losing a bit of depth. |
| `j2k-rgb-rct` | Would have shipped as a new silent-corruption bug. Colour JPEG 2000 is tagged YBR_RCT or YBR_ICT, which the raw path refused by name; a file tagged YBR_FULL would instead have been YCbCr-converted a second time on top of the inverse transform OpenJPEG had already applied — wrong colours, no error. | `preDecodedRGB` says the codec did the colour transform, and both the refusal and the second conversion are skipped when it is set. |
| `jls-rgb-planar` | JPEG-LS interleave mode 0 hands back whole component planes while `(0028,0006)` says 0, as PS3.5 A.4 requires of an encapsulated image. Trusting the tag turns the picture into three vertical bands. | `preDecodedPlanar` carries the codec's own layout into the existing planar unpacking and outranks the tag — nullish-coalesced, because 0 is a meaningful value there. |
| `jpeg2000-unsupported`, `j2k-truncated` | OpenJPEG's `decode()` does not throw on truncated, empty or garbage input: it returns a frameInfo of all zeros and an empty buffer. Without a check the app would have fallen into the raw path holding nothing. | Every decoded frame is measured against Rows, Columns and the byte length the header implies before it is accepted. |
| `htj2k-unsupported` | High-Throughput JPEG 2000 shares the `FF 4F FF 51` magic with Part 1 but not the block coder, and OpenJPEG 2.x does not implement Part 15 — so a magic-byte test would have handed it to a decoder that fails silently. | `.201`/`.202` are split out of the J2K set and refused by name, ahead of the branch that would otherwise claim them. |

### Edits

| The defect | The fix |
| --- | --- |
| `pendingEdits` was one map for the session, wiped and reseeded on every file switch — so unsaved work vanished, and Download All applied the visible file's values to every file in the range: one SOP Instance UID and one patient identity across a whole series. | The map lives on the file entry; `pendingEdits` is a pointer at the current one. `buildEditedFile` takes the entry, so a file can only ever be written with its own values. |
| Window/Level stored its edits under a hard-coded `x0028105x` key. The vendored dcmjs keys datasets without the prefix, so the slider never read its own value back and the writer emitted a second, bogus element beside the real Window Center. | `editKey` resolves whichever form the loaded file uses. |
| Editing a PersonName wrote the literal text `[object Object]` into the file — dcmjs reads PN as a string here and its writer stringifies whatever it is handed, so the `{Alphabetic}` objects never survived the round trip. Invisible in the UI, which renders both shapes. | `parseByVR` follows the shape the element is already in. |
| A sequence rendered as one row holding a run of backslashes — one per item boundary, which is what stringifying a list of item objects gives you — and everything inside it was unreachable: not in the table, not in the search box, not in the JSON/CSV export, not in the printed tag dump. `Anonymize` recurses, so a structured report's whole content tree could be cleaned and still not be readable, and two entirely different sequences read as a match whenever they held the same number of items. | The table builds a row tree instead of a flat list, addressed by path and opened per sequence and per item; `shownValue` gives a sequence its item count as the thing that compares; `flattenTags` gives the export and the print view the same walk. |
| A study is a folder, and a folder could not be loaded at all. Dropping one on the Overview card put the *directory* into `dataTransfer.files`, so it was read as a file and the user got a `NotFoundError` in the failure banner; dropping it on the Overview or Extract background did nothing whatsoever, because the window-level handler only had branches for the Create and Edit tabs. | `collectDropped` snapshots the DataTransfer synchronously — it is emptied the moment the handler returns — and walks `webkitGetAsEntry()` into `{file, path}` items; every drop site and both tabs route through it. |
| Files were identified by extension. A PACS export names its slices `IM000001`, so the picker's `accept=".dcm,.dicom"` hid them and `addExtractorFiles`' `['dcm','dicom']` test discarded them in silence even when they got that far. | The four bytes at offset 128 decide it, which is the same test dcmjs's `readFile` applies; the accept lists are gone and a `webkitdirectory` picker sits beside each of them. |
| Identity burned into the image could not be removed at all — the README said so outright. A redaction that overwrites the pixels then has a trap waiting for it: `buildEditedFile` replays the file's working copy over the dataset on its way out, so the `(0028,0301) = NO` it just wrote is silently replaced by the `YES` the stale working copy still holds. The exported file looks redacted on screen and ships marked un-redacted. | `applyRedaction` writes the stored samples for every box in every frame, retags the instance per PS3.15, and ends by reseeding the working copy from the new dataset — the reseed is the load-bearing line, and the suite asserts the exported `(0028,0301)` directly rather than the one on screen. |
| A big-endian file (Transfer Syntax `1.2.840.10008.1.2.2`) was already corrupted by an ordinary save: `ensureMeta` relabels it Explicit VR Little Endian, because that is what dcmjs writes, but nothing ever swapped the sample bytes — a value of 4095 came back as 3855. Found while building the redaction path, which has to swap anyway. | The raw redaction path swaps every 16-bit word before writing and sets the transfer syntax itself, so a redacted big-endian file round-trips with its picture intact. A plain edited export of a big-endian file is still affected. |
| Converting a browser-decoded JPEG to raw monochrome changed the image's contrast outside the boxes: a JPEG is displayed sample for sample, but the same samples stored as raw MONOCHROME with no Window Center are auto-windowed between their own minimum and maximum, restretching every grey. | The rewrite states the identity VOI the JPEG was already showing — Window Center 128, Window Width 256 for 8-bit — and only when the file carries no window of its own. |
| Download All lost files without saying so. It fired one anchor click per file, and a browser stops honouring automatic downloads after roughly ten of them — measured against the real page: 9 requested and 9 delivered, 12 requested and 10 delivered, 60 requested and 10 delivered, with no error, no cancellation and no event the page could see. The Range selector hands out chunks of 10, 50, 100 and 500, so every chunk above the first size lost files. The Extract tab had the same bug, and its 40ms spacing between clicks was not a fix: 60 frames still arrived as 30. | One store-only ZIP: one download, so there is nothing left to throttle. Method 0 because DICOM payloads are already compressed or already incompressible, the folder tree kept as the archive's own directory structure, colliding names numbered rather than overwritten, and the 32-bit limits refused loudly rather than wrapped into an archive that opens and hands back the wrong bytes. |
| `loadImage()` awaited a decode and then painted, with nothing tying the result to the request. Decode cost ranges from under a millisecond to tens of them depending on codec and size, so a slow earlier frame could land after a fast later one and leave the viewer showing the frame the user had already scrolled past — occasional when dragging the frame slider, constant once cine drives it thirty times a second. | A monotonic generation token taken at entry and re-checked after the await; a result that has been overtaken is dropped whole rather than partly applied. |
| `renderOverview` reset `wc/ww/zoom/pan/invert/cmap/rotate/flip` unconditionally, and `switchFile` always reached it through `syncToUI` — so paging a CT stack would have re-windowed the image on every tick, which is the opposite of what a stack scroll is for. | `renderOverview({ hardReset: false })` is the wheel-paging path and leaves the view state alone; every other caller keeps today's clean slate, so a different series still starts from its own window. The frame index is reset either way — it indexes the file that has just gone away. |
| Nested editing had a trap under it: `isReadOnly('00081140/0/00100010','PN')` was false and dcmjs's `Tag.fromString` stops at the `/`, so writing a path key produced a file whose (0008,1140) was a PN element — the entire sequence gone, silently, without throwing. | `buildEditedFile` branches on the path before the plain assignment and resolves it into the cloned dataset; `isReadOnly` judges the leaf, so nested pixel data inside an Icon Image Sequence stays read-only. |
| The optional profiles were not exposed at all, and `(0012,0063)` was a single fixed string. Both would have broken quietly the moment options arrived: `remapUIDs()` walks every UI element regardless of the profile table, so Retain UIDs is a no-op unless the call itself is skipped, and `retagRedacted` read `(0012,0063)` value 1 and wrote one concatenated string back, which would have dropped every option meaning `addDeidMeta` had just recorded. | The click handler reads the checkboxes and skips `remapUIDs()` for Retain UIDs; `(0012,0063)` is multi-valued (LO is 64 characters, and one option meaning alone is 57 of them) and redaction appends a value rather than rewriting one. |
| The Overview's Conformance card reported **Study Instance UID, Series Instance UID and Pixel Data as "Missing — Type 1 required" on every file the app has ever opened**, real or forged. `validateDicom`'s lookups were `d['x' + tag.toLowerCase()] ?? d[tag]` on a tag the caller had already lowercased, and dcmjs keys datasets in UPPERCASE 8-hex — so every tag whose hex contains a letter A–F came back absent. Found by pointing the forge at the validator: the samples were built with a complete header and the card still opened red. | Both lookups go through the existing `getTag`, which tries all four key forms. `getVal` also had to learn that an OB/OW element holds ArrayBuffers, since stringifying one gives `''` and the Type 1 check then called a file that is nothing but pixels "Empty". The `samples` suite asserts zero errors and zero warnings per sample, with a control that deletes a real (0020,000E) and requires it to be reported, so the fix cannot have blinded the validator instead. |
