// Main-window entrypoint. The capsule webview has its own entry
// (`src/capsuleEntry.ts` + `capsule.html`) so this file no longer branches on
// `window.location.hash` and the main-window bundle does not need to ship the
// capsule's code.

import { mount } from "svelte";

import App from "./app/App.svelte";
import { applyCachedChrome, startMainWindowBootstrap } from "./app/bootstrap";
import "./styles.css";

applyCachedChrome();
startMainWindowBootstrap();

const target = document.getElementById("root") as HTMLElement;
mount(App, { target });
