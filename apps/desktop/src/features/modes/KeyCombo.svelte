<script lang="ts">
  type KeyToken = {
    label: string;
    side: "L" | "R" | null;
  };

  const MODIFIER_TOKENS: Record<string, KeyToken> = {
    LeftCtrl: { label: "⌃", side: "L" },
    RightCtrl: { label: "⌃", side: "R" },
    LeftAlt: { label: "⌥", side: "L" },
    RightAlt: { label: "⌥", side: "R" },
    LeftShift: { label: "⇧", side: "L" },
    RightShift: { label: "⇧", side: "R" },
    LeftMeta: { label: "⌘", side: "L" },
    RightMeta: { label: "⌘", side: "R" },
    Fn: { label: "Fn", side: null }
  };

  let { chord }: { chord: string } = $props();
  const token = $derived<KeyToken | null>(chord ? (MODIFIER_TOKENS[chord] ?? { label: chord, side: null }) : null);
</script>

<span class="key-combo">
  {#if token}
    <span class="key-combo-token">
      <span class={`key-cap${token.side ? " key-cap-side" : " key-cap-mod"}`}>
        {#if token.side}<span class="key-cap-side-badge">{token.side}</span>{/if}
        {token.label}
      </span>
    </span>
  {/if}
</span>
