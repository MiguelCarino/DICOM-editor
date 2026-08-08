#!/usr/bin/env bash
# Runs the suites in tests/suites against the real index.html in headless Chromium.
#
#   ./tests/run.sh              # everything
#   ./tests/run.sh pixels       # named suites only
#
# Each suite is injected into a copy of index.html, after tests/dicom-forge.js,
# and reports by appending a <pre id="TESTOUT"> of "PASS :: name" / "FAIL :: name"
# lines that we read back out of the dumped DOM. The copy has to sit in the repo
# root: index.html pulls vendor/ and the sibling scripts by relative path, so
# running it from elsewhere would load a page with no app on it and every
# assertion would fail for the wrong reason.
#
# Served over HTTP rather than opened as file://, because file:// treats every
# external script as a foreign origin — errors collapse to "Script error." with
# no file or line, and dcmjs never loads. GitHub Pages serves this over HTTP, so
# should we.
set -uo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-chromium-browser}"
PORT="${PORT:-8734}"
BUDGET="${BUDGET:-30000}"
RUNFILE=".testrun.html"

command -v "$CHROME" >/dev/null || { echo "no $CHROME on PATH; set CHROME=..." >&2; exit 127; }

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'rm -f "$RUNFILE"; kill $SERVER 2>/dev/null' EXIT

for _ in $(seq 50); do
    if (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then exec 3<&-; break; fi
    sleep 0.1
done
kill -0 $SERVER 2>/dev/null || { echo "could not start a server on :$PORT (set PORT=...)" >&2; exit 1; }

if [ $# -gt 0 ]; then
    suites=("$@")
else
    suites=()
    for f in tests/suites/*.js; do suites+=("$(basename "$f" .js)"); done
fi

total=0; failed=0; missing=0

for suite in "${suites[@]}"; do
    src="tests/suites/${suite}.js"
    if [ ! -f "$src" ]; then
        echo "?? ${suite}: no such suite" >&2; missing=$((missing + 1)); continue
    fi

    python3 - "$suite" "$RUNFILE" <<'PY'
import sys
suite, runfile = sys.argv[1], sys.argv[2]
html = open('index.html').read()
# Record the first boot error, so a suite that never reports can say why it died
# instead of leaving us to guess. Goes in <head>, ahead of every app script.
probe = ('<script>window.addEventListener("error", (e) => {'
         'if (document.getElementById("BOOTERR")) return;'
         'const p = document.createElement("pre"); p.id = "BOOTERR";'
         'p.textContent = e.message + " @ " + (e.filename || "").split("/").pop() + ":" + e.lineno;'
         'document.documentElement.appendChild(p); });</script>')
if '</head>' not in html or '</body>' not in html:
    sys.exit('index.html is missing </head> or </body> to inject into')
html = html.replace('</head>', probe + '</head>', 1)
inject = ('<script src="tests/dicom-forge.js"></script>\n'
          f'<script src="tests/suites/{suite}.js"></script>\n')
# The last </body>, not the first: the print/export code builds a whole HTML
# document inside a template string, so an earlier one is only ever a literal.
head, sep, tail = html.rpartition('</body>')
open(runfile, 'w').write(head + inject + sep + tail)
PY

    dom=$("$CHROME" --headless --disable-gpu --no-sandbox \
          --virtual-time-budget="$BUDGET" --dump-dom "http://127.0.0.1:$PORT/$RUNFILE" 2>/dev/null)

    results=$(printf '%s' "$dom" | python3 -c '
import sys, re, html
dom = sys.stdin.read()
m = re.search(r"<pre id=\"TESTOUT\">(.*?)</pre>", dom, re.S)
print(html.unescape(m.group(1)).strip() if m else "")
')

    if [ -z "$results" ]; then
        boot=$(printf '%s' "$dom" | python3 -c '
import sys, re, html
m = re.search(r"<pre id=\"BOOTERR\">(.*?)</pre>", sys.stdin.read(), re.S)
print(html.unescape(m.group(1)).strip() if m else "")
')
        echo "FAIL ${suite}: reported nothing${boot:+ -- ${boot}}"
        [ -z "$boot" ] && echo "       (no boot error either; suite may not have run)"
        failed=$((failed + 1)); continue
    fi

    n=$(printf '%s\n' "$results" | grep -c '^\(PASS\|FAIL\) ::')
    bad=$(printf '%s\n' "$results" | grep '^FAIL ::')
    total=$((total + n))

    if [ -n "$bad" ]; then
        nbad=$(printf '%s\n' "$bad" | wc -l)
        failed=$((failed + nbad))
        printf 'FAIL %-12s %d/%d\n' "$suite" "$((n - nbad))" "$n"
        printf '%s\n' "$bad" | sed 's/^/       /'
    else
        printf 'ok   %-12s %d\n' "$suite" "$n"
    fi
done

echo "---"
if [ "$failed" -eq 0 ] && [ "$missing" -eq 0 ]; then
    echo "$total assertions, all passing"
else
    echo "$total assertions, $failed failing${missing:+, $missing suite(s) missing}"
    exit 1
fi
