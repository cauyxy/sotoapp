import { z } from "zod";

export const ScreenRectDipSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ScreenRectDip = z.infer<typeof ScreenRectDipSchema>;

export const ScreenPointDipSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type ScreenPointDip = z.infer<typeof ScreenPointDipSchema>;
