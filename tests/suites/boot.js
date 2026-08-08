// Where the library tags sit, and that the app still sees them.
//
// dcmjs, the de-identification profile and the tag dictionary are 1.4 MB of
// classic, parser-blocking script. In <head> they held the first paint for three
// seconds on a 5 Mbps cold load; below the markup they hold nothing, because
// nothing above them needs them. That is a property of *where the tags are*, and
// nothing else in this directory would notice if they moved back — every other
// suite loads the finished page and would pass just as happily on the slow one.
//
// So this suite asserts the arrangement itself, and the two ways of undoing it
// that look like tidying: putting them back in <head>, or adding `defer` to make
// them non-blocking there. `defer` would run all three *after* the inline app
// script, which destructures dcmjs.data at top level — the page would die on the
// first line of the app with a bare "dcmjs is not defined".
(window.SUITES || (window.SUITES = {})).boot = async () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  try {
    const LIBS = ['vendor/dcmjs.min.js', 'deid-profile.js', 'dicom-dictionary.js'];
    const all = [...document.querySelectorAll('script')];
    const bySrc = s => all.find(el => el.getAttribute('src') === s);
    // The app script is the inline one that opens the tag dictionary. The test
    // runner injects its own <script src> tags after it, so "the last script"
    // would be the wrong thing to look for.
    const app = all.find(el => !el.src && /EXTENDED TAG DICTIONARY/.test(el.textContent));

    ok('the inline app script is where it was', !!app);

    // ---- the libraries arrived, in a form the app can use --------------------
    ok('dcmjs loaded', typeof dcmjs === 'object' && !!dcmjs.data);
    ok('the de-identification profile loaded', !!window.DEID_PROFILE);
    ok('the tag dictionary loaded', !!window.DICOM_DICT);
    // This is the line that dies if the tags ever end up below the app script:
    // it is the top-level destructure of dcmjs.data, seen from outside.
    ok('the app destructured dcmjs at parse time',
       typeof DicomMessage === 'function' && typeof DicomDict === 'function');

    // ---- nothing in <head> blocks the paint ---------------------------------
    // Only scripts with a src count: the runner injects a tiny inline error probe
    // into <head>, and an inline script fetches nothing to wait for.
    const headBlocking = [...document.head.querySelectorAll('script[src]')]
      .filter(el => !el.defer && !el.async)
      .map(el => el.getAttribute('src'));
    ok('no parser-blocking script is left in <head>', headBlocking.length === 0, headBlocking.join(','));

    for (const src of LIBS) {
      const el = bySrc(src);
      ok(`${src} is on the page`, !!el);
      if (!el) continue;
      ok(`${src} is below the markup, not in <head>`,
         el.parentNode !== document.head &&
         !!(document.getElementById('fullscreenOverlay')
              .compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      // defer/async here would reorder them behind the app script; type=module
      // defers implicitly and would do the same.
      ok(`${src} still runs synchronously`,
         !el.defer && !el.async && !el.type,
         [el.defer ? 'defer' : '', el.async ? 'async' : '', el.type].filter(Boolean).join(' '));
      ok(`${src} runs before the app script`,
         !!(el.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING));
    }

    // Order matters between them only in that the app reads all three; assert it
    // anyway, so a future library that depends on another cannot be reshuffled
    // without someone noticing.
    const order = all.filter(el => LIBS.includes(el.getAttribute('src'))).map(el => el.getAttribute('src'));
    ok('the three keep their original order', order.join(',') === LIBS.join(','), order.join(','));
  } catch (e) {
    ok('suite ran to completion', false, (e && e.stack ? e.stack.split('\n')[0] : String(e)));
  }

  return out;
};

// Two callers: tests/run.sh injects this file alone and scrapes the <pre> below;
// index.html#selftest sets window.SELFTEST and awaits the returned lines instead.
if (!window.SELFTEST) window.addEventListener('load', async () => {
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = (await window.SUITES.boot()).join('\n');
  document.body.appendChild(pre);
});
