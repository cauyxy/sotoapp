import { z } from "zod";

export const ClipboardSnapshotKindSchema = z.enum(["empty", "text", "rich"]);
export type ClipboardSnapshotKind = z.infer<typeof ClipboardSnapshotKindSchema>;
