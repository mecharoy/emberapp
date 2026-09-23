import ReactDOM from "react-dom/client";
import App from "./App";
// Bundled with the app, never fetched: Elytra makes no network calls of its own.
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource-variable/epilogue/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource-variable/caveat/wght.css";
import "./index.css";
import { startTheme } from "./theme";

// Before the first render, so nothing ever paints in the wrong theme.
void startTheme();

// No StrictMode: its doubled effects in development push and pop the history
// entries useBackButton keeps for Android's back gesture, which closes pages
// in dev that stay open in the real app.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
