import { z } from "zod";
import { ScreenPointDipSchema, ScreenRectDipSchema } from "./geometry.js";

export const TransformTextAnchorSchema = z.object({
  source: z.enum(["caret", "selection", "focused_element", "window", "mouse", "bottom_center"]),
  rect: ScreenRectDipSchema.nullable(),
  point: ScreenPointDipSchema.nullable(),
});
export type TransformTextAnchor = z.infer<typeof TransformTextAnchorSchema>;

export const NativeTextAnchorProbeSchema = z.object({
  status: z.enum(["available", "not_found", "permission_denied", "unsupported", "error"]),
  anchor: TransformTextAnchorSchema.nullable(),
  detail: z.string().nullable().default(null),
});
export type NativeTextAnchorProbe = z.infer<typeof NativeTextAnchorProbeSchema>;
