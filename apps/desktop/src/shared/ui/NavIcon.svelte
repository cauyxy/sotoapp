<script lang="ts">
  import type { NavItem } from "../nav";

  let { name }: { name: NavItem } = $props();
</script>

{#if name === "Home"}
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3.5 11 L12 4 L20.5 11 V20 a1 1 0 0 1 -1 1 H4.5 a1 1 0 0 1 -1 -1 Z" />
    <path d="M10 21 V14 h4 v7" />
  </svg>
{:else if name === "History"}
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5 V12 L15 14" />
    <path d="M3.5 6.5 L6 8" stroke-width="1.4" />
  </svg>
{:else if name === "Dictionary"}
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 4 H17 a2 2 0 0 1 2 2 V20 H7 a2 2 0 0 1 -2 -2 Z" />
    <path d="M5 18 a2 2 0 0 1 2 -2 H19" />
    <path d="M10.5 12 L12 8.5 L13.5 12" />
    <path d="M11 11 H13" />
  </svg>
{:else if name === "Modes"}
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5.5 18.5 L17 7" />
    <path d="M14.5 4.5 L19.5 9.5" />
    <path d="M4 7 L5 5 L7 4 L5 3.5 L4 1.5 L3 3.5 L1 4 L3 5 Z" transform="translate(2 1)" stroke-width="1.3" />
    <path d="M4 7 L5 5 L7 4 L5 3.5 L4 1.5 L3 3.5 L1 4 L3 5 Z" transform="translate(14 12) scale(0.7)" stroke-width="1.3" />
  </svg>
{:else if name === "Settings"}
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
{/if}
