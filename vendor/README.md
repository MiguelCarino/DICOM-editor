# Third-party code bundled with the DICOM tag editor

Everything this editor needs is in this tree. It loads no script, style, font,
map or module from anywhere but its own origin — no CDN, no network, no account.
That is what lets the tool run on an air-gapped hospital network, and it is why
the licences of everything here travel with the files rather than living in a
lockfile somewhere.

**The rule for this directory is absolute:** no reference under `vendor/` may
resolve off-origin. Not a `<script src>`, not an `@import`, not a web font, not
a worker URL, not a source map.

The identical tree is bundled inside Carino PACS, which serves this editor from
its dashboard; the two are kept byte-identical on purpose.

## What is here, and under what licence

| File | Package | Version | Licence | Text |
| --- | --- | --- | --- | --- |
| `dcmjs.min.js` | [dcmjs](https://github.com/dcmjs-org/dcmjs) | 0.29.8 | MIT | `LICENSE-dcmjs.txt` |
| `lossless-min.js` | [jpeg-lossless-decoder-js](https://github.com/rii-mango/JPEGLosslessDecoderJS) | 2.1.2 | MIT | `LICENSE-jpeg-lossless-decoder-js.txt` |
| `openjpegwasm_decode.js` | [@cornerstonejs/codec-openjpeg](https://github.com/cornerstonejs/codecs) | 1.3.0 | MIT | `LICENSE-codec-openjpeg.txt` |
| `openjpegwasm_decode.wasm` | [@cornerstonejs/codec-openjpeg](https://github.com/cornerstonejs/codecs) | 1.3.0 | MIT | `LICENSE-codec-openjpeg.txt` |
| `charlswasm_decode.js` | [@cornerstonejs/codec-charls](https://github.com/cornerstonejs/codecs) | 1.2.3 | MIT | `LICENSE-codec-charls.txt` |
| `charlswasm_decode.wasm` | [@cornerstonejs/codec-charls](https://github.com/cornerstonejs/codecs) | 1.2.3 | MIT | `LICENSE-codec-charls.txt` |

The two `*wasm_decode.*` pairs are the JPEG 2000 and JPEG-LS decoders, loaded
lazily and only when a file of that transfer syntax is opened. The
**decode-only** builds are deliberate: the full builds carry encoders this
editor never calls, and cost 112 KB and 72 KB more of WebAssembly for nothing.
Do not rename the four files — `locateFile` is what resolves the `.wasm` beside
its loader, and keeping upstream's names is what keeps a refresh diffable.

Those MIT notices cover the emscripten wrappers only. The C libraries compiled
*into* the `.wasm` are separate works under separate terms, and shipping a
binary is exactly what triggers their notice clause:

| Compiled inside the `.wasm` | Licence | Text |
| --- | --- | --- |
| [OpenJPEG](https://github.com/uclouvain/openjpeg) (inside `openjpegwasm_decode.wasm`) | BSD 2-Clause | `LICENSE-openjpeg.txt` |
| [CharLS](https://github.com/team-charls/charls) (inside `charlswasm_decode.wasm`) | BSD 3-Clause | `LICENSE-charls.txt` |

`dcmjs.min.js` is the jsDelivr build of `dcmjs@0.29.8/build/dcmjs.js`, which is
a bundle: three of its dependencies are compiled into the file we ship, so their
licences travel with it and are reproduced here too.

| Bundled inside `dcmjs.min.js` | Licence | Text |
| --- | --- | --- |
| [pako](https://github.com/nodeca/pako) 2.0.4 | MIT (with zlib-licensed portions) | `LICENSE-pako.txt` |
| [loglevelnext](https://github.com/shellscape/loglevelnext) 3.x | MPL-2.0 | `LICENSE-loglevelnext.txt` |
| [core-js](https://github.com/zloirock/core-js) (via `@babel/runtime-corejs3`) | MIT | `LICENSE-core-js.txt` |

The one that needs a word of explanation is loglevelnext, because MPL-2.0 next
to AGPL-3.0 is the kind of pairing that looks wrong at a glance. It is fine, and
specifically: none of loglevelnext's source files carries the Exhibit B
"Incompatible With Secondary Licenses" notice, so MPL-2.0 §3.3 permits its
distribution as part of a Larger Work under a Secondary License, and the GNU
AGPL v3 is named as a Secondary License in §1.13. The MPL still governs those
files themselves, which is why the full text is here rather than summarised.

The self-hosted web fonts under `../fonts/` are SIL Open Font License 1.1 and
carry their licences beside them — `../fonts/LICENSE-IBMPlex.txt` (IBM Plex Sans
and IBM Plex Mono) and `../fonts/LICENSE-RedHat.txt` (Red Hat Text and Red Hat
Display). The OFL requires the licence to be distributed with the font files, so
those two files are not optional bookkeeping.

## Refreshing a bundle

Fetch the exact version, and take the licence in the same breath — the licence
going stale against the code is the failure mode this table exists to prevent:

    npm pack dcmjs@<version>
    tar xzf dcmjs-<version>.tgz
    cp package/License.txt LICENSE-dcmjs.txt

    npm pack @cornerstonejs/codec-openjpeg@<version>
    tar xzf cornerstonejs-codec-openjpeg-<version>.tgz
    cp package/dist/openjpegwasm_decode.js package/dist/openjpegwasm_decode.wasm .
    cp package/LICENSE LICENSE-codec-openjpeg.txt

    npm pack @cornerstonejs/codec-charls@<version>
    tar xzf cornerstonejs-codec-charls-<version>.tgz
    cp package/dist/charlswasm_decode.js package/dist/charlswasm_decode.wasm .
    cp package/LICENSE LICENSE-codec-charls.txt

The two BSD texts are not in those tarballs and have to be taken from upstream
in the same breath, or the binaries ship without the notice their licences
require:

    curl -o LICENSE-openjpeg.txt https://raw.githubusercontent.com/uclouvain/openjpeg/master/LICENSE
    curl -o LICENSE-charls.txt  https://raw.githubusercontent.com/team-charls/charls/master/LICENSE.md

One thing to know before touching how those two are loaded: **they are UMD
bundles, so `index.html` pulls them in with a `<script>` tag, not `import()`.**
Their export tail only fires for CommonJS or AMD, so a dynamic import resolves
to a namespace with zero keys — no error, no rejection, nothing to debug. Making
them match the `import()` two lines above, which is what the next person will
want to do, breaks JPEG 2000 and JPEG-LS silently.

Then re-read the new bundle for anything that points off-origin before shipping
it. Minifiers append a `//# sourceMappingURL=` comment, CDN builds sometimes
carry an absolute one, and a map URL is a real request the moment a browser has
devtools open. The maps we ship are named relatively or root-relatively, so they
resolve against the operator's own engine and 404 there rather than leaving the
building; keep it that way.

## If you are syncing from upstream DICOM-editor

The editor is a vendored copy of https://github.com/MiguelCarino/DICOM-editor.
Upstream is where the self-hosting was done — the fonts and both bundles are
already local there, so nothing had to move to make this copy offline-clean.

Four things exist only here, and a careless `cp -r` from upstream deletes all
four — the third one silently, and it corrupts studies when it goes:

1. **The licensing and provenance in this directory** — this README, the nine
   `LICENSE-*.txt` files here, and the two in `../fonts/`. Carino PACS
   redistributes these bundles inside a shipped binary and a container image,
   which upstream (a static site users visit) does not; that is why the
   obligation lands here.
2. **One rename in `index.html`**: the constant holding the JPEG-lossless module
   path is `JPEG_LOSSLESS_MODULE`, not upstream's `JPEG_LOSSLESS_CDN`. Same
   value, same two lines — but the old name is how a security review concluded
   this editor pulls from a CDN when it does not, and that misreading costs more
   here than upstream because here it contradicts a documented guarantee.
3. **The PN fix in `index.html`'s `parseByVR()`**: upstream builds a Person Name
   as `{Alphabetic, Ideographic, Phonetic}`; here the `case 'PN'` is gone and PN
   falls through to the plain-string default. That object is the shape of a
   *naturalised* dcmjs dataset. The raw dict this editor holds — the one
   `DicomMessage.readFile` returns and `DicomDict.write` consumes — carries PN
   as a string in both directions in dcmjs 0.29.8, so the writer stringified the
   object to the literal `[object Object]`. Because `downloadRange()` rewrites
   every tag in `pendingEdits`, and `pendingEdits` is seeded with the whole
   dataset at load, upstream destroys `PatientName`, `ReferringPhysicianName`
   and every other PN tag on a plain open-and-save with nothing edited. Verified
   in headless Chromium: with the fix, load-and-save-untouched is byte-identical
   to the input, and editing a PN, editing a non-PN and Anonymize All all write
   well-formed names.

   The check is `../tests/pn-roundtrip.e2e.mjs`, which is the fourth thing that
   exists only here:

       node pacs/web/editor/tests/pn-roundtrip.e2e.mjs

   Read dcmjs's `PersonName` value representation before any bundle refresh, and
   run that suite after. Its read and write shapes are not symmetric, and a
   version that starts returning objects from `readBytes` would need the `case`
   back — the suite is how you find that out in a minute instead of from a site
   that reports corrupt names a year later.

Copy the source files, keep these. Or push them upstream, which is better —
number 3 especially, since upstream corrupts every study it saves today.
