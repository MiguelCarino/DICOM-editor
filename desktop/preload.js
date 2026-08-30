/* ============================================================
   Preload — the whole surface the page is allowed to see.
   ------------------------------------------------------------
   contextIsolation stays true and nodeIntegration stays false, so this
   file is the ONLY channel between the shell and index.html. What it
   publishes is deliberately four members wide:

       window.carinoDesktop = {
         appVersion,          // "1.0.0" — a string, fixed at launch
         getUpdate(),         // → Promise<{version, url} | null>
         onUpdate(cb),        // cb({version, url}) when a check finds one
         openReleasePage(),   // opens the release in the system browser
       }

   No ipcRenderer object, no require, no fs, no path — nothing the page
   could use to reach the machine. openReleasePage() takes no argument on
   purpose: the URL it opens is the one the MAIN process recorded and
   validated, so a compromised renderer cannot turn shell.openExternal
   into an arbitrary launcher.

   index.html feature-detects this object and does nothing at all when it
   is absent, which is what keeps the browser build and the copy vendored
   into the PACS byte-identical to this repo's.
   ============================================================ */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// The version arrives as a command-line argument rather than over IPC so that
// `carinoDesktop.appVersion` can be a plain string the page reads synchronously
// during boot, instead of a promise it has to await before it can render.
// The sendSync fallback exists because process.argv in a SANDBOXED preload is
// a polyfill, not the real Node one, and how much of it survives has moved
// between Electron majors. Getting this wrong would not throw — appVersion
// would just quietly be the empty string — so it is worth the four lines.
const VERSION_FLAG = "--carino-app-version=";
const appVersion = (() => {
  try {
    const argv = Array.isArray(process.argv) ? process.argv : [];
    const flag = argv.find((a) => typeof a === "string" && a.startsWith(VERSION_FLAG));
    if (flag) return flag.slice(VERSION_FLAG.length);
  } catch (e) { /* fall through */ }
  try { return String(ipcRenderer.sendSync("carino:app-version") || ""); } catch (e) { return ""; }
})();

// Subscribers are kept here rather than handed to ipcRenderer.on directly, so
// the page never holds a reference to an Electron object, and so one throwing
// callback cannot stop the others from running.
const subscribers = [];
ipcRenderer.on("carino:update", (_event, info) => {
  for (const cb of subscribers) {
    try { cb(info); } catch (e) { /* a broken listener is the page's problem, not ours */ }
  }
});

contextBridge.exposeInMainWorld("carinoDesktop", Object.freeze({
  appVersion,
  getUpdate: () => ipcRenderer.invoke("carino:update"),
  onUpdate: (cb) => { if (typeof cb === "function") subscribers.push(cb); },
  openReleasePage: () => { ipcRenderer.send("carino:open-release"); },
}));
