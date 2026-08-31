"""Generate the Carino DICOM Editor mark — the app and packaging icons — with
the standard library only (no Pillow), so a build machine needs nothing
installed.

Started life as a port of Carino-PACS/desktop/assets/make_icon.py, and the ring
is still the shared fleet brand: R, W, GAP and GOLD are not this app's to vary.
The lockup around it is. The editor's mark is that C with a mini E standing
beside it — a CE — so this file now deliberately diverges from the PACS copy,
which draws the C alone and must go on doing so. Nothing enforces that: the two
files are a hand port, not a vendored copy, so re-porting the PACS version over
this one would silently delete the E. Sync ring constants only. The tray step is
gone too, because the editor is a document app and has no tray.

The C is a bold ring of 90-degree mouth, cut radially at both terminals, in
Carino gold on transparency; the E is five equal horizontal bands set clear of
the ring's outer radius. Both are drawn from the constants below rather than
traced from a bitmap, so any size can be regenerated exactly. That is the point
here: this repo's only image is a 50x50 logo.webp, which no amount of upscaling
turns into a crisp 1024px ic10 member.

The C is drawn in a 100x100 space, but the lockup is not — the E runs out to
x = 123.2. _fit() normalises the pair back into that 100x100 tile with equal
padding, so bare constants below are pre-fit and M-prefixed ones are post-fit.

Note that ../../logo.webp, the web favicon, is a separate render of this same
mark: it needs ImageMagick, so it is out of scope for the desktop build, which
must not touch index.html or its assets. It also has a byte-identical vendored
twin in the PACS repo — see the note printed at the end of this script.

Run:  python3 make_icon.py
"""
import math
import os
import struct
import zlib

GOLD = (0xEA, 0xB3, 0x08)

# --- the mark ------------------------------------------------------------
# The C is drawn in a 100x100 space, then the whole lockup is fitted to the
# canvas with equal padding.
CX = CY = 50.0      # centre of the ring
R = 34.0            # arc centreline radius
W = 16.0            # stroke width  -> outer 42, inner 26
GAP = 44.0          # half the mouth, in degrees, opening to the right
PAD = 7.0           # clear space around the mark, in the same 100 units

# The mini E, every number derived from the ring so the two cannot drift. An E
# is five horizontal bands — arm, counter, arm, counter, arm — and at 16x16
# whichever band is thinnest is the one that fails first, so all five share one
# module ES rather than taking a typographer's thick and thin. EH then falls out
# as 2R - W, exactly the diameter of the C's own counter, which is what makes
# the E read as belonging to the C rather than merely standing next to it.
#
# The spine sits ON the ring's circumscribing circle. That puts collision beyond
# reach structurally rather than by inspection — no point at x >= CX + R + W/2
# is ring ink at any GAP — and, more to the point, it is the legibility of the
# thing. An E nested in the C's mouth is the prettier idea and derives just as
# cleanly, but it has ring ink about a pixel away on three sides at 16x16, so
# its counters have no clean background to resolve against: measured down a
# column through the arms it renders as a flat grey bar (alpha contrast 0.19)
# where this one reads (0.89).
#
# These are measured numbers, not chosen ones. Fitted, ES is 1.24 device px per
# band with 1.46 px of clear space to the C, against a floor of roughly 1.2.
# Shrinking ES, widening EW or pushing EX0 further right crosses it, and the
# failure is not a gradual softening — it is that grey bar.
ES = (2 * R - W) / 5    # 10.4   the module: stroke and counter alike
EH = 5 * ES             # 52.0   cap height; == the C's counter diameter
EW = 3 * ES             # 31.2   0.6 of cap height, a normal cap-E width
EX0 = CX + R + W / 2    # 92.0   spine stands on the ring's outer radius
EX1 = EX0 + EW          # 123.2  the composition's rightmost ink


def _fit():
    """Optical centring. Returns the affine (scale, tx, ty) rather than any one
    shape's fitted constants: there are two shapes to place now, and deriving
    the transform twice would let them drift apart.

    The C's rightmost ink is the outer corner of a terminal, not the full width
    of the ring, so the raw drawing sits left of centre. Fit the real bounding
    box instead of the circle's — now the union of the C's and the E's, and the
    E always wins on the right. Top and bottom need no union term: the E is
    centred on CY and its EH = 2R - W is less than the ring's 2R + W for any
    positive W, so the ring stays the vertical extreme.

    With the E the composition is width-bound for the first time (w = 115.2
    against h = 84), which means the vertical centring term below is finally
    doing work instead of evaluating to zero.
    """
    ro = R + W / 2
    left, top, bottom = CX - ro, CY - ro, CY + ro
    right = max(CX + ro * math.cos(math.radians(GAP)), EX1)
    w, h = right - left, bottom - top
    s = (100 - 2 * PAD) / max(w, h)
    tx = PAD + (100 - 2 * PAD - w * s) / 2 - left * s
    ty = PAD + (100 - 2 * PAD - h * s) / 2 - top * s
    return s, tx, ty


