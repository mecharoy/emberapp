// Web edition: small stand-ins for the Tauri plugins the phone app imports.
// vite.web.config.ts points each "@tauri-apps/…" module at an export below.
//
//   api/event          → an in-page event bus (one window, so that is all it needs)
//   api/app            → the version this site was built from
//   plugin-http        → the browser's fetch
//   plugin-opener      → a new tab
//   plugin-dialog/fs   → a file picker and a download
//   plugin-notification→ nothing scheduled: a web page can't wake itself up

// ---------- api/event ----------

type Handler = (event: { event: string; payload: unknown; id: number }) => void;
const handlers = new Map<string, Set<Handler>>();
let nextId = 1;

export async function listen<T>(event: string, handler: (e: { event: string; payload: T; id: number }) => void) {
  const set = handlers.get(event) ?? new Set<Handler>();
  set.add(handler as Handler);
  handlers.set(event, set);
  return () => {
    set.delete(handler as Handler);
  };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  const id = nextId++;
  for (const h of [...(handlers.get(event) ?? [])]) {
    try {
      h({ event, payload, id });
    } catch (e) {
      console.error(e);
    }
  }
}

// ---------- api/app ----------

export async function getVersion(): Promise<string> {
  return __APP_VERSION__;
}

// ---------- plugin-http ----------

/** Anthropic answers pages only when asked in so many words; the key is the
 *  person's own and never leaves their browser except to Anthropic. */
export function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.anthropic.com/")) {
    const headers = new Headers(init?.headers);
    headers.set("anthropic-dangerous-direct-browser-access", "true");
    return window.fetch(input, { ...init, headers });
  }
  return window.fetch(input, init);
}

// ---------- plugin-opener ----------

export async function openUrl(url: string): Promise<void> {
  window.open(url, "_blank", "noopener");
}

// ---------- plugin-dialog + plugin-fs ----------

const picked = new Map<string, File>();
const savedNames = new Map<string, string>();

/** A file picker. Returns a token that readFile() turns into the bytes. */
export function open(_options?: unknown): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    let done = false;
    input.onchange = () => {
      done = true;
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      const token = `picked:${Date.now()}`;
      picked.set(token, file);
      resolve(token);
    };
    // iOS gives no event for a cancelled picker; the page regaining focus
    // without a file is the closest thing.
    window.addEventListener(
      "focus",
      () =>
        setTimeout(() => {
          if (!done) {
            input.remove();
            resolve(null);
          }
        }, 800),
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

export async function readFile(token: string): Promise<Uint8Array> {
  const file = picked.get(token);
  if (!file) throw new Error("That file is no longer available.");
  picked.delete(token);
  return new Uint8Array(await file.arrayBuffer());
}

/** "Where to save": the browser decides, so this only remembers the name. */
export async function save(options?: { defaultPath?: string }): Promise<string | null> {
  const name = (options?.defaultPath ?? "elytra-export.txt").split(/[\\/]/).pop() || "elytra-export.txt";
  const token = `save:${Date.now()}`;
  savedNames.set(token, name);
  return token;
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function writeTextFile(token: string, contents: string): Promise<void> {
  const name = savedNames.get(token) ?? token;
  savedNames.delete(token);
  download(name, contents, name.endsWith(".json") ? "application/json" : "text/plain");
}

// ---------- plugin-notification ----------

export async function isPermissionGranted(): Promise<boolean> {
  return false;
}
export async function requestPermission(): Promise<"denied"> {
  return "denied";
}
export function sendNotification(_options: unknown): void {}
export async function pending(): Promise<{ id: number }[]> {
  return [];
}
export async function cancel(_ids: number[]): Promise<void> {}
export const Schedule = {
  at: (date: Date, repeating = false, allowWhileIdle = false) => ({ at: { date, repeating, allowWhileIdle } }),
};
