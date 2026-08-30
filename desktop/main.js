/* ============================================================
   Carino DICOM Editor desktop — Electron shell.
   ------------------------------------------------------------
   A window around the editor's own web UI, and nothing more. Three
   decisions carry the whole design of this file.

   It does NOT load the page over file://. vendor/openjpegwasm_decode.js
   and vendor/charlswasm_decode.js are emscripten output that reaches for
   fetch, WebAssembly.instantiateStreaming and XMLHttpRequest, all of
   which a file:// origin refuses — that is JPEG 2000 and JPEG-LS, i.e.
   the compressed transfer syntaxes, silently gone. So the bundle is
   served over a custom app:// scheme registered as standard + secure,
   which also keeps localStorage, crypto.subtle and CSP behaving exactly
   as they do on dcm.carino.systems.

   It adds NO native file features. No save-in-place, no open dialog, no
   .dcm association. Drag-drop and the in-page picker already work here
   exactly as in a browser, and holding that line is what keeps the diff
   to index.html near zero — which matters because pacs/web/editor/ is a
   byte-identical vendored copy of this repo and has to stay one.

   Its update story is CHECK ONLY: one GET to the GitHub releases API, a
   semver comparison, and a quiet line in the page's header if something
   newer exists. Nothing is downloaded, nothing is installed, and a check
   that fails is forgotten without a word.

   KNOWN LIMIT, to be lived with rather than fixed: the PACS hand-off —
   the "#load=" manifest fetch at index.html:9224 — does not work in this
   standalone app. The PACS echoes CORS only for a configured http(s)
   editor_url, and this origin is app://. That is expected: this build is
   for people who do not run a PACS. Someone who does should open the
   editor bundled inside Carino DICOM, where the hand-off is same-origin.

   Dev run:   cd desktop && npm install && npm start
   ============================================================ */
"use strict";

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require("electron");
const https = require("https");
const path = require("path");
const fs = require("fs");
// Shell-side dictionary (application menu, update dialogs). The page translates
// itself in the renderer; nothing here can. Loaded defensively: a missing
// translation file must never be the reason the app won't start. If the module
// is left out of build.files the shell just stays English (and this is why it
// is listed there).
let initI18n = () => {};
let t = (s, vals) => (vals ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vals[k] != null ? vals[k] : m)) : s);
try {
  const i18n = require("./i18n");
  initI18n = i18n.init;
  t = i18n.t;
} catch (e) { /* no dictionary shipped → English */ }

const ASSETS = path.join(__dirname, "assets");

// The web payload rides in extraResources rather than inside app.asar, because
// the two emscripten decoders call WebAssembly.instantiateStreaming on a real
// URL and locateFile() hands them a plain "vendor/…" path — an asar entry is
// not a file on disk and neither reaches one. In development the payload is
// simply the repo root, one level up from here, which does mean `npm start`
// can serve desktop/ and .git/ over app:// as well; a packaged build cannot,
// because Resources/web holds nothing but the payload.
const WEB_ROOT = (() => {
  const raw = app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "..");
  // Resolve symlinks once, up front: the containment check below compares
  // resolved paths, and a WEB_ROOT that is itself a symlink would make every
  // legitimate request look like it had escaped.
  try { return fs.realpathSync(raw); } catch (e) { return path.resolve(raw); }
})();

let win = null;

