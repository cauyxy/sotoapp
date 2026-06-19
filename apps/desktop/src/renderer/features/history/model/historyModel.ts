// History derivation — thin re-export shim. The pure filter / day-bucket /
// design-group logic now lives in @soto/core (capabilities/history/derive); see
// the native-feel audit's "history-home-date-logic-belongs-in-core" finding.
// This module keeps the page's existing import paths working and binds the one
// renderer-owned input the core layer must not hard-code: the canonical mode-id
// list that seeds the filter chips.

import {
  filterHistoryRecords,
  historyDesignGroups,
  historyFilterChips as coreHistoryFilterChips,
  historyGroupKey,
  historyMatchesFilter,
  type DayBucketLabel,
  type HistoryDesignGroup,
  type HistoryDesignRow,
  type HistoryFilterChip,
  type HistoryRecord,
} from "@soto/core";

import { CANONICAL_MODE_IDS, type CanonicalModeId } from "../../../shared/canonicalModes";

// Re-export the framework-free derivation surface unchanged.
export {
  filterHistoryRecords,
  historyDesignGroups,
  historyGroupKey,
  historyMatchesFilter,
  type DayBucketLabel,
  type HistoryDesignGroup,
  type HistoryDesignRow,
};

// Chip ids are typed against the renderer's canonical mode set.
export type { HistoryFilterChip };

// Bind the renderer-owned canonical mode list into core's generic chip builder
// so the page keeps calling historyFilterChips(records) with a single argument
// and gets back CanonicalModeId-typed chips.
export function historyFilterChips(
  records: HistoryRecord[],
): HistoryFilterChip<CanonicalModeId>[] {
  return coreHistoryFilterChips(records, CANONICAL_MODE_IDS);
}
