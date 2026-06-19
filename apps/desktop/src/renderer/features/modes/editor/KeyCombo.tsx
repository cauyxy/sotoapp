import { rendererOs } from "../../../ipc";
import { keyTokenForSegment, type Os } from "./modifierDisplay";

export function KeyCombo({
  chord,
  size,
}: {
  chord: string;
  size?: "lg";
}): JSX.Element {
  const segments = chord ? chord.split("+") : [];
  const os: Os = rendererOs();
  const lg = size === "lg";
  return (
    <span className={`key-combo${lg ? " key-combo-lg" : ""}`} aria-hidden="true">
      {segments.map((segment, index) => {
        const token = keyTokenForSegment(segment, os);
        return (
          <span className="key-combo-token" key={`${segment}-${index}`}>
            {index > 0 ? <span className="key-combo-plus">+</span> : null}
            <span className={`key-cap${lg ? " key-cap-lg" : ""}`}>
              {token.side ? <span className="key-cap-lead">{token.side}</span> : null}
              {token.label}
            </span>
          </span>
        );
      })}
    </span>
  );
}