// ---- the app:// scheme -------------------------------------------------
// registerSchemesAsPrivileged has to run before app.whenReady(), which is why
// it sits at module scope instead of in the lifecycle section at the bottom.
//   standard        → a real origin, so localStorage and CSP behave normally
//   secure          → crypto.subtle exists (index.html hashes with SHA-256)
//   supportFetchAPI → fetch('logo.webp') and instantiateStreaming work
//   stream          → range/streamed responses are permitted
//   corsEnabled     → same-origin requests are not treated as opaque
const SCHEME = "app";
const HOST = "carino";
const START_URL = SCHEME + "://" + HOST + "/index.html";

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function notFound() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// Serves one file out of WEB_ROOT and refuses everything else.
//
// The containment argument, because it is the only thing standing between a
// crafted URL and the user's home directory: a standard scheme already
// collapses literal "../" segments during URL parsing, but a percent-encoded
// "%2e%2e%2f" survives that and only becomes "../" after decodeURIComponent —
// so the check must never look at the string. It looks at the RESOLVED path
// instead. Every request is joined onto WEB_ROOT and run through
// path.resolve(), which normalises "..", "." and (on Windows) backslashes into
// one absolute path; that path is then required to be WEB_ROOT itself or to
// start with WEB_ROOT + the platform separator. "app://carino/../../etc/passwd"
// and "app://carino/%2e%2e%2f%2e%2e%2fetc%2fpasswd" both resolve to /etc/passwd,
// which satisfies neither, so both get a 404. The separator is part of the
// prefix on purpose: without it a sibling directory named like the root with a
// suffix would pass. Directories are refused outright — there are no listings.
async function serveFromBundle(request) {
  let url;
  try { url = new URL(request.url); } catch (e) { return notFound(); }
  if (url.host !== HOST) return notFound();

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return notFound(); }
  if (rel.indexOf("\0") !== -1) return notFound();
  if (rel === "" || rel === "/") rel = "/index.html";

  const target = path.resolve(WEB_ROOT, "." + rel);
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) return notFound();

  // Resolved a second time, through the filesystem this time. path.resolve()
  // normalises a string; it does not follow links, and stat() and readFile()
  // both do. Without this a symlink anywhere inside the bundle is served with
  // the full contents of whatever it points at, and the containment test above
  // still passes because the STRING is inside WEB_ROOT. It is not theoretical
  // in development, where WEB_ROOT is the repo itself and node_modules/.bin is
  // full of links; a packaged build would otherwise be relying on
  // electron-builder never preserving one.
  let real;
  try { real = await fs.promises.realpath(target); } catch (e) { return notFound(); }
  if (real !== WEB_ROOT && !real.startsWith(WEB_ROOT + path.sep)) return notFound();

  let stat;
  try { stat = await fs.promises.stat(real); } catch (e) { return notFound(); }
  if (!stat.isFile()) return notFound();

  let body;
  try { body = await fs.promises.readFile(real); } catch (e) { return notFound(); }
  const type = CONTENT_TYPES[path.extname(real).toLowerCase()] || "application/octet-stream";
  return new Response(body, { headers: { "content-type": type } });
}

// ---- update check ------------------------------------------------------
// Check-only, on purpose: no electron-updater, no download, no install, no
// latest*.yml, and therefore no code signing needed to make any of it work.
//
// The repository name is a PINNED LITERAL. api.github.com does not follow
// GitHub's rename redirect, so the moment this string drifts from the real repo
// the request 404s and the notifier simply never fires again — silently, which
// is exactly the failure that inferring it from package.json, the git remote or
// homepage would make easy to introduce.
const RELEASES_API = "https://api.github.com/repos/MiguelCarino/Carino-DICOM-Editor/releases/latest";
const RELEASE_PREFIX = "https://github.com/MiguelCarino/Carino-DICOM-Editor/";
const REPO_URL = "https://github.com/MiguelCarino/Carino-DICOM-Editor";
const LICENCE_URL = "https://github.com/MiguelCarino/Carino-DICOM-Editor/blob/main/LICENSE";

const CHECK_TIMEOUT_MS = 10000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Far enough after launch that the first study a user drags in has already been
// parsed and drawn; a network round trip must never compete with startup.
const FIRST_CHECK_DELAY_MS = 25000;
// The gate is the 24-hour stamp, not this interval — the timer only decides how
// often we bother to look at the clock, which matters for a document app that
// stays open for days.
const CHECK_TICK_MS = 6 * 60 * 60 * 1000;
const OPT_IN_DELAY_MS = 2500;

