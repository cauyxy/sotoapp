<script lang="ts">
  import { onMount } from "svelte";

  import {
    applyMicrophoneSettingsDraft,
    createMicrophoneSettingsDraft,
    getAppSettings,
    listMicrophoneDevices,
    saveAppSettings,
    type AppSettings,
    type MicrophoneDevice,
    type MicrophoneSettingsDraft
  } from "../../ipc/settings";
  import { t } from "../../i18n";
  import { toast } from "../../shared/ui/toast";

  let settings = $state<AppSettings | null>(null);
  let draft = $state<MicrophoneSettingsDraft | null>(null);
  let devices = $state<MicrophoneDevice[]>([]);

  async function refreshMicrophoneSettings() {
    try {
      const [nextSettings, nextDevices] = await Promise.all([getAppSettings(), listMicrophoneDevices()]);
      settings = nextSettings;
      draft = createMicrophoneSettingsDraft(nextSettings);
      devices = nextDevices;
    } catch (error) {
      console.error("settings/microphone: failed to load", error);
    }
  }

  onMount(() => {
    void refreshMicrophoneSettings();
  });

  async function changeDevice(nextDeviceId: string | null) {
    if (!settings || !draft) return;
    const nextDraft: MicrophoneSettingsDraft = { ...draft, microphone_device_id: nextDeviceId };
    draft = nextDraft;
    try {
      const saved = await saveAppSettings(applyMicrophoneSettingsDraft(settings, nextDraft));
      settings = saved;
      draft = createMicrophoneSettingsDraft(saved);
    } catch (error) {
      console.error("settings/microphone: failed to save", error);
      toast($t("settings.microphone.saveFailed"));
    }
  }
</script>

<div class="group">
  {#if draft}
    <div class="setting-row">
      <span class="setting-row-label">{$t("settings.microphone.inputDevice")}</span>
      <select
        value={draft.microphone_device_id ?? ""}
        onchange={(event) => void changeDevice((event.currentTarget as HTMLSelectElement).value.trim() || null)}
      >
        <option value="">{$t("settings.microphone.systemDefault")}</option>
        {#each devices as device (device.id)}
          <option value={device.id}>
            {device.name}{device.is_default ? $t("settings.microphone.defaultSuffix") : ""}
          </option>
        {/each}
      </select>
    </div>
  {/if}
</div>
