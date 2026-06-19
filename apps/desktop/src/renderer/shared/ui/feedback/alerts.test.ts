import { afterEach, describe, expect, it } from "vitest";

import {
  AlertLevel,
  _resetForTesting,
  pushAlert,
  removeAlert,
  visibleAlerts,
} from "./alerts";

describe("visibleAlerts", () => {
  afterEach(() => {
    _resetForTesting();
  });

  it("returns the same snapshot reference until alert state changes", () => {
    const empty = visibleAlerts();
    expect(visibleAlerts()).toBe(empty);

    pushAlert({ id: "a", level: AlertLevel.PERSISTENT, title: "Alpha" });
    const withAlert = visibleAlerts();
    expect(withAlert).not.toBe(empty);
    expect(visibleAlerts()).toBe(withAlert);

    removeAlert("a");
    const emptyAgain = visibleAlerts();
    expect(emptyAgain).not.toBe(withAlert);
    expect(visibleAlerts()).toBe(emptyAgain);
  });
});
