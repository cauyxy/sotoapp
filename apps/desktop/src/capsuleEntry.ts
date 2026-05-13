// Capsule webview entrypoint. The capsule is a 60px-tall transparent overlay
// that lives in its own Tauri window (label "capsule") and only ever needs to
// render `CapsuleShell.svelte` — it does NOT need settings, the sidebar, or
// any feature page. This entry exists separately from `main.ts` so that the
// capsule bundle ships only its own dependency graph, not the whole app.
//
// Synchronously applies cached theme + locale; the capsule's translated
// strings (`capsule.aria.*` and `capsule.error.*`) and the theme-coloured pill
// pick up settings from localStorage. A locale change that happens while the
// capsule is alive does not propagate back here yet — tracked as a follow-up
// in Decision 40 § Phase C.

import { mount } from "svelte";

import CapsuleShell from "./app/CapsuleShell.svelte";
import { applyCachedChrome } from "./app/bootstrap";
import "./styles.css";

document.body.classList.add("capsule-window");
applyCachedChrome();

const target = document.getElementById("root") as HTMLElement;
mount(CapsuleShell, { target });
