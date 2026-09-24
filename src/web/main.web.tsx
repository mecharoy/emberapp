// Web edition entry: the same app as the phone, plus the offline cache.
import "../main";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline use is a bonus; the app works without it.
    });
  });
}
