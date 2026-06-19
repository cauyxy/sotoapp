// Microphone panel — React port of features/settings/MicrophoneSettings.svelte.
// Lists input devices + persists the chosen default device. Initial settings +
// device list come from the AppModel (no mount-time getAppSettings /
// listMicrophoneDevices); the device change persists via a resource mutation
// that refreshes the model (plan §4.11).

import { mutateAppSettings, useAppModel, useAppResources } from "../../../store/appResources";
import { toast } from "../../../shared/ui/feedback/toast";
import { Select, type SelectOption } from "../../../shared/ui/primitives/Select";
import { useT } from "../../../i18n/context";
import { SettingRow } from "./SettingRow";

export function MicrophonePanel(): JSX.Element {
  const t = useT();
  const model = useAppModel();
  const resources = useAppResources();
  const settings = model?.settings ?? null;
  const devices = model?.microphones ?? [];
  const deviceOptions: SelectOption[] = [
    { value: "", label: t("settings.microphone.systemDefault") },
    ...devices.map((device) => ({
      value: device.id,
      label: `${device.label}${device.is_default ? t("settings.microphone.defaultSuffix") : ""}`,
    })),
  ];

  async function changeDevice(nextDeviceId: string | null): Promise<void> {
    try {
      await mutateAppSettings(resources, { microphone_device_id: nextDeviceId });
    } catch (error) {
      console.error("settings/microphone: failed to save", error);
      toast(t("settings.microphone.saveFailed"));
    }
  }

  return (
    <>
      {settings ? (
        <SettingRow
          icon="microphone"
          label={t("settings.microphone.inputDevice")}
          desc={t("settings.microphone.inputDeviceDesc")}
        >
          <Select
            id="mic-device"
            value={settings.microphone_device_id ?? ""}
            options={deviceOptions}
            aria-label={t("settings.microphone.inputDevice")}
            onChange={(value) => void changeDevice(value.trim() || null)}
          />
        </SettingRow>
      ) : null}
    </>
  );
}
