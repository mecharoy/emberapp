/** True in the web edition (npm run build:web), false in the Android app.
 *  A build-time constant: the branches it guards are dropped from the other build. */
export const IS_WEB = import.meta.env.VITE_WEB === "1";
