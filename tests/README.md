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
PackBits and for JPEG Lossless, so the compressed syntaxes are exercised by
streams an independent implementation produced rather than by recorded bytes.

## The oracle

Every case carries two things that never touch each other:

* **the bytes**, encoded from a set of sample values
* **the reference image**, computed *from those same sample values* by a separate
  implementation of windowing, rescale and photometric interpretation

So a case passes only when the app's decoder and PS3.3 agree. A decoder that is
wrong in a self-consistent way still fails, which is the whole point — comparing
the app against itself would have found none of the problems below.

`tests/gallery.html` is the same corpus with the reference images drawn out and a
download button on each. Open it, save a case, drop it into
[dicom.carino.systems](https://dicom.carino.systems) and compare by eye. It is
the quickest way to confirm a fix on the real site.

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
the one you happened to be looking at.

**`compare`** — what happens when a second file is shown beside the first.
Comparing is a mode of the editor's table rather than a separate screen, so this
asserts the things that only hold if it really is the same table — the category
filter and search still rule it, both columns are editable and belong to their own file, and
closing the comparison leaves the editor exactly as it was.

## What the corpus covers

8- and 16-bit greyscale; 12 and 16 bits stored; signed and unsigned; MONOCHROME1
raw and JPEG-compressed; Rescale Slope/Intercept in Hounsfield and PET scalings;
missing Window Center/Width; RGB in both planar configurations; YBR_FULL;
YBR_FULL_422; PALETTE COLOR with 16-bit lookup tables; multi-frame greyscale,
colour and JPEG; Implicit VR LE; Explicit VR BE; encapsulated baseline JPEG;
JPEG 2000; JPEG Lossless in colour and in 12-bit greyscale; RLE Lossless in
colour, 16-bit greyscale and multi-frame; a single
JPEG frame split across three fragments; and six deliberately malformed or
undecodable files (truncated pixel data, window width zero, uncompressed
YBR_FULL_422, MPEG-2 video, and raw pixels whose first two bytes are `FF D8` and
so look like a JPEG SOI marker).

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

### Edits

| The defect | The fix |
| --- | --- |
| `pendingEdits` was one map for the session, wiped and reseeded on every file switch — so unsaved work vanished, and Download All applied the visible file's values to every file in the range: one SOP Instance UID and one patient identity across a whole series. | The map lives on the file entry; `pendingEdits` is a pointer at the current one. `buildEditedFile` takes the entry, so a file can only ever be written with its own values. |
| Window/Level stored its edits under a hard-coded `x0028105x` key. The vendored dcmjs keys datasets without the prefix, so the slider never read its own value back and the writer emitted a second, bogus element beside the real Window Center. | `editKey` resolves whichever form the loaded file uses. |
| Editing a PersonName wrote the literal text `[object Object]` into the file — dcmjs reads PN as a string here and its writer stringifies whatever it is handed, so the `{Alphabetic}` objects never survived the round trip. Invisible in the UI, which renders both shapes. | `parseByVR` follows the shape the element is already in. |
