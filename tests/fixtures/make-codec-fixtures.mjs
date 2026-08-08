// Regenerates the JPEG 2000 and JPEG-LS codestreams that tests/dicom-forge.js
// carries as base64 constants. Run by hand, never by tests/run.sh:
//
//     node tests/fixtures/make-codec-fixtures.mjs
//
// It needs npm and the network, which the suites deliberately do not. The
// output is four `const` lines to paste over the ones in dicom-forge.js.
//
// Why the fixtures are checked in rather than encoded at test time: the app
// vendors decode-only WASM builds, so there is no encoder in the browser to
// forge a J2K or JPEG-LS stream with the way `jpegLossless()` and `rleFrame()`
// forge theirs. Read the "How strong each oracle is" section of tests/README.md
// before trusting what these fixtures prove — they are a weaker oracle than the
// rest of the corpus, and the reason is written down there.
//
// pattern() and colorPattern() below are COPIES of the ones in
// tests/dicom-forge.js. They have to stay identical: the forge computes the
// reference image from its own copy and never looks at these bytes, so a drift
// between the two would show up as every J2K and JPEG-LS assertion failing at
// once with no obvious cause.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OPENJPEG = '@cornerstonejs/codec-openjpeg@1.3.0';
const CHARLS = '@cornerstonejs/codec-charls@1.2.3';

const W = 32, H = 32;

// --- copies of the forge's rasters, kept in sync by hand ---------------------

function pattern(w, h) {
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = x / (w - 1);
      if (x < 5 && y < 5) v = 1;
      if (x >= w - 5 && y >= h - 5) v = 0;
      f[y * w + x] = v;
    }
  }
  return f;
}

function colorPattern(w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      rgb[i] = Math.round(255 * x / (w - 1));
      rgb[i + 1] = Math.round(255 * y / (h - 1));
      rgb[i + 2] = (x < 8 && y < 8) ? 255 : 0;
    }
  }
  return rgb;
}

// --- fetching the encoders ---------------------------------------------------

// The FULL builds, not the *_decode ones the repo vendors: only these carry
// J2KEncoder and JpegLSEncoder. Nothing from this directory is checked in.
function fetchPackages() {
  const dir = mkdtempSync(join(tmpdir(), 'dicom-codec-fixtures-'));
  // stdout stays clean so the whole run can be piped straight into a patch;
  // npm's own chatter goes to stderr with everything else.
  execFileSync('npm', ['pack', OPENJPEG, CHARLS], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  for (const tgz of readdirSync(dir).filter(f => f.endsWith('.tgz'))) {
    execFileSync('tar', ['xzf', tgz], { cwd: dir });
    renameSync(join(dir, 'package'), join(dir, tgz.replace(/-\d[\d.]*\.tgz$/, '')));
  }
  return dir;
}

// --- encoding ----------------------------------------------------------------

const b64 = (u8) => Buffer.from(u8).toString('base64');

// The encoders hand back a view into the wasm heap; copy it out before the next
// call grows or reuses that heap.
const copyOut = (view) => new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));

function encodeJ2K(mod, samples, frameInfo) {
  const enc = new mod.J2KEncoder();
  try {
    const dst = enc.getDecodedBuffer(frameInfo);
    dst.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    enc.setQuality(true, 1);          // reversible 5/3 wavelet, no quantisation
    enc.setDecompositions(3);
    enc.encode();
    return copyOut(enc.getEncodedBuffer());
  } finally { enc.delete(); }
}

function encodeJLS(mod, samples, frameInfo, interleave) {
  const enc = new mod.JpegLSEncoder();
  try {
    const dst = enc.getDecodedBuffer(frameInfo);
    dst.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    enc.setNearLossless(0);           // 0 is lossless; anything else is not an oracle
    enc.setInterleaveMode(interleave);
    enc.encode();
    return copyOut(enc.getEncodedBuffer());
  } finally { enc.delete(); }
}

// --- main --------------------------------------------------------------------

const dir = fetchPackages();
const require_ = createRequire(join(dir, 'x.js'));
const openjpeg = await require_('./cornerstonejs-codec-openjpeg/dist/openjpegwasm.js')({ print() {}, printErr() {} });
const charls = await require_('./cornerstonejs-codec-charls/dist/charlswasm.js')({ print() {}, printErr() {} });

