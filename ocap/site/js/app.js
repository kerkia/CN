// The app's shell: the bottom tabs, the router (#/bientot, #/direct[/<race>[/<class>]], #/recemment, #/reglages), the
// language of the page and the service worker that keeps the app on the phone (offline shell, instant start).
import { t, lang } from "./i18n.js";

const PAGES = {
  bientot: () => import("./soon.js"),
  direct: () => import("./live.js"),
  recemment: () => import("./recent.js"),
  reglages: () => import("./prefs.js"),
};
const TABS = [["bientot", "tab.soon", "M8 2v4M16 2v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"],
  ["direct", "tab.live", "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"],
  ["recemment", "tab.recent", "M5 21V4M5 4h11l-2 4 2 4H5"],
  ["reglages", "tab.settings", "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4"]];

let leave = null;                                   // the current page's clean-up (a live connection to close)

function tabs(active) {
  document.getElementById("tabs").innerHTML = TABS.map(([r, k, d]) => `<a href="#/${r}" class="${r === active ? "on" : ""}"
    ${r === active ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${t(k)}</span></a>`).join("");
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const page = PAGES[parts[0]] ? parts[0] : "direct";
  document.documentElement.lang = lang();
  tabs(page);
  if (leave) { try { leave(); } catch (e) { /* already gone */ } leave = null; }
  const view = document.getElementById("view");
  const mod = await PAGES[page]();
  leave = (await mod.render(view, parts.slice(1))) || null;
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
document.addEventListener("ocap:lang", route);
route();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* no offline shell: the app still works */ });
}
