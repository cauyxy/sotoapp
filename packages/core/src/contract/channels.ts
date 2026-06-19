import { z } from "zod";

export const VOICE_RUNTIME_EVENT = "soto://voice-runtime";
export const HOTKEY_RUNTIME_ACTION_EVENT = "soto://hotkey-runtime-action";
export const HOTKEY_CAPTURE_BEGIN_CHANNEL = "soto://hotkey-capture/begin";
export const HOTKEY_CAPTURE_END_CHANNEL = "soto://hotkey-capture/end";
export const HOTKEY_CAPTURE_KEY_EVENT = "soto://hotkey-capture/key";
export const PERMISSION_UPDATED_EVENT = "permission://updated";
export const ALERT_SHOW_EVENT = "alert:show";

// main -> renderer capture control. The SessionController owns the recording
// FSM in main; the renderer owns the microphone graph. This channel is how the
// controller tells the renderer to begin/finish/cancel capture for a session.
// The renderer then reports back over the capture_* IPC commands. `session_id`
// correlates a begin with its later push_capture_audio / report_capture_error.
//
//   begin  : spin up MicCapture (streams levels), await the WAV
//   finish : stop the mic + push the encoded WAV (the hotkey toggle's stop -
//            converges with the capsule check button on the same finishCapture path)
//   cancel : discard the capture + tear the mic down (the close button / escape)
export const CAPTURE_CONTROL_EVENT = "soto://capture-control";

export const CaptureControlEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("begin"),
    session_id: z.string(),
    mode_id: z.string(),
    /** Mic device to use, or null for the system default. */
    device_id: z.string().nullable(),
  }),
  z.object({ kind: z.literal("finish"), session_id: z.string() }),
  z.object({ kind: z.literal("cancel"), session_id: z.string() }),
]);
export type CaptureControlEvent = z.infer<typeof CaptureControlEventSchema>;