# One transform, both shapes hung off it. Ink lands on x 7.000..93.000, exactly
# PAD either side; the lockup is 86 wide by 62.7 tall, so the spare tile is
# above and below rather than at the sides.
S, TX, TY = _fit()
MX, MY, MR, MW = CX * S + TX, CY * S + TY, R * S, W * S
MEL, MER = EX0 * S + TX, EX1 * S + TX
MET, MEB = (CY - EH / 2) * S + TY, (CY + EH / 2) * S + TY
MES = ES * S


def _rect(u, v, x0, y0, x1, y1):
    """Signed distance to an axis-aligned rectangle: negative inside, and
    outside it is the true Euclidean distance, corners included."""
    ax = max(x0 - u, u - x1)
    ay = max(y0 - v, v - y1)
    return min(max(ax, ay), 0.0) + math.hypot(max(ax, 0.0), max(ay, 0.0))


def _coverage(u, v, px):
    """How much of the pixel at (u, v) the mark covers, 0..1.

    Analytic rather than supersampled: the C is the intersection of an annulus
    and everything outside the mouth wedge, and the signed distance to each is
    cheap. Taking the larger of the two gives the distance to the shape. The E
    is the same max()-of-signed-distances trick — a cap box with its two
    counters cut out, the cuts negated — and the mark is the union of the pair,
    so the nearer surface wins. A one-pixel ramp across the result is the
    anti-aliasing.
    """
    dx, dy = u - MX, v - MY
    d = math.hypot(dx, dy)
    ring = abs(d - MR) - MW / 2                        # <0 inside the stroke
    if d < 1e-9:
        # The mouth's angle is undefined at the exact centre. The ring term
        # alone is correct there — the centre is MR - MW/2 clear of the stroke —
        # and unlike the bare 0.0 this used to short-circuit with, it is a
        # distance, so it can go into the union below.
        sd_c = ring
    else:
        ang = abs(math.degrees(math.atan2(-dy, dx)))   # 0 at the mouth's centre
        wedge = d * math.sin(math.radians(GAP - ang))  # <0 outside the mouth
        sd_c = max(ring, wedge)

    # The counters' right walls run one module PAST the arm tips instead of
    # flush with them. Flush reads as exact, since box and counter would share
    # that edge — but for a point inside a counter near its open end,
    # max(box, -counter) collapses to +d, and the phantom wall seals the mouth
    # with a soft edge: 0.24 alpha at 32px where supersampled truth is 0.00. At
    # MER + MES any point out to the tips is at least MES from the wall while
    # never more than MES/2 from an arm, so the wall can never be the nearest
    # surface, and the E's worst residual falls to 0.07.
    box = _rect(u, v, MEL, MET, MER, MEB)
    top = _rect(u, v, MEL + MES, MET + MES, MER + MES, MET + 2 * MES)
    bot = _rect(u, v, MEL + MES, MEB - 2 * MES, MER + MES, MEB - MES)
    sd_e = max(box, -top, -bot)

    return min(1.0, max(0.0, 0.5 - min(sd_c, sd_e) / px))


def png_bytes(size):
    px = 100.0 / size                                  # one pixel, in mark units
    raw = bytearray()
    for y in range(size):
        raw.append(0)                                  # filter type 0
        v = (y + 0.5) * px
        for x in range(size):
            a = _coverage((x + 0.5) * px, v, px)
            raw += bytes(GOLD + (int(round(255 * a)),)) if a else b"\0\0\0\0"

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def write_png(path, size):
    with open(path, "wb") as f:
        f.write(png_bytes(size))
    print("wrote", path, f"{size}x{size}")


# --- the platform bundles ------------------------------------------------
# Both formats are containers around PNGs, which is what the previously shipped
# icon.icns and icon.ico turned out to hold, so they are written here rather
# than shelled out to a tool that has to be installed first. ImageMagick is not
# an option for the mac one: `magick x.png out.icns` writes a bare PNG under an
# .icns name, which loads nowhere and fails silently.