// enabled: null means the question has never been answered. Default is OFF.
let updates = { enabled: null, lastCheckMs: 0, lastSeenVersion: null };
let pendingUpdate = null;   // { version, url } once a strictly newer release is known

function updatesFile() { return path.join(app.getPath("userData"), "updates.json"); }

function loadUpdateState() {
  try {
    const j = JSON.parse(fs.readFileSync(updatesFile(), "utf8"));
    if (j && typeof j === "object") {
      updates.enabled = typeof j.enabled === "boolean" ? j.enabled : null;
      updates.lastCheckMs = Number(j.lastCheckMs) || 0;
      updates.lastSeenVersion = typeof j.lastSeenVersion === "string" ? j.lastSeenVersion : null;
    }
  } catch (e) { /* absent or corrupt → first run */ }
  // Seed from disk so the header can say what it said yesterday without waiting
  // for a round trip, and so a user who is already at or past that version sees
  // nothing at all.
  if (isNewer(updates.lastSeenVersion, app.getVersion())) {
    pendingUpdate = { version: normalise(updates.lastSeenVersion), url: releaseUrlFor(updates.lastSeenVersion) };
  }
}

function saveUpdateState() {
  try {
    fs.mkdirSync(path.dirname(updatesFile()), { recursive: true });
    fs.writeFileSync(updatesFile(), JSON.stringify(updates));
  } catch (e) { /* non-fatal: the worst case is asking again next launch */ }
}

// Strict on purpose. A tag has to be exactly X.Y.Z with an optional leading v;
// anything decorated — "v1.1.0-rc2", "2024.06", "nightly" — is unparseable and
// unparseable means "no update". /releases/latest already excludes prereleases,
// so this is a second lock on the same door: Carino DICOM's own desktop build
// sits at 1.1.0 while its newest stable release is v1.0.0, and a compare that
// tolerated the -rc tags would tell that user to install an older version.
function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s == null ? "" : s).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function normalise(tag) { const v = parseVersion(tag); return v ? v.join(".") : null; }

// Strictly newer, field by field — never a string comparison, which would put
// "1.10.0" before "1.9.0" and "1.1.0" after "1.0.0" only by luck.
function isNewer(remoteTag, localTag) {
  const a = parseVersion(remoteTag), b = parseVersion(localTag);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

// The only URL this app will ever hand to shell.openExternal from update data.
// GitHub's own html_url is preferred when it points where it should, and a URL
// derived from the tag is the fallback — so a surprising API response cannot
// turn the "release page" link into an arbitrary launcher.
function releaseUrlFor(tag, apiUrl) {
  // Parsed and compared, not string-prefixed. A prefix test accepts
  // "https://github.com/MiguelCarino/Carino-DICOM-Editor/../../anything", which
  // new URL() then normalises to https://github.com/anything — bounded to
  // github.com, so not a launcher, but still somewhere we never meant to send
  // anybody. Compare the origin and require the path to be inside this repo's.
  if (typeof apiUrl === "string") {
    try {
      const u = new URL(apiUrl);
      const base = new URL(RELEASE_PREFIX);
      if (u.origin === base.origin && u.pathname.startsWith(base.pathname)) return u.href;
    } catch (e) { /* unparseable — fall through to the derived URL */ }
  }
  return RELEASE_PREFIX + "releases/tag/" + encodeURIComponent(String(tag));
}

// Resolves to { tag, url } or null. Never rejects: every failure is the same
// failure as far as the rest of this file is concerned.
function fetchLatestRelease() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = https.get(RELEASES_API, {
        headers: {
          // GitHub answers 403 to a request with no User-Agent.
          "User-Agent": "Carino-DICOM-Editor/" + app.getVersion(),
          "Accept": "application/vnd.github+json",
        },
      }, (res) => {
        // Redirects are deliberately not followed. The only redirect this
        // endpoint would ever issue is the repository-rename one, and following
        // it would hide precisely the drift the pinned literal above exists to
        // make loud.
        //
        // 404 here is not a failure and must not be reported as one: it is what
        // this endpoint returns for a repository that has published no stable
        // release yet, which is the editor's situation until its first tag
        // lands. A null tag falls through isNewer() as "not newer", so the rest
        // of this file already treats it as "nothing to install" — which is
        // true — instead of telling the user their network is broken.
        if (res.statusCode === 404) { res.resume(); return finish({ tag: null, url: null }); }
        if (res.statusCode !== 200) { res.resume(); return finish(null); }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1000000) { req.destroy(); finish(null); }   // no unbounded reads
        });
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            finish(j && j.tag_name ? { tag: String(j.tag_name), url: j.html_url } : null);
          } catch (e) { finish(null); }
        });
      });
    } catch (e) { return finish(null); }
    req.setTimeout(CHECK_TIMEOUT_MS, () => { req.destroy(); finish(null); });
    req.on("error", () => finish(null));
  });
}

