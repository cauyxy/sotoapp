<script lang="ts">
  import appIconUrl from "../../../src-tauri/icons/icon.png";

  let { size = 34 }: { size?: number } = $props();
</script>

<span class="soto-mark" style="width: {size}px; height: {size}px;" aria-hidden="true">
  <img src={appIconUrl} alt="" width={size} height={size} />
</span>
