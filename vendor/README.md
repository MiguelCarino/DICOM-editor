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
resolve against whatever origin is serving the page and 404 there rather than
leaving the building; keep it that way.

## The copy inside Carino PACS

Carino PACS bundles this editor and serves it from its dashboard, so this tree
exists twice. Keep the two byte-identical: a divergence here is a divergence in
what a hospital is running.

That copy carries two things this one does not, and a careless `cp -r` in either
direction destroys them:

* **`pacs/web/editor/vendor/README.md`** — its own version of this file. PACS
  redistributes these bundles inside a shipped binary and a container image,
  which a static site users visit does not, and that is a different obligation
  written up in different words. Do not overwrite it with this one.
* **`pacs/web/editor/tests/pn-roundtrip.e2e.mjs`** — a Node check that a Person
  Name survives a load-and-save untouched. It exists because it once did not:
  `parseByVR` built the `{Alphabetic, Ideographic, Phonetic}` shape of a
  *naturalised* dcmjs dataset, while the raw dict this editor holds carries PN
  as a plain string in both directions in dcmjs 0.29.8, so the writer stringified
  the object to the literal `[object Object]` — on every PN tag, on a plain open
  and save with nothing edited. `parseByVR` follows the shape the element is
  already in now, and `tests/suites/edits.js` asserts it here. Run the PACS suite
  after any dcmjs bump anyway: the read and write shapes are not symmetric, and a
  version that starts returning objects from `readBytes` would need that branch
  to change again.