function announceUpdate() {
  if (!pendingUpdate) return;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("carino:update", pendingUpdate);
  }
}

// manual === true means the user picked "Check for updates now" and is owed an
// answer, including when the answer is "that didn't work". An automatic check
// is silent in every outcome except finding something: no retry, no dialog, no
// log line. A clinic on an air-gapped network must not accumulate an hourly
// "couldn't reach GitHub" in a log an operator is trying to read.
async function runCheck(manual) {
  updates.lastCheckMs = Date.now();
  saveUpdateState();

  const rel = await fetchLatestRelease();
  if (!rel) {
    if (manual) {
      dialog.showMessageBox(win || undefined, {
        type: "info", noLink: true,
        title: "Carino DICOM Editor",
        message: t("Could not check for updates"),
        detail: t("GitHub could not be reached. Nothing was changed; try again later."),
        buttons: [t("Close")],
      });
    }
    return;
  }

  const current = app.getVersion();
  if (!isNewer(rel.tag, current)) {
    // Also clears a stale note: a user who has just installed the newer build
    // should stop being told about it.
    pendingUpdate = null;
    updates.lastSeenVersion = null;
    saveUpdateState();
    if (manual) {
      dialog.showMessageBox(win || undefined, {
        type: "info", noLink: true,
        title: "Carino DICOM Editor",
        message: t("No update available"),
        detail: t("You are running the newest version, {version}.", { version: current }),
        buttons: [t("Close")],
      });
    }
    return;
  }

  pendingUpdate = { version: normalise(rel.tag), url: releaseUrlFor(rel.tag, rel.url) };
  updates.lastSeenVersion = pendingUpdate.version;
  saveUpdateState();
  announceUpdate();

  if (manual) {
    const r = await dialog.showMessageBox(win || undefined, {
      type: "info", noLink: true,
      title: "Carino DICOM Editor",
      message: t("An update is available"),
      detail: t("Version {version} has been released. You are running {current}.", { version: pendingUpdate.version, current }),
      buttons: [t("Open release page"), t("Close")],
      defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) openExternally(pendingUpdate.url);
  }
}

function maybeCheck() {
  if (updates.enabled !== true) return;
  if (Date.now() - updates.lastCheckMs < DAY_MS) return;
  runCheck(false);
}

function setUpdatesEnabled(on) {
  updates.enabled = !!on;
  saveUpdateState();
  if (updates.enabled) setTimeout(maybeCheck, 1500);
}

// Asked once, in one sentence, with two buttons. Dismissing the dialog lands on
// cancelId, which is "Don't check" — so the default for anyone who never
// answers stays OFF.
async function ensureUpdateOptIn() {
  if (updates.enabled !== null) return;
  const r = await dialog.showMessageBox(win || undefined, {
    type: "question", noLink: true,
    title: "Carino DICOM Editor",
    message: t("Should Carino DICOM Editor check GitHub for new versions once a day?"),
    detail: t("Nothing is sent, downloaded or installed — it only reads the number of the latest release."),
    buttons: [t("Check for updates"), t("Don't check")],
    defaultId: 0, cancelId: 1,
  });
  setUpdatesEnabled(r.response === 0);
}

// ---- navigation safety -------------------------------------------------
// Every link that leaves the app goes to the user's real browser, and nothing
// navigates the window away from app://. The page links out to carino.systems,
// github.com and linkedin.com, and it navigates internally to tests/gallery.html
// and back, so both halves are exercised in normal use.
function openExternally(target) {
  let u;
  try { u = new URL(target); } catch (e) { return; }
  // http(s) only. shell.openExternal will happily hand file:, smb: or a Windows
  // protocol handler to the OS, and none of those belong at the end of a link
  // that came out of a rendered page.
  if (u.protocol !== "https:" && u.protocol !== "http:") return;
  shell.openExternal(u.toString());
}

function isInApp(target) {
  try {
    const u = new URL(target);
    return u.protocol === SCHEME + ":" && u.host === HOST;
  } catch (e) { return false; }
}

// ---- window ------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 880, minWidth: 900, minHeight: 600, show: false,
    title: "Carino DICOM Editor", icon: path.join(ASSETS, "icon.png"),
    backgroundColor: "#050505",   // index.html's own body background — no white flash
    webPreferences: {
      // Stated rather than left to the defaults, because preload.js is the
      // entire attack surface between the page and this machine and the three
      // switches that decide how wide it is should be readable in one place.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: ["--carino-app-version=" + app.getVersion()],
    },
  });

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Unlike the PACS shell, this app opens no child windows at all: there is
    // no bundled second product here to hand a study to, so every target:_blank
    // is by definition somewhere on the web.
    openExternally(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (e, url) => {
    if (isInApp(url)) return;   // tests/gallery.html and its way back
    e.preventDefault();
    openExternally(url);
  });

  win.loadURL(START_URL);
}

