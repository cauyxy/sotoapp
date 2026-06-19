import { describe, expect, it } from "vitest";
import { muteWriteSucceeded } from "./koffiAbi.js";

// The native soto_*_audio_set_output_muted contract: 0 = ok, -1 = error. The old
// wrappers discarded this entirely, so a failed device mute (WASAPI/CoreAudio COM
// error) was invisible. This maps it to a success boolean the upper layers log on.
describe("muteWriteSucceeded", () => {
  it("treats native 0 as success", () => {
    expect(muteWriteSucceeded(0)).toBe(true);
  });

  it("treats native -1 (error) as failure", () => {
    expect(muteWriteSucceeded(-1)).toBe(false);
  });

  it("treats any other non-zero result as failure (fail closed)", () => {
    expect(muteWriteSucceeded(1)).toBe(false);
    expect(muteWriteSucceeded(-99)).toBe(false);
  });
});
