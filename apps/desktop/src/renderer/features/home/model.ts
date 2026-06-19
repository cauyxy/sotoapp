// Home-page stats derivation lives in @soto/core (capabilities/stats/
// overview.ts), where it is unit-tested as pure logic. This thin re-export
// keeps the existing `./model` import path working for HomePage. The status
// row consumes today's calendar-day overview; the weekly stats grid + the
// recentTranscripts mapper were retired with the home redesign (spec §4).
export { type HomeStatRecord, type TodayOverview, todayOverview } from "@soto/core";