const n = W * H;
const p = pattern(W, H);
const rgb = colorPattern(W, H);

// 12 bits of real precision inside 16 allocated — the case where a decoder that
// assumes 8 or 16 bits per sample is wrong by a whole byte per pixel.
const mono12 = new Uint16Array(n);
for (let i = 0; i < n; i++) mono12[i] = Math.round(p[i] * 4095);

// CharLS interleave mode 0 describes the *buffer*, not just the bitstream: the
// encoder reads planes, and the decoder writes them back the same way. Feeding
// it the interleaved raster would encode RGBRGB… as though it were three planes
// and silently produce a fixture of the wrong picture.
const rgbPlanar = new Uint8Array(n * 3);
for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) rgbPlanar[c * n + i] = rgb[i * 3 + c];

const out = {
  J2K_MONO16_B12: encodeJ2K(openjpeg, mono12,
    { width: W, height: H, bitsPerSample: 12, componentCount: 1, isSigned: false }),
  // componentCount 3 makes the encoder apply the reversible multi-component
  // transform, which is what a colour J2K in the wild carries and what the
  // decoder has to invert on the way back.
  J2K_RGB_RCT: encodeJ2K(openjpeg, rgb,
    { width: W, height: H, bitsPerSample: 8, componentCount: 3, isSigned: false }),
  JLS_MONO16_B12: encodeJLS(charls, mono12,
    { width: W, height: H, bitsPerSample: 12, componentCount: 1, isSigned: false }, 0),
  // Interleave 2 is sample-interleaved (RGBRGB…), the ordinary layout.
  JLS_RGB: encodeJLS(charls, rgb,
    { width: W, height: H, bitsPerSample: 8, componentCount: 3, isSigned: false }, 2),
  // Interleave 0 is component-planar (RRR…GGG…BBB…), the same layout as Planar
  // Configuration 1 — and the one that tears into three bands if the codec's
  // reported interleave mode is ignored in favour of tag (0028,0006).
  JLS_RGB_PLANAR: encodeJLS(charls, rgbPlanar,
    { width: W, height: H, bitsPerSample: 8, componentCount: 3, isSigned: false }, 0),
};

// Round-trip each one through the DECODE-ONLY builds the repo actually vendors,
// so a fixture that only the full build can read never reaches the suites.
const ojDec = await require_('./cornerstonejs-codec-openjpeg/dist/openjpegwasm_decode.js')({ print() {}, printErr() {} });
const clDec = await require_('./cornerstonejs-codec-charls/dist/charlswasm_decode.js')({ print() {}, printErr() {} });

function verify(name, bytes, Decoder, want) {
  const d = new Decoder();
  let got, info;
  try {
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.decode();
    info = d.getFrameInfo();
    got = copyOut(d.getDecodedBuffer());
  } finally { d.delete(); }
  const wantBytes = new Uint8Array(want.buffer, want.byteOffset, want.byteLength);
  let bad = 0;
  for (let i = 0; i < wantBytes.length; i++) if (got[i] !== wantBytes[i]) bad++;
  console.error(`${name}: ${info.width}x${info.height} ${info.bitsPerSample}bit x${info.componentCount}, ` +
                `${bytes.length} bytes, ${bad} sample byte(s) wrong`);
  if (bad || got.length !== wantBytes.length) process.exitCode = 1;
}

verify('J2K_MONO16_B12', out.J2K_MONO16_B12, ojDec.J2KDecoder, mono12);
verify('J2K_RGB_RCT', out.J2K_RGB_RCT, ojDec.J2KDecoder, rgb);
verify('JLS_MONO16_B12', out.JLS_MONO16_B12, clDec.JpegLSDecoder, mono12);
verify('JLS_RGB', out.JLS_RGB, clDec.JpegLSDecoder, rgb);
verify('JLS_RGB_PLANAR', out.JLS_RGB_PLANAR, clDec.JpegLSDecoder, rgbPlanar);

console.log('\n// Generated by tests/fixtures/make-codec-fixtures.mjs — see that file before editing.');
for (const [k, v] of Object.entries(out)) {
  const s = b64(v);
  const lines = s.match(/.{1,96}/g).map(l => `    '${l}'`).join(' +\n');
  console.log(`  const ${k} =\n${lines};`);
}
