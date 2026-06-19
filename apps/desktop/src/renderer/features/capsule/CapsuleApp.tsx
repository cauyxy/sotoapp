import { useEffect, useRef, useState, type CSSProperties } from "react";

import { CapsuleMeter } from "./CapsuleMeter";
import { CapsulePanel } from "./CapsulePanel";
import {
  MODE_INTRO_VISIBLE_MS,
  barStateFor,
  modeIdentityFor,
  shouldShowIntro,
} from "./capsuleMeterModel";
import { useCaptureDriver } from "./useCaptureDriver";
import "./capsule.css";

// Transparent always-on-top recording capsule (plan §1e / §5). It composes two
// extracted pieces (audit §3.2 step 13 / `capsule-capture-driver-vs-view`):
//
//  - useCaptureDriver — the Web-Audio capture-driver lifecycle (begin/finish/
//    cancel, idempotent + stale-session guards, the ~30 Hz level throttle) plus
//    the pure capsuleReducer fed by `soto://voice-runtime` events. It resolves
//    the capsule bridge (window.soto) itself.
//  - <CapsuleMeter> — the pure equalizer presentation (idle dot / wave /
//    thinking / error), driven entirely by props.
//
// This component just projects the driver's state onto the meter's props. It
// lives in its own module (separate from the capsule.tsx entrypoint) so that
// entry stays a side-effect-only file and Fast Refresh can track the component
// (react-doctor/only-export-components) — mirrors app/App.tsx vs main.tsx.
export function CapsuleApp(): JSX.Element {
  const {
    state,
    localLevelRef,
    panel,
    panelExiting,
    dismissPanel,
    noticeAction,
    setCapsuleInteractive,
    overlay,
  } = useCaptureDriver();

  // Only `state` (phase) and `panel` re-render this component now. The live mic
  // level no longer participates in render at all: it lives in localLevelRef and
  // is projected onto the meter's wave via rAF + a CSS variable inside
  // <CapsuleMeter>, so a level frame triggers zero React renders.
  const barState = barStateFor(state.phase, state.result);
  const identity = modeIdentityFor(state.modeId, state.modeName);

  const [introActive, setIntroActive] = useState(false);
  const lastIntroRef = useRef<{ modeId: string; at: number } | null>(null);
  useEffect(() => {
    if (state.phase !== "listening") return;
    if (!shouldShowIntro(identity, lastIntroRef.current, Date.now())) return;
    lastIntroRef.current = { modeId: identity.modeId, at: Date.now() };
    setIntroActive(true);
    const t = setTimeout(() => setIntroActive(false), MODE_INTRO_VISIBLE_MS);
    return () => {
      clearTimeout(t);
      // The phase moved on (e.g. a fast release into thinking) before the
      // timer fired: without this reset introActive stays true forever — a
      // 178px pill with an invisible (label-out has `forwards`) label, i.e.
      // the reported stuck empty placeholder.
      setIntroActive(false);
    };
    // identity is derived from state; keying on phase+modeId is sufficient.
  }, [state.phase, state.modeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Panel (notifications) stacks ABOVE the pill; the capsule itself renders
  // only its core lifecycle face. The window is a transparent click-through
  // overlay (pill anchored at the bottom), so an absent panel leaves the pill
  // exactly where it was. The Panel's "知道了" button uses onHoverChange to make
  // the overlay momentarily clickable.
  return (
    <div
      key={overlay.showSeq}
      className="capsule-stack"
      data-entering={overlay.showSeq > 0 ? "true" : undefined}
      data-exit={overlay.exit?.variant}
      data-departing={overlay.departing ? "true" : undefined}
      style={
        overlay.exit
          ? ({ "--capsule-exit-ms": `${overlay.exit.durationMs}ms` } as CSSProperties)
          : undefined
      }
    >
      <CapsulePanel
        notice={panel.notice}
        exiting={panelExiting}
        onDismiss={dismissPanel}
        onPrimaryAction={noticeAction}
        onHoverChange={setCapsuleInteractive}
      />
      <CapsuleMeter
        barState={barState}
        localLevelRef={localLevelRef}
        identity={identity}
        introActive={introActive}
      />
    </div>
  );
}