ICNS_TYPES = [(b"ic11", 32), (b"ic12", 64), (b"ic07", 128), (b"ic08", 256),
              (b"ic13", 256), (b"ic09", 512), (b"ic14", 512), (b"ic10", 1024)]


def write_icns(path, cache=None):
    cache = {} if cache is None else cache
    body = b""
    for typ, size in ICNS_TYPES:
        if size not in cache:
            cache[size] = png_bytes(size)
        body += typ + struct.pack(">I", len(cache[size]) + 8) + cache[size]
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print("wrote", path, f"{len(ICNS_TYPES)} members")


ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def write_ico(path, cache=None):
    cache = {} if cache is None else cache
    pngs = []
    for size in ICO_SIZES:
        if size not in cache:
            cache[size] = png_bytes(size)
        pngs.append(cache[size])
    offset = 6 + 16 * len(pngs)
    head = struct.pack("<HHH", 0, 1, len(pngs))
    for size, data in zip(ICO_SIZES, pngs):
        dim = 0 if size >= 256 else size               # 0 means 256 in an ICO
        head += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(head + b"".join(pngs))
    print("wrote", path, f"{len(pngs)} sizes")


def write_svg(path):
    """The vector source, from the same constants — for anything that wants the
    mark at a size this script was not run at. The C stays a stroked arc and
    picks the fitted numbers up automatically; the E is one filled polygon off
    those same numbers, so the vector cannot drift from the raster, and having
    no counter walls at all it cannot inherit the phantom-wall problem either.
    """
    def pt(deg):
        return (MX + MR * math.cos(math.radians(deg)),
                MY - MR * math.sin(math.radians(deg)))
    x1, y1 = pt(GAP)
    x2, y2 = pt(-GAP)
    colour = "#%02x%02x%02x" % GOLD
    # Spine down the left, three arms out to the right: 12 vertices, walked
    # from the top-left corner round to the foot of the spine.
    e = ("M %.2f %.2f H %.2f V %.2f H %.2f V %.2f H %.2f V %.2f H %.2f "
         "V %.2f H %.2f V %.2f H %.2f Z" % (
             MEL, MET,
             MER, MET + MES,
             MEL + MES, MET + 2 * MES,
             MER, MET + 3 * MES,
             MEL + MES, MET + 4 * MES,
             MER, MEB,
             MEL))
    with open(path, "w", encoding="utf-8") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
                'width="512" height="512" role="img" aria-label="Carino Editor">'
                f'<path d="M {x1:.2f} {y1:.2f} A {MR:.2f} {MR:.2f} 0 1 0 {x2:.2f} {y2:.2f}" '
                f'fill="none" stroke="{colour}" stroke-width="{MW:.2f}" '
                'stroke-linecap="butt"/>'
                f'<path d="{e}" fill="{colour}"/></svg>')
    print("wrote", path)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    write_svg(os.path.join(here, "logo.svg"))
    write_png(os.path.join(here, "icon.png"), 512)   # window icon (runtime)
    write_png(os.path.join(here, "logo50.png"), 50)  # source for the web webp
    # Size set for Linux packaging (electron-builder linux.icon = this dir).
    build = os.path.join(here, "..", "build")
    icons = os.path.join(build, "icons")
    os.makedirs(icons, exist_ok=True)
    shared = {}
    for sz in (16, 24, 32, 48, 64, 128, 256, 512):
        shared[sz] = png_bytes(sz)
        with open(os.path.join(icons, "%dx%d.png" % (sz, sz)), "wb") as f:
            f.write(shared[sz])
        print("wrote", os.path.join(icons, "%dx%d.png" % (sz, sz)), f"{sz}x{sz}")
    write_icns(os.path.join(build, "icon.icns"), shared)
    write_ico(os.path.join(build, "icon.ico"), shared)
    print()
    print("The one step this script cannot do, because it needs ImageMagick:")
    print("  the web favicon. ../../logo.webp is the same mark again, and")
    print("  logo50.png written above is its source --")
    print("      magick assets/logo50.png -define webp:lossless=true ../../logo.webp")
    print("  That is a change to the web payload, not to the desktop build, and")
    print("  it does not stop there: the PACS repo vendors this editor and its")
    print("  copy of the favicon is meant to be byte-identical, so the same")
    print("  bytes have to land in <Carino-PACS>/pacs/web/editor/logo.webp.")
    print("  Regenerate one without the other and the vendoring rule breaks.")
