import ReactDOM from "react-dom/client";
import App from "./App";
// Bundled with the app, not fetched: Ember makes no network calls of its own.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/caveat/wght.css";
import "./index.css";

// No StrictMode: its doubled effects in development push and pop the history
// entries useBackButton keeps for the edge-swipe back gesture, which closes
// pages in dev that stay open in the real app.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
