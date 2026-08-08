// Forges DICOM Part-10 files in the browser, and renders what each one is
// *supposed* to look like.
//
// The point is to have an oracle the app has never seen. Forge.corpus() hands
// back a list of cases; each one carries the encoded bytes on one side and, on
// the other, an independently computed RGBA buffer derived from the source
// samples — never from the bytes. So a case can only pass if the app's decoder
// and the standard agree; a decoder that is self-consistently wrong still fails.
//
// Used by tests/suites/*.js (assertions) and tests/gallery.html (eyeballs).
(function () {
  'use strict';

  // ---------------------------------------------------------------- writing --

  // Explicit VR keeps the length in 2 bytes for these, 4 (after 2 reserved) for
  // everything else. Getting this wrong shifts every following tag.
  const SHORT_VR = new Set(['AE','AS','AT','CS','DA','DS','DT','FL','FD','IS','LO',
                            'LT','PN','SH','SL','SS','ST','TM','UI','UL','US']);
  const TEXT_VR  = new Set(['AE','AS','CS','DA','DS','DT','IS','LO','LT','PN','SH',
                            'ST','TM','UI','UC','UT']);

  // Text values are byte order agnostic; binary ones are not, so `be` has to
  // reach all the way down here — a big-endian file with little-endian Rows is
  // a file nothing can read.
  function bytesOfValue(vr, v, be) {
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    const arr = Array.isArray(v) ? v : [v];
    if (TEXT_VR.has(vr)) {
      let s = arr.join('\\');
      if (s.length % 2) s += (vr === 'UI' ? '\0' : ' ');   // UI pads with NUL, the rest with space
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
      return out;
    }
    let width;
    if (vr === 'US' || vr === 'SS') width = 2;
    else if (vr === 'UL') width = 4;
    else throw new Error('forge: no encoder for VR ' + vr);
    const out = new Uint8Array(arr.length * width);
    arr.forEach((n, k) => out.set(width === 2 ? u16(n, be) : u32(n, be), k * width));
    return out;
  }

  function concat(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function u16(v, be) {
    const a = new Uint8Array(2);
    if (be) { a[0] = (v >> 8) & 0xFF; a[1] = v & 0xFF; }
    else    { a[0] = v & 0xFF; a[1] = (v >> 8) & 0xFF; }
    return a;
  }
  function u32(v, be) {
    const a = new Uint8Array(4);
    if (be) { a[0] = (v >>> 24) & 0xFF; a[1] = (v >>> 16) & 0xFF; a[2] = (v >>> 8) & 0xFF; a[3] = v & 0xFF; }
    else    { a[0] = v & 0xFF; a[1] = (v >>> 8) & 0xFF; a[2] = (v >>> 16) & 0xFF; a[3] = (v >>> 24) & 0xFF; }
    return a;
  }

  // tag is 8 hex chars, "7fe00010". data is already even-length.
  function element(tag, vr, data, { implicit = false, be = false } = {}) {
    const g = parseInt(tag.slice(0, 4), 16), e = parseInt(tag.slice(4), 16);
    const head = [u16(g, be), u16(e, be)];
    if (implicit) return concat([...head, u32(data.length, be), data]);
    const vrb = new Uint8Array([vr.charCodeAt(0), vr.charCodeAt(1)]);
    if (SHORT_VR.has(vr)) return concat([...head, vrb, u16(data.length, be), data]);
    return concat([...head, vrb, new Uint8Array(2), u32(data.length, be), data]);
  }

  // Undefined-length OB holding one item per frame, preceded by an empty basic
  // offset table — how every compressed transfer syntax carries its pixels.
  function encapsulate(frames, be) {
    const parts = [
      new Uint8Array([0xFE, 0xFF, 0x00, 0xE0]), u32(0, be),          // (FFFE,E000) empty BOT
    ];
    for (const f of frames) {
      let b = new Uint8Array(f instanceof ArrayBuffer ? f : f.buffer || f);
      if (b.length % 2) b = concat([b, new Uint8Array(1)]);
      parts.push(new Uint8Array([0xFE, 0xFF, 0x00, 0xE0]), u32(b.length, be), b);
    }
    parts.push(new Uint8Array([0xFE, 0xFF, 0xDD, 0xE0]), u32(0, be)); // (FFFE,E0DD)
    return concat(parts);
  }

  // PackBits (PS3.5 Annex G). Control byte n: 0..127 means the next n+1 bytes are
  // literal, -1..-127 means repeat the next byte 1-n times, -128 is a no-op.
  function packBits(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      let run = 1;
      while (i + run < src.length && src[i + run] === src[i] && run < 128) run++;
      if (run >= 2) {
        out.push(257 - run, src[i]);
        i += run;
      } else {
        const start = i;
        while (i < src.length && i - start < 128) {
          if (i > start && i + 1 < src.length && src[i + 1] === src[i]) break;
          i++;
        }
        out.push(i - start - 1);
        for (let k = start; k < i; k++) out.push(src[k]);
      }
    }
    if (out.length % 2) out.push(0);          // segments are padded to even length
    return new Uint8Array(out);
  }

  // One RLE frame: a 64-byte header of segment count and offsets, then the
  // PackBits segments themselves.
  function rleFrame(segments) {
    const packed = segments.map(packBits);
    const header = new Uint32Array(16);
    header[0] = packed.length;
    let off = 64;
    packed.forEach((p, i) => { header[i + 1] = off; off += p.length; });
    const out = new Uint8Array(off);
    out.set(new Uint8Array(header.buffer), 0);
    let o = 64;
    for (const p of packed) { out.set(p, o); o += p.length; }
    return out.buffer;
  }

  // A minimal JPEG Lossless (SOF3) encoder: predictor 1, a single interleaved
  // scan, one flat Huffman table of seventeen five-bit codes. Not competitive
  // compression — the point is a stream that genuinely is 1.2.840.10008.1.2.4.70
  // so the branch that handles it can be tested at all.
  function jpegLossless(samples, w, h, comps, precision) {
    const bytes = [];
    let acc = 0, nbits = 0;
    const putByte = (b) => { bytes.push(b); if (b === 0xFF) bytes.push(0x00); };  // byte stuffing
    const putBits = (code, len) => {
      for (let i = len - 1; i >= 0; i--) {
        acc = ((acc << 1) | ((code >> i) & 1)) & 0xFF;
        if (++nbits === 8) { putByte(acc); acc = 0; nbits = 0; }
      }
    };
    const flush = () => { while (nbits) putBits(1, 1); };

    // Category: how many bits the difference needs. Zero needs none.
    const ssss = (d) => { let a = Math.abs(d), n = 0; while (a) { n++; a >>= 1; } return n; };

    const prev = new Int32Array(w * comps);   // the row above, per component
    const cur  = new Int32Array(w * comps);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < comps; c++) {
          const v = samples[(y * w + x) * comps + c];
          // Predictor 1 is the sample to the left; the first sample of a line
          // takes the one above, and the very first takes half of full scale.
          const pred = x > 0 ? cur[(x - 1) * comps + c]
                     : y > 0 ? prev[c]
                     : 1 << (precision - 1);
          const d = v - pred;
          const n = ssss(d);
          putBits(n, 5);                                   // symbol n, code n
          if (n) putBits(d > 0 ? d : d + (1 << n) - 1, n);
          cur[x * comps + c] = v;
        }
      }
      prev.set(cur);
    }
    flush();

    const out = [];
    const u16be = (v) => out.push((v >> 8) & 0xFF, v & 0xFF);
    out.push(0xFF, 0xD8);                                  // SOI

    out.push(0xFF, 0xC3);                                  // SOF3 — lossless, Huffman
    u16be(8 + 3 * comps);
    out.push(precision);
    u16be(h); u16be(w);
    out.push(comps);
    for (let c = 1; c <= comps; c++) out.push(c, 0x11, 0);  // id, 1x1 sampling, no quant table

    out.push(0xFF, 0xC4);                                  // DHT — seventeen codes, all length 5
    u16be(2 + 1 + 16 + 17);
    out.push(0x00);                                        // DC table 0
    for (let i = 1; i <= 16; i++) out.push(i === 5 ? 17 : 0);
    for (let v = 0; v <= 16; v++) out.push(v);

    out.push(0xFF, 0xDA);                                  // SOS
    u16be(6 + 2 * comps);
    out.push(comps);
    for (let c = 1; c <= comps; c++) out.push(c, 0x00);
    out.push(1, 0, 0);                                     // predictor 1, Se 0, no point transform

    // Spreading the entropy-coded bytes into push() would exceed the argument
    // limit on any real-sized image, so assemble the pieces instead.
    const file = new Uint8Array(out.length + bytes.length + 2);
    file.set(out, 0);
    file.set(bytes, out.length);
    file.set([0xFF, 0xD9], out.length + bytes.length);      // EOI
    return file.buffer;
  }

  let uidSeq = 0;
  const uid = (root) => `1.2.826.0.1.3680043.10.99999.${root}.${++uidSeq}`;

  const IMPLICIT_LE = '1.2.840.10008.1.2';
  const EXPLICIT_LE = '1.2.840.10008.1.2.1';
  const EXPLICIT_BE = '1.2.840.10008.1.2.2';

  /**
   * Build a complete DICOM file.
   *
   * cfg: { ts, rows, cols, pi, spp, ba, bs, hb, pr, planar, frames,
   *        wc, ww, slope, intercept, modality, pixels | encapsulated, extra }
   * `pixels` is a typed array holding every frame back to back.
   * `encapsulated` is an array of one compressed buffer per frame.
   * `extra` is { tag: {vr, v} } merged over the defaults.
   */
  function build(cfg) {
    const ts = cfg.ts || EXPLICIT_LE;
    const implicit = ts === IMPLICIT_LE;
    const be = ts === EXPLICIT_BE;
    const frames = cfg.frames || 1;
    const sopClass = cfg.sopClass || '1.2.840.10008.5.1.4.1.1.7';  // Secondary Capture
    const sopInst = cfg.sopInstance || uid('3');

    const ds = {
      '00080008': { vr: 'CS', v: ['DERIVED', 'SECONDARY'] },
      '00080016': { vr: 'UI', v: [sopClass] },
      '00080018': { vr: 'UI', v: [sopInst] },
      '00080020': { vr: 'DA', v: ['20260101'] },
      '00080030': { vr: 'TM', v: ['120000'] },
      '00080060': { vr: 'CS', v: [cfg.modality || 'OT'] },
      '00081030': { vr: 'LO', v: [cfg.title || 'Forge test'] },
      '00100010': { vr: 'PN', v: ['Forge^Test'] },
      '00100020': { vr: 'LO', v: ['FORGE-001'] },
      '0020000d': { vr: 'UI', v: [cfg.studyUID || uid('1')] },
      '0020000e': { vr: 'UI', v: [cfg.seriesUID || uid('2')] },
      '00200013': { vr: 'IS', v: [String(cfg.instance || 1)] },
      '00280002': { vr: 'US', v: [cfg.spp || 1] },
      '00280004': { vr: 'CS', v: [cfg.pi] },
      '00280010': { vr: 'US', v: [cfg.rows] },
      '00280011': { vr: 'US', v: [cfg.cols] },
      '00280100': { vr: 'US', v: [cfg.ba] },
      '00280101': { vr: 'US', v: [cfg.bs != null ? cfg.bs : cfg.ba] },
      '00280102': { vr: 'US', v: [cfg.hb != null ? cfg.hb : (cfg.bs != null ? cfg.bs : cfg.ba) - 1] },
      '00280103': { vr: 'US', v: [cfg.pr || 0] },
    };
    if ((cfg.spp || 1) > 1) ds['00280006'] = { vr: 'US', v: [cfg.planar || 0] };
    if (frames > 1)         ds['00280008'] = { vr: 'IS', v: [String(frames)] };
    if (cfg.wc != null)     ds['00281050'] = { vr: 'DS', v: [String(cfg.wc)] };
    if (cfg.ww != null)     ds['00281051'] = { vr: 'DS', v: [String(cfg.ww)] };
    if (cfg.intercept != null) ds['00281052'] = { vr: 'DS', v: [String(cfg.intercept)] };
    if (cfg.slope != null)     ds['00281053'] = { vr: 'DS', v: [String(cfg.slope)] };
    Object.assign(ds, cfg.extra || {});

    const body = [];
    for (const tag of Object.keys(ds).sort()) {
      const { vr, v } = ds[tag];
      body.push(element(tag, vr, bytesOfValue(vr, v, be), { implicit, be }));
    }

    // Pixel data last: OW for 16-bit raw, OB for 8-bit and for anything
    // encapsulated. Implicit VR carries no VR at all, so the app has to infer.
    if (cfg.encapsulated) {
      const g = parseInt('7fe0', 16), e = parseInt('0010', 16);
      const items = encapsulate(cfg.encapsulated, be);
      const head = implicit
        ? concat([u16(g, be), u16(e, be), u32(0xFFFFFFFF, be)])
        : concat([u16(g, be), u16(e, be), new Uint8Array([0x4F, 0x42]), new Uint8Array(2), u32(0xFFFFFFFF, be)]);
      body.push(concat([head, items]));
    } else {
      let px = cfg.pixels;
      let raw = new Uint8Array(px.buffer ? px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength) : px);
      if (be && cfg.ba === 16) {                       // big endian stores the high byte first
        const sw = new Uint8Array(raw.length);
        for (let i = 0; i + 1 < raw.length; i += 2) { sw[i] = raw[i + 1]; sw[i + 1] = raw[i]; }
        raw = sw;
      }
      if (raw.length % 2) raw = concat([raw, new Uint8Array(1)]);
      body.push(element('7fe00010', cfg.ba === 16 ? 'OW' : 'OB', raw, { implicit, be }));
    }

    // File meta is always Explicit VR Little Endian, whatever the dataset uses.
    const metaEls = {
      '00020001': { vr: 'OB', v: new Uint8Array([0, 1]) },
      '00020002': { vr: 'UI', v: [sopClass] },
      '00020003': { vr: 'UI', v: [sopInst] },
      '00020010': { vr: 'UI', v: [ts] },
      '00020012': { vr: 'UI', v: ['1.2.826.0.1.3680043.10.743'] },
      '00020013': { vr: 'SH', v: ['CARINO-FORGE'] },
    };
    const metaBody = concat(Object.keys(metaEls).sort().map(
      t => element(t, metaEls[t].vr, bytesOfValue(metaEls[t].vr, metaEls[t].v))));

    const preamble = new Uint8Array(132);
    preamble.set([0x44, 0x49, 0x43, 0x4D], 128);       // "DICM"

    return concat([
      preamble,
      element('00020000', 'UL', bytesOfValue('UL', [metaBody.length])),
      metaBody,
      concat(body),
    ]);
  }

  // ------------------------------------------------------------ the samples --

  const W = 32, H = 32;

  // One pattern used everywhere, in 0..1: a left-to-right ramp with a bright
  // block top-left and a dark block bottom-right. The ramp catches windowing
  // errors, the blocks catch flips, transposes and inversions.
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

  // A colour pattern in 0..255 — red ramps across, green down, blue is a
  // corner flag. Any channel swap or planar mix-up is obvious at a glance.
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

  // ----------------------------------------------------------- the reference --

  // DICOM's own windowing formula (PS3.3 C.11.2.1.2), on values already in
  // output units. Identical maths to the app's, deliberately — the disagreements
  // we are hunting are about *what* gets windowed, not how.
  function windowFloats(vals, wc, ww, mn, mx) {
    let lo, hi;
    if (wc != null && ww != null) { lo = wc - 0.5 - (ww - 1) / 2; hi = wc - 0.5 + (ww - 1) / 2; }
    else { lo = mn; hi = mx; }
    const range = (hi - lo) || 1;
    const out = new Uint8ClampedArray(vals.length);
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      out[i] = v <= lo ? 0 : v >= hi ? 255 : Math.round(((v - lo) / range) * 255);
    }
    return out;
  }

  /**
   * What the case should look like, from the samples the case was built from.
   *
   * ref: { kind:'mono', samples (stored values), pi, wc, ww, slope, intercept }
   *   or { kind:'rgb', rgb }  — already display-ready RGB triplets
   * Returns Uint8ClampedArray RGBA.
   */
  function expected(ref, w, h) {
    const n = w * h;
    const out = new Uint8ClampedArray(n * 4);
    if (ref.kind === 'rgb') {
      for (let i = 0; i < n; i++) {
        out[i * 4] = ref.rgb[i * 3]; out[i * 4 + 1] = ref.rgb[i * 3 + 1];
        out[i * 4 + 2] = ref.rgb[i * 3 + 2]; out[i * 4 + 3] = 255;
      }
      return out;
    }
    // Stored value -> output units, before anything else touches it.
    const m = ref.slope != null ? ref.slope : 1, b = ref.intercept != null ? ref.intercept : 0;
    const vals = new Float32Array(n);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = ref.samples[i] * m + b;
      vals[i] = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const g = windowFloats(vals, ref.wc, ref.ww, mn, mx);
    // MONOCHROME1 means the smallest value is white (PS3.3 C.7.6.3.1.2).
    const inv = /^MONOCHROME1$/i.test(ref.pi || '');
    for (let i = 0; i < n; i++) {
      const v = inv ? 255 - g[i] : g[i];
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    return out;
  }

  // --------------------------------------------------------------- the cases --

  // JPEG has to come from the browser, so the corpus is built asynchronously.
  async function jpegOf(gray /* Uint8Array w*h, 0..255 */, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = gray[i];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 1));
    return blob.arrayBuffer();
  }

  async function jpegOfRgb(rgb /* Uint8Array w*h*3 */, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      img.data[i * 4] = rgb[i * 3]; img.data[i * 4 + 1] = rgb[i * 3 + 1];
      img.data[i * 4 + 2] = rgb[i * 3 + 2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 1));
    return blob.arrayBuffer();
  }

  async function corpus() {
    const cases = [];
    const add = (c) => { cases.push(c); return c; };

    const p = pattern(W, H);              // 0..1
    const n = W * H;

    // ---- 8-bit unsigned MONOCHROME2, windowed by the tags -------------------
    {
      const s = new Uint8Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 255);
      add({
        id: 'mono2-u8',
        title: '8-bit MONOCHROME2, WC/WW from the tags',
        note: 'The simplest possible case. If this one is wrong nothing else matters.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 8, bs: 8, hb: 7, pr: 0,
                       wc: 128, ww: 256, pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 128, ww: 256 },
      });
    }

    // ---- 16-bit unsigned, 12 bits stored — the ordinary CR/DX layout --------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      add({
        id: 'mono2-u16-b12',
        title: '16-bit MONOCHROME2, 12 bits stored',
        note: 'High bit 11, so the top four bits are padding and must be masked off.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 12, hb: 11, pr: 0,
                       wc: 2048, ww: 4096, pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 2048, ww: 4096 },
      });
    }

    // ---- 16-bit unsigned, all 16 bits stored --------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 65535);
      add({
        id: 'mono2-u16-b16',
        title: '16-bit MONOCHROME2, 16 bits stored',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 16, hb: 15, pr: 0,
                       wc: 32768, ww: 65536, pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 32768, ww: 65536 },
      });
    }

    // ---- signed, 12 bits stored --------------------------------------------
    {
      const s = new Int16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095) - 2048;   // -2048..2047
      add({
        id: 'mono2-s16-b12',
        title: '16-bit signed MONOCHROME2, 12 bits stored',
        note: 'Negative stored values, sign bit at bit 11.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 12, hb: 11, pr: 1,
                       wc: 0, ww: 4096, pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 0, ww: 4096 },
      });
    }

    // ---- signed, all 16 bits stored — what most CT actually ships -----------
    {
      const s = new Int16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4000) - 2000;   // -2000..2000
      add({
        id: 'mono2-s16-b16',
        title: '16-bit signed MONOCHROME2, 16 bits stored',
        note: 'Bits stored 16, high bit 15, pixel representation 1 — negatives everywhere.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 16, hb: 15, pr: 1,
                       wc: 0, ww: 4000, modality: 'CT', pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 0, ww: 4000 },
      });
    }

    // ---- MONOCHROME1 — low value is white ----------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      add({
        id: 'mono1-u16',
        title: 'MONOCHROME1 (inverted greyscale)',
        note: 'Standard for a lot of CR, DX and mammo. Zero must come out white, not black.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME1', ba: 16, bs: 12, hb: 11, pr: 0,
                       wc: 2048, ww: 4096, modality: 'CR', pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME1', wc: 2048, ww: 4096 },
      });
    }

    // ---- rescale to Hounsfield, window given in Hounsfield -----------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 2000);    // 0..2000 stored
      add({
        id: 'ct-rescale-hu',
        title: 'CT with Rescale Slope/Intercept, soft-tissue window',
        note: 'Stored 0..2000, intercept -1024, so output is -1024..976 HU and the ' +
              'WC 40 / WW 400 window only makes sense after the rescale is applied.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 16, hb: 15, pr: 0,
                       wc: 40, ww: 400, slope: 1, intercept: -1024, modality: 'CT', pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 40, ww: 400,
               slope: 1, intercept: -1024 },
      });
    }

    // ---- rescale with a slope other than 1 ---------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 1000);
      add({
        id: 'pt-rescale-slope',
        title: 'Rescale Slope 2.5 (PET-style scaling)',
        note: 'Slope is not 1, so stored values and output units are on different scales.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 16, hb: 15, pr: 0,
                       wc: 1250, ww: 2500, slope: 2.5, intercept: 0, modality: 'PT', pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 1250, ww: 2500,
               slope: 2.5, intercept: 0 },
      });
    }

    // ---- no window tags at all — fall back to the data's own range ---------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = 1000 + Math.round(p[i] * 3000);
      add({
        id: 'mono2-no-window',
        title: 'No Window Center/Width',
        note: 'Nothing to window by, so the full min..max range maps onto 0..255.',
        // The auto-window can land a hair either side of the exact min..max
        // sweep depending on where it rounds; one grey level of slack.
        w: W, h: H, tol: 2,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 16, hb: 15, pr: 0,
                       pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2' },
      });
    }

    // ---- RGB, interleaved (planar configuration 0) -------------------------
    {
      const rgb = colorPattern(W, H);
      add({
        id: 'rgb-planar0',
        title: 'RGB, colour-by-pixel (Planar Configuration 0)',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'RGB', spp: 3, ba: 8, bs: 8, hb: 7, pr: 0,
                       planar: 0, modality: 'XC', pixels: rgb }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- RGB, planar (planar configuration 1) ------------------------------
    {
      const rgb = colorPattern(W, H);
      const planar = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        planar[i] = rgb[i * 3];
        planar[n + i] = rgb[i * 3 + 1];
        planar[2 * n + i] = rgb[i * 3 + 2];
      }
      add({
        id: 'rgb-planar1',
        title: 'RGB, colour-by-plane (Planar Configuration 1)',
        note: 'All the red, then all the green, then all the blue. Read as interleaved ' +
              'it turns into three coloured bands.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'RGB', spp: 3, ba: 8, bs: 8, hb: 7, pr: 0,
                       planar: 1, modality: 'XC', pixels: planar }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- YBR_FULL — needs a colour-space conversion ------------------------
    {
      const rgb = colorPattern(W, H);
      const ybr = new Uint8Array(n * 3);
      // Cr for pure red comes out at 255.5, and Cb for pure blue likewise, so
      // clamp the way a real encoder does — letting it wrap would produce a
      // file no decoder could get right.
      const c8 = (v) => { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; };
      for (let i = 0; i < n; i++) {
        const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
        ybr[i * 3]     = c8( 0.299 * r + 0.587 * g + 0.114 * b);
        ybr[i * 3 + 1] = c8(-0.1687 * r - 0.3313 * g + 0.5 * b + 128);
        ybr[i * 3 + 2] = c8( 0.5 * r - 0.4187 * g - 0.0813 * b + 128);
      }
      add({
        id: 'ybr-full',
        title: 'YBR_FULL',
        note: 'Luminance and two chrominance channels. Copied straight into R, G and B ' +
              'it comes out green and washed out.',
        w: W, h: H,
        tol: 3,                       // the YCbCr round trip is not bit-exact
        bytes: build({ rows: H, cols: W, pi: 'YBR_FULL', spp: 3, ba: 8, bs: 8, hb: 7, pr: 0,
                       planar: 0, modality: 'US', pixels: ybr }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- PALETTE COLOR -----------------------------------------------------
    {
      const s = new Uint8Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 255);
      const lut = (fn) => {
        const a = new Uint16Array(256);
        for (let i = 0; i < 256; i++) a[i] = fn(i) << 8;   // 16-bit LUT entries
        return new Uint8Array(a.buffer);
      };
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = s[i]; rgb[i * 3 + 1] = 255 - s[i]; rgb[i * 3 + 2] = 128;
      }
      add({
        id: 'palette-color',
        title: 'PALETTE COLOR with an RGB lookup table',
        note: 'Single sample per pixel indexing three LUTs. Common in nuclear medicine ' +
              'and in ultrasound colour overlays.',
        w: W, h: H,
        bytes: build({
          rows: H, cols: W, pi: 'PALETTE COLOR', spp: 1, ba: 8, bs: 8, hb: 7, pr: 0,
          modality: 'NM', pixels: s,
          extra: {
            '00281101': { vr: 'US', v: [256, 0, 16] },
            '00281102': { vr: 'US', v: [256, 0, 16] },
            '00281103': { vr: 'US', v: [256, 0, 16] },
            '00281201': { vr: 'OW', v: lut(i => i) },
            '00281202': { vr: 'OW', v: lut(i => 255 - i) },
            '00281203': { vr: 'OW', v: lut(() => 128) },
          },
        }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- multi-frame greyscale ---------------------------------------------
    {
      const F = 4;
      const s = new Uint16Array(n * F);
      for (let f = 0; f < F; f++) {
        for (let i = 0; i < n; i++) s[f * n + i] = Math.round(p[i] * 1000) + f * 700;
      }
      const frame = (f) => s.subarray(f * n, (f + 1) * n);
      add({
        id: 'multiframe-mono',
        title: 'Four-frame MONOCHROME2 in one buffer',
        note: 'Every frame is the same ramp, shifted brighter. Frame 3 must not look like frame 0.',
        w: W, h: H, frames: 4,
        frameRef: (f) => ({ kind: 'mono', samples: frame(f), pi: 'MONOCHROME2', wc: 1500, ww: 3000 }),
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 16, hb: 15, pr: 0,
                       frames: F, wc: 1500, ww: 3000, modality: 'XA', pixels: s }),
        ref: { kind: 'mono', samples: frame(0), pi: 'MONOCHROME2', wc: 1500, ww: 3000 },
      });
    }

    // ---- multi-frame colour -------------------------------------------------
    {
      const F = 3;
      const base = colorPattern(W, H);
      const s = new Uint8Array(n * 3 * F);
      const frames = [];
      for (let f = 0; f < F; f++) {
        const fr = new Uint8Array(n * 3);
        for (let i = 0; i < n * 3; i++) fr[i] = (i % 3 === f) ? base[i] : 0;   // isolate one channel
        frames.push(fr);
        s.set(fr, f * n * 3);
      }
      add({
        id: 'multiframe-rgb',
        title: 'Three-frame RGB cine',
        note: 'Frame 0 is red only, frame 1 green only, frame 2 blue only.',
        w: W, h: H, frames: F,
        frameRef: (f) => ({ kind: 'rgb', rgb: frames[f] }),
        bytes: build({ rows: H, cols: W, pi: 'RGB', spp: 3, ba: 8, bs: 8, hb: 7, pr: 0,
                       planar: 0, frames: F, modality: 'US', pixels: s }),
        ref: { kind: 'rgb', rgb: frames[0] },
      });
    }

    // ---- implicit VR little endian -----------------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      add({
        id: 'implicit-vr',
        title: 'Implicit VR Little Endian',
        note: 'No VR in the stream, so Pixel Data\'s type has to come from the dictionary.',
        w: W, h: H,
        bytes: build({ ts: IMPLICIT_LE, rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 16, bs: 12, hb: 11, pr: 0, wc: 2048, ww: 4096, pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 2048, ww: 4096 },
      });
    }

    // ---- explicit VR big endian --------------------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      add({
        id: 'big-endian',
        title: 'Explicit VR Big Endian (retired, still in the wild)',
        note: 'Bytes within each 16-bit sample are the other way round.',
        w: W, h: H,
        bytes: build({ ts: EXPLICIT_BE, rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 16, bs: 12, hb: 11, pr: 0, wc: 2048, ww: 4096, pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 2048, ww: 4096 },
      });
    }

    // ---- raw pixels that happen to begin FF D8 -----------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      s[0] = 0xD8FF;                 // little endian: bytes FF D8, i.e. a JPEG SOI
      add({
        id: 'raw-looks-like-jpeg',
        title: 'Uncompressed pixels whose first bytes are FF D8',
        note: 'Stored value 55551 in the first pixel. A magic-byte sniff would call ' +
              'this a JPEG and hand back garbage; the transfer syntax says otherwise.',
        w: W, h: H,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 16, hb: 15, pr: 0,
                       wc: 32768, ww: 65536, pixels: s }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 32768, ww: 65536 },
      });
    }

    // ---- encapsulated baseline JPEG ----------------------------------------
    {
      const gray = new Uint8Array(n);
      // Flat 4x4 blocks so the DCT has almost nothing to lose.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) gray[y * W + x] = ((x >> 2) * 32) & 0xFF;
      }
      const jpg = await jpegOf(gray, W, H);
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = gray[i]; }
      add({
        id: 'jpeg-baseline',
        title: 'Encapsulated JPEG Baseline',
        note: 'Decoded by the browser, so this one is lossy — compared with a tolerance.',
        w: W, h: H, tol: 12,
        bytes: build({ ts: '1.2.840.10008.1.2.4.50', rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 8, bs: 8, hb: 7, pr: 0, encapsulated: [jpg] }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- encapsulated multi-frame JPEG -------------------------------------
    {
      const F = 3;
      const grays = [], jpgs = [];
      for (let f = 0; f < F; f++) {
        const g = new Uint8Array(n);
        for (let i = 0; i < n; i++) g[i] = (f * 80 + 20) & 0xFF;   // three flat levels
        grays.push(g);
        jpgs.push(await jpegOf(g, W, H));
      }
      const asRgb = (g) => {
        const rgb = new Uint8Array(n * 3);
        for (let i = 0; i < n; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = g[i];
        return rgb;
      };
      add({
        id: 'jpeg-multiframe',
        title: 'Three-frame encapsulated JPEG',
        note: 'One fragment per frame. Asking for frame 2 must not return frame 0.',
        w: W, h: H, frames: F, tol: 12,
        frameRef: (f) => ({ kind: 'rgb', rgb: asRgb(grays[f]) }),
        bytes: build({ ts: '1.2.840.10008.1.2.4.50', rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 8, bs: 8, hb: 7, pr: 0, frames: F, encapsulated: jpgs }),
        ref: { kind: 'rgb', rgb: asRgb(grays[0]) },
      });
    }

    // ---- JPEG Lossless, colour ---------------------------------------------
    // What a UIH CT workstation writes its secondary captures as: three
    // components, 8-bit, transfer syntax 1.2.840.10008.1.2.4.70.
    {
      const rgb = colorPattern(W, H);
      add({
        id: 'jpeg-lossless-rgb',
        title: 'JPEG Lossless, 8-bit RGB',
        note: 'Three components in one interleaved scan. Windowed as greyscale it reads ' +
              'one sample per pixel out of a three-sample stream, so every row advances a ' +
              'third as fast as it should and the picture stretches and tears.',
        w: W, h: H,
        bytes: build({ ts: '1.2.840.10008.1.2.4.70', rows: H, cols: W, pi: 'RGB', spp: 3,
                       ba: 8, bs: 8, hb: 7, pr: 0, planar: 0, modality: 'CT',
                       encapsulated: [jpegLossless(rgb, W, H, 3, 8)] }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- JPEG Lossless, 16-bit greyscale -----------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      add({
        id: 'jpeg-lossless-mono16',
        title: 'JPEG Lossless, 12 bits in 16',
        note: 'The single-component case, which has to keep working.',
        w: W, h: H,
        bytes: build({ ts: '1.2.840.10008.1.2.4.70', rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 16, bs: 12, hb: 11, pr: 0, wc: 2048, ww: 4096, modality: 'CR',
                       encapsulated: [jpegLossless(s, W, H, 1, 12)] }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 2048, ww: 4096 },
      });
    }

    // ---- RLE Lossless, colour ----------------------------------------------
    // Secondary captures off CT and ultrasound workstations very often arrive
    // this way. Segments are one byte-plane each, ordered by sample then by
    // byte, most significant first (PS3.5 G.2).
    {
      const rgb = colorPattern(W, H);
      const planes = [0, 1, 2].map(c => {
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = rgb[i * 3 + c];
        return p;
      });
      add({
        id: 'rle-rgb',
        title: 'RLE Lossless, 8-bit RGB',
        note: 'Read as though it were uncompressed, RLE does not look like noise — it ' +
              'looks like the picture, torn diagonally, because run-length coding keeps ' +
              'bytes near their neighbours.',
        w: W, h: H,
        bytes: build({ ts: '1.2.840.10008.1.2.5', rows: H, cols: W, pi: 'RGB', spp: 3,
                       ba: 8, bs: 8, hb: 7, pr: 0, planar: 0, modality: 'XC',
                       encapsulated: [rleFrame(planes)] }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- RLE Lossless, 16-bit greyscale ------------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      const hi = new Uint8Array(n), lo = new Uint8Array(n);
      for (let i = 0; i < n; i++) { hi[i] = s[i] >> 8; lo[i] = s[i] & 0xFF; }
      add({
        id: 'rle-mono16',
        title: 'RLE Lossless, 16-bit MONOCHROME2',
        note: 'Two segments, high byte plane first. Getting the order wrong scales every ' +
              'value by 256 rather than producing anything obviously broken.',
        w: W, h: H,
        bytes: build({ ts: '1.2.840.10008.1.2.5', rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 16, bs: 12, hb: 11, pr: 0, wc: 2048, ww: 4096, modality: 'CT',
                       encapsulated: [rleFrame([hi, lo])] }),
        ref: { kind: 'mono', samples: s, pi: 'MONOCHROME2', wc: 2048, ww: 4096 },
      });
    }

    // ---- RLE Lossless, multi-frame -----------------------------------------
    {
      const F = 3;
      const base = colorPattern(W, H);
      const frames = [], fragments = [];
      for (let f = 0; f < F; f++) {
        const fr = new Uint8Array(n * 3);
        for (let i = 0; i < n * 3; i++) fr[i] = (i % 3 === f) ? base[i] : 0;
        frames.push(fr);
        fragments.push(rleFrame([0, 1, 2].map(c => {
          const pl = new Uint8Array(n);
          for (let i = 0; i < n; i++) pl[i] = fr[i * 3 + c];
          return pl;
        })));
      }
      add({
        id: 'rle-multiframe',
        title: 'Three-frame RLE Lossless cine',
        note: 'One fragment per frame, as ultrasound loops arrive.',
        w: W, h: H, frames: F,
        frameRef: (f) => ({ kind: 'rgb', rgb: frames[f] }),
        bytes: build({ ts: '1.2.840.10008.1.2.5', rows: H, cols: W, pi: 'RGB', spp: 3,
                       ba: 8, bs: 8, hb: 7, pr: 0, planar: 0, frames: F, modality: 'US',
                       encapsulated: fragments }),
        ref: { kind: 'rgb', rgb: frames[0] },
      });
    }

    // ---- MONOCHROME1 inside a JPEG -----------------------------------------
    {
      const gray = new Uint8Array(n);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) gray[y * W + x] = ((x >> 2) * 32) & 0xFF;
      }
      const jpg = await jpegOf(gray, W, H);
      // The browser hands the fragment back as it was encoded; the inversion
      // MONOCHROME1 asks for is still the viewer's job.
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = 255 - gray[i];
      }
      add({
        id: 'mono1-jpeg',
        title: 'MONOCHROME1 carried by a baseline JPEG',
        note: 'Compression does not change the photometric interpretation — this still ' +
              'has to come out the other way round.',
        w: W, h: H, tol: 12,
        bytes: build({ ts: '1.2.840.10008.1.2.4.50', rows: H, cols: W, pi: 'MONOCHROME1',
                       ba: 8, bs: 8, hb: 7, pr: 0, modality: 'CR', encapsulated: [jpg] }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- YBR_FULL_422 inside a JPEG — the ordinary ultrasound cine ---------
    {
      // Flat colour: JPEG's chroma subsampling has nothing to blur, so any
      // difference left is a channel swap rather than a compression artefact.
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i * 3] = 230; rgb[i * 3 + 1] = 120; rgb[i * 3 + 2] = 40; }
      const jpg = await jpegOfRgb(rgb, W, H);
      add({
        id: 'ybr-422-jpeg',
        title: 'YBR_FULL_422 in a baseline JPEG',
        note: 'What almost every ultrasound cine actually is. The JPEG decoder returns ' +
              'RGB, so the photometric name must not be a reason to refuse the file.',
        w: W, h: H, tol: 6,
        bytes: build({ ts: '1.2.840.10008.1.2.4.50', rows: H, cols: W, pi: 'YBR_FULL_422',
                       spp: 3, ba: 8, bs: 8, hb: 7, pr: 0, planar: 0, modality: 'US',
                       encapsulated: [jpg] }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- YBR_FULL_422 raw, which we genuinely cannot do --------------------
    {
      // Subsampled chroma: two luma samples share one Cb/Cr pair, so the buffer
      // is two thirds the interleaved size.
      const s = new Uint8Array(n * 2);
      for (let i = 0; i < s.length; i++) s[i] = i & 0xFF;
      add({
        id: 'ybr-422-raw',
        title: 'YBR_FULL_422 uncompressed',
        note: 'Needs chroma upsampling we do not do. Refusing it with a reason beats ' +
              'drawing two thirds of an image.',
        w: W, h: H, broken: true, expectError: /YBR_FULL_422/i,
        bytes: build({ rows: H, cols: W, pi: 'YBR_FULL_422', spp: 3, ba: 8, bs: 8, hb: 7,
                       pr: 0, planar: 0, modality: 'US', pixels: s }),
        ref: null,
      });
    }

    // ---- one JPEG frame split across several fragments ---------------------
    {
      const gray = new Uint8Array(n);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) gray[y * W + x] = ((x >> 2) * 32) & 0xFF;
      }
      const jpg = await jpegOf(gray, W, H);
      // Split on even boundaries, as the standard requires of fragments. Only the
      // first piece carries the SOI marker.
      const whole = new Uint8Array(jpg);
      const cut1 = Math.floor(whole.length / 3) & ~1;
      const cut2 = Math.floor(whole.length * 2 / 3) & ~1;
      const parts = [whole.slice(0, cut1), whole.slice(cut1, cut2), whole.slice(cut2)]
        .map(u => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = gray[i]; }
      add({
        id: 'jpeg-split-fragments',
        title: 'One JPEG frame split across three fragments',
        note: 'Large single-frame images are often fragmented. Decoding only the piece ' +
              'with the SOI marker gives a third of a picture.',
        w: W, h: H, tol: 12,
        bytes: build({ ts: '1.2.840.10008.1.2.4.50', rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 8, bs: 8, hb: 7, pr: 0, encapsulated: parts }),
        ref: { kind: 'rgb', rgb },
      });
    }

    // ---- an encapsulated syntax we have no decoder for ---------------------
    {
      // MPEG-2 video in Pixel Data. The bytes are not JPEG, not J2K and not RLE,
      // so nothing recognises them — which is exactly when a viewer is tempted to
      // draw them as pixels.
      const mpeg = new Uint8Array(4096);
      mpeg.set([0x00, 0x00, 0x01, 0xB3], 0);          // MPEG sequence header
      for (let i = 4; i < mpeg.length; i++) mpeg[i] = (i * 37) & 0xFF;
      add({
        id: 'mpeg2-unsupported',
        title: 'MPEG-2 video in Pixel Data',
        note: 'There is no picture to get right here. The only correct behaviour is to ' +
              'say so rather than render the bitstream.',
        w: W, h: H, broken: true, expectError: /compressed transfer syntax/i,
        bytes: build({ ts: '1.2.840.10008.1.2.4.100', rows: H, cols: W, pi: 'YBR_PARTIAL_420',
                       spp: 3, ba: 8, bs: 8, hb: 7, pr: 0, planar: 0, modality: 'US',
                       encapsulated: [mpeg.buffer] }),
        ref: null,
      });
    }

    // ---- pixel data shorter than Rows x Columns ----------------------------
    {
      const s = new Uint16Array(Math.floor(n / 2));
      for (let i = 0; i < s.length; i++) s[i] = Math.round((i / s.length) * 4095);
      add({
        id: 'truncated-pixels',
        title: 'Truncated Pixel Data',
        note: 'Half the pixels the header promises. Should degrade, not throw.',
        w: W, h: H, broken: true,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 12, hb: 11, pr: 0,
                       wc: 2048, ww: 4096, pixels: s }),
        ref: null,
      });
    }

    // ---- window width zero --------------------------------------------------
    {
      const s = new Uint16Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.round(p[i] * 4095);
      add({
        id: 'window-width-zero',
        title: 'Window Width 0',
        note: 'Illegal but it happens. Must not divide by zero or blank the image.',
        w: W, h: H, broken: true,
        bytes: build({ rows: H, cols: W, pi: 'MONOCHROME2', ba: 16, bs: 12, hb: 11, pr: 0,
                       wc: 2048, ww: 0, pixels: s }),
        ref: null,
      });
    }

    // ---- JPEG 2000, which nothing in the browser can decode ------------------
    {
      // A J2K codestream signature and nothing behind it — enough to be recognised.
      const j2k = new Uint8Array(64);
      j2k.set([0xFF, 0x4F, 0xFF, 0x51], 0);
      add({
        id: 'jpeg2000-unsupported',
        title: 'JPEG 2000 (not decodable in a browser)',
        note: 'The right behaviour is a clear message, not a blank canvas or a crash.',
        w: W, h: H, broken: true, expectError: /2000/i,
        bytes: build({ ts: '1.2.840.10008.1.2.4.90', rows: H, cols: W, pi: 'MONOCHROME2',
                       ba: 16, bs: 12, hb: 11, pr: 0, encapsulated: [j2k.buffer] }),
        ref: null,
      });
    }

    return cases;
  }

  // -------------------------------------------------------------- comparing --

  // Returns null when the buffers agree, or a description of the first and worst
  // disagreement. Alpha is ignored — nothing here is transparent.
  function compare(got, want, tol) {
    tol = tol || 0;
    if (!got) return 'no pixels at all';
    if (got.length !== want.length) return `length ${got.length}, expected ${want.length}`;
    let worst = 0, worstAt = -1, firstAt = -1, bad = 0;
    for (let i = 0; i < want.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(got[i + c] - want[i + c]);
        if (d > tol) {
          bad++;
          if (firstAt < 0) firstAt = i / 4;
          if (d > worst) { worst = d; worstAt = i / 4; }
          break;
        }
      }
    }
    if (!bad) return null;
    const at = worstAt * 4;
    return `${bad}/${want.length / 4} px differ, worst ${worst} at px ${worstAt} ` +
           `(got ${got[at]},${got[at + 1]},${got[at + 2]} want ${want[at]},${want[at + 1]},${want[at + 2]}), ` +
           `first at px ${firstAt}`;
  }

  window.Forge = { build, corpus, expected, compare, pattern, colorPattern,
                   windowFloats, encapsulate, element, jpegLossless, rleFrame, W, H };
})();
