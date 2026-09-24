// The web edition of Elytra, for iPhones (and any browser): the phone app's
// screens and code, with the native Tauri modules swapped for the browser
// stand-ins in src/web/. Build with `npm run build:web`; the site lands in
// dist-web/ and can be served from any static host.
//
// It is a home-screen web app: web/public/manifest.webmanifest makes "Add to
// Home Screen" open it full-screen, and the generated sw.js keeps it working
// offline. The journal lives in the browser (src/web/sql.ts).

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version: string };
const web = (p: string) => resolve(__dirname, "src/web", p);

/** Copies web/public into the build and writes a service worker that keeps
 *  every built file for offline use. Video is left to the network: Safari
 *  plays it with range requests, which a cache-first worker would break. */
function webShell(): Plugin {
  let files: string[] = [];
  let outDir = "dist-web";
  return {
    name: "elytra-web-shell",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    generateBundle(_opts, bundle) {
      files = Object.keys(bundle);
    },
    writeBundle() {
      const from = resolve(__dirname, "web/public");
      const copy = (dir: string, rel = "") => {
        for (const e of readdirSync(resolve(dir, rel), { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            mkdirSync(resolve(outDir, r), { recursive: true });
            copy(dir, r);
          } else copyFileSync(resolve(dir, r), resolve(outDir, r));
        }
      };
      copy(from);
      // Hosts serve index.html; the source page is named for the web edition.
      renameSync(resolve(outDir, "index.web.html"), resolve(outDir, "index.html"));
      const publicFiles = readdirSync(resolve(__dirname, "public")).filter((f) => !f.endsWith(".mp4"));
      const shell = ["./", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
      const precache = [...new Set([...shell, ...files.filter((f) => !f.endsWith(".map") && !f.endsWith(".html")), ...publicFiles])];
      const version = createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 12);
      const sw = readFileSync(resolve(__dirname, "web/sw.template.js"), "utf8")
        .replace("__VERSION__", `${pkg.version}-${version}`)
        .replace("__PRECACHE__", JSON.stringify(precache));
      writeFileSync(resolve(outDir, "sw.js"), sw);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), webShell()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    "import.meta.env.VITE_WEB": JSON.stringify("1"),
  },
  resolve: {
    alias: {
      "@tauri-apps/plugin-sql": web("sql.ts"),
      "@tauri-apps/api/core": web("core.ts"),
      "@tauri-apps/api/event": web("plugins.ts"),
      "@tauri-apps/api/app": web("plugins.ts"),
      "@tauri-apps/plugin-http": web("plugins.ts"),
      "@tauri-apps/plugin-opener": web("plugins.ts"),
      "@tauri-apps/plugin-dialog": web("plugins.ts"),
      "@tauri-apps/plugin-fs": web("plugins.ts"),
      "@tauri-apps/plugin-notification": web("plugins.ts"),
    },
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "index.web.html") },
  },
  server: { port: 1430, strictPort: true },
  preview: { port: 1431, strictPort: true },
});
