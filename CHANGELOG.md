# Changelog

All notable changes to Carino DICOM Editor. Versions follow [Semantic Versioning](https://semver.org/).
Licensed under **AGPL-3.0-or-later** (see [LICENSE](LICENSE)).

## [1.0.0] — 2026-08-30

First tagged release. One static `index.html`, everything client-side.

### Added
- **Tag editing** — view, edit, create, compare and validate DICOM objects in
  the browser. Tag names and VRs come from a complete bundled PS3.6 data
  dictionary (5041 attributes plus 88 repeating-group masks), looked up in
  layers, so every attribute in the standard resolves rather than reading back
  as an unknown tag.
- **De-identification** — the PS3.15 Annex E Table E.1-1 Basic Profile, 618
  attributes generated from the machine-readable standard, with a UID remap kept
  consistent across the whole loaded set so internal references survive. Five
  optional profiles sit behind a button, all off by default, and each one
  records itself in `(0012,0063)` and `(0012,0064)`.
- **Burned-in pixel redaction** — identity printed into the image is not
  reachable by any tag edit, so it gets a full-screen workspace of its own that
  overwrites those samples in the stored pixel data.
- **Image edits** — rotate, flip and invert the **stored** pixels, so what comes
  out of Download opens the right way up in every other reader. Nothing is
  resampled: every operation is a permutation of whole samples. The Overview's
  own controls turn the picture on screen and change no file, which is why the
  two live under different labels.
- **Study viewing** — a dropped folder is a stack rather than a list, sorted by
  Series Number, then Instance Number, falling back to a natural sort on the
  filename for exports that number nothing.
- **Five samples**, forged in the browser through the ordinary load path — no
  patient ever existed and nothing is fetched — plus `#sample=` and `#case=`
  deep links that make every card in the reference gallery a one-click
  reproduction.
- **Desktop application** — an Electron shell that serves the whole tool from an
  internal `app://` origin, dcmjs and the dictionary and the WASM codecs
  included, so the app never asks the network for any part of itself.
- **Five languages** — English, Spanish, Brazilian Portuguese, Japanese and
  Russian, from one dictionary the parity checker keeps honest.
- **Nothing leaves the machine.** No upload, no server, no telemetry, no licence
  check. The desktop update notice is opt-in and downloads nothing.

### Verification

- The suites pass. Each is injected into a copy of the real `index.html` and run
  in headless Chromium against the real functions — no build step, nothing
  mocked. The oracle writes DICOM files byte by byte and computes what each one
  is supposed to look like from the samples it was built from rather than from
  the bytes, so a decoder that is self-consistently wrong still fails.
- **The builds are unsigned**, and no build has been launched from an installer
  on a machine that did not produce it. macOS ships one universal `.dmg`,
  Windows an x64 installer, and Linux an `.AppImage` for x86-64 and one for
  arm64; the arm64 build has never been started on arm64 hardware. What the
  workflow proves is that they packaged.
- Nothing in this release has been through a formal validation of any kind, and
  none of it is a medical device.
