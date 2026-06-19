import type { AppSettings } from "@soto/core";

export type TextScale = AppSettings["base_text_scale"];

const MULTIPLIERS: Record<TextScale, number> = {
  small: 1,
  default: 1.15,
  large: 1.28,
};

export function textScaleMultiplier(scale: TextScale): number {
  return MULTIPLIERS[scale];
}
