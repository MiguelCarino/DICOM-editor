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
and MONOCHROME2; Rescale Slope/Intercept in Hounsfield and PET scalings; missing
Window Center/Width; RGB in both planar configurations; YBR_FULL; PALETTE COLOR;
multi-frame greyscale, colour and JPEG; Implicit VR LE; Explicit VR BE;
encapsulated baseline JPEG; JPEG 2000; and four deliberately malformed files
(truncated pixel data, window width zero, and raw pixels whose first two bytes
are `FF D8` and so look like a JPEG SOI marker).

## Known failures

As of the first run: **20 of 196 assertions fail**, from six distinct defects.
They are left failing on purpose — the suite is the bug list.

| Case | What happens | Where |
| --- | --- | --- |
| `mono1-u16` | MONOCHROME1 renders as a photographic negative. Nothing inverts for it; only the manual Invert button does, and the preview has no such button. Affects most CR, DX and mammography. | `index.html` — `applyWindowToFloats` (~3342) and the overview's `paint` (~6269) |
| `mono2-s16-b16` | Signed pixels with Bits Stored 16 are sign-extended twice, so every negative value lands around −67000 and the dark half of the image clips to black. Bits Stored 12 is fine. | `applyMonochromeWindowing` (~3456) |
| `ct-rescale-hu`, `pt-rescale-slope` | The Overview applies Rescale Slope/Intercept before windowing; the preview thumbnail does not. The same CT is correct in one panel and blown out in the other. | rescale lives at ~6311, inside the overview, instead of in the shared decoder |
| `rgb-planar1` | Planar Configuration 1 is never read, so plane-ordered RGB is unpacked as if interleaved and comes out as three coloured bands. | `decodeDicomPixels` RGB branch (~3536) |
| `ybr-full` | YBR_FULL is matched as if it were RGB and copied channel for channel with no YCbCr conversion. | `isRGB` test (~3386) |
| `palette-color` | PALETTE COLOR is rejected outright: "No renderable pixel data in this file." The LUTs in the file are never read. | photometric test (~3385) |

Everything else passes, including Implicit VR, Explicit VR Big Endian, baseline
JPEG, frame indexing on all three multi-frame kinds, and the `FF D8` trap.
