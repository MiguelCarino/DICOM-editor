# Tests

    ./tests/run.sh              # every suite
    ./tests/run.sh pixels       # named suites only

Needs `chromium-browser` on PATH (override with `CHROME=...`). No npm, no build
step — the app is static files and the tests run it as the browser would, over a
throwaway HTTP server rather than `file://`.

There are no fixture files. `dicom-forge.js` writes real Part-10 byte streams in
the browser at run time — preamble, file meta group, dataset, encapsulated
fragments and all — and hands each one to the app through `DicomMessage.readFile`,
the same entry point a dropped file goes through.

## The oracle

Every case carries two things that never touch each other:

* **the bytes**, encoded from a set of sample values
* **the reference image**, computed *from those same sample values* by a separate
  implementation of windowing, rescale and photometric interpretation

So a case passes only when the app's decoder and PS3.3 agree. A decoder that is
wrong in a self-consistent way still fails, which is the whole point — comparing
the app against itself would have found none of the six problems below.

`tests/gallery.html` is the same corpus with the reference images drawn out and a
download button on each. Open it, save a case, drop it into
[dicom.carino.systems](https://dicom.carino.systems) and compare by eye. It is
the quickest way to confirm a fix on the real site.

## The suites

**`pixels`** — `decodeDicomPixels()` on its own. For greyscale it asserts on
`rawFloats`, the stored values the decoder recovered, because that is what has to
be right regardless of which layer later applies rescale or inversion; sign
handling, bit masking, byte order and frame offsets all surface here as a wrong
minimum or maximum. Colour has nothing applied after it, so colour cases are
compared pixel for pixel.

**`viewer`** — what a person actually sees. Installs each forged file into the
app's own state and drives both display surfaces: the Overview viewer
(`renderOverview`) and the editor's preview thumbnail (`drawPreview`). It also
checks the two against *each other*, independent of which one is right — a file
cannot legitimately look like two different images in two panels of one page.

## What the corpus covers

8- and 16-bit greyscale; 12 and 16 bits stored; signed and unsigned; MONOCHROME1
raw and JPEG-compressed; Rescale Slope/Intercept in Hounsfield and PET scalings;
missing Window Center/Width; RGB in both planar configurations; YBR_FULL;
YBR_FULL_422; PALETTE COLOR with 16-bit lookup tables; multi-frame greyscale,
colour and JPEG; Implicit VR LE; Explicit VR BE; encapsulated baseline JPEG;
JPEG 2000; and five deliberately malformed or undecodable files (truncated pixel
data, window width zero, uncompressed YBR_FULL_422, and raw pixels whose first
two bytes are `FF D8` and so look like a JPEG SOI marker).

## What it caught

The first run was 20 of 196 assertions red, from six defects. All six are fixed;
the entries below are what the suite is now holding in place.

| Case | The defect | The fix |
| --- | --- | --- |
| `mono1-u16`, `mono1-jpeg` | MONOCHROME1 rendered as a photographic negative — nothing inverted for it except the Overview's manual Invert button, and the preview has no such button. Most CR, DX and mammography. | `applyWindowToFloats` takes an `invert` flag; the decoder sets it from the photometric interpretation and `fromBitmap` handles the compressed case. The toolbar button composes on top rather than substituting for it. |
| `mono2-s16-b16` | Signed pixels with Bits Stored 16 were sign-extended twice, sending every negative value to around −67000 so the dark half clipped to black. Bits Stored 12 was fine, which is why it looked intermittent. | Re-sign only when Bits Stored is narrower than the 16 allocated; shift arithmetically so the sign survives. |
| `ct-rescale-hu`, `pt-rescale-slope` | The Overview applied Rescale Slope/Intercept before windowing and the preview did not, so one CT was correct in one panel and blown out in the other. | Rescale moved into `decodeDicomPixels`. `rawFloats` now comes back in output units, which is the scale Window Center/Width are quoted in, and both surfaces window the same numbers. |
| `rgb-planar1` | Planar Configuration 1 was never read, so plane-ordered RGB was unpacked as interleaved and came out as three coloured bands. | Read (0028,0006) and index per plane. |
| `ybr-full` | YBR_FULL was matched as if it were RGB and copied channel for channel, with no YCbCr conversion. | Convert per PS3.3 C.7.6.3.1.2. |
| `palette-color` | PALETTE COLOR was refused outright — "No renderable pixel data in this file" — with the lookup tables in the file never read. | `readPaletteLut` reads the descriptor/data pairs, including 16-bit tables and the first-mapped offset. |
| `ybr-422-jpeg` | Found while fixing the above: JPEG ultrasound cine is almost always YBR_FULL_422, and the old photometric test refused it before the JPEG decoder — which returns RGB anyway — ever ran. | Accept every YBR flavour at the gate; uncompressed subsampled chroma still refuses, but now says which photometric it cannot handle. |