// ---- menu --------------------------------------------------------------
// A real menu, unlike the PACS tray agent's Menu.setApplicationMenu(null): this
// is a document app, and Copy, Zoom and Reload are things its users reach for.
// File carries only Quit/Close — there is no Open, because there are no native
// file features here at all; the page's own picker and drag-drop are the way in.
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: t("Check for updates now"), click: () => runCheck(true) },
        {
          label: t("Check for updates automatically"), type: "checkbox",
          checked: updates.enabled === true,
          click: (item) => setUpdatesEnabled(item.checked),
        },
        { type: "separator" },
        { label: t("Carino DICOM Editor on GitHub"), click: () => openExternally(REPO_URL) },
        { label: t("Licence (AGPL-3.0)"), click: () => openExternally(LICENCE_URL) },
      ],
    },
  ]);
}

// ---- lifecycle ---------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    // app.getLocale() is only reliable once ready, and everything that draws
    // shell text (the menu, the opt-in question) runs after this point.
    initI18n(app);
    loadUpdateState();

    protocol.handle(SCHEME, serveFromBundle);

    // The page asks for the update at boot and is told again if one turns up
    // later; openReleasePage takes no argument, so the URL opened is always the
    // one validated above and never one the renderer chose.
    ipcMain.handle("carino:update", () => pendingUpdate);
    ipcMain.on("carino:open-release", () => { if (pendingUpdate) openExternally(pendingUpdate.url); });
    // Only reached if additionalArguments did not survive into the sandboxed
    // preload's process.argv; see the note there. Synchronous because the page
    // reads carinoDesktop.appVersion as a plain string during boot.
    ipcMain.on("carino:app-version", (e) => { e.returnValue = app.getVersion(); });

    Menu.setApplicationMenu(buildAppMenu());
    createWindow();

    setTimeout(() => {
      ensureUpdateOptIn().then(() => {
        Menu.setApplicationMenu(buildAppMenu());   // the checkbox now has an answer to show
        setTimeout(maybeCheck, FIRST_CHECK_DELAY_MS);
        setInterval(maybeCheck, CHECK_TICK_MS);
      });
    }, OPT_IN_DELAY_MS);
  });

  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => { if (!win) createWindow(); else win.show(); });
}
