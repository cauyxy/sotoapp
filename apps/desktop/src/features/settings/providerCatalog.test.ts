import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";

import { createCatalogStore } from "./providerCatalog";

describe("provider catalog store", () => {
  it("lazily loads via injected fetcher and caches", async () => {
    const fetcher = vi.fn(async () => ({
      providers: [
        {
          provider_id: "mimo-plan-sea",
          display_name: "Mimo-Plan-SEA",
          default_endpoint: "https://ex",
          default_model: null,
          requires_app_id: false,
          suggested_models: []
        }
      ]
    }));
    const store = createCatalogStore(fetcher);

    await store.ensure();
    await store.ensure();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(get(store.value)?.providers[0].provider_id).toBe("mimo-plan-sea");
  });
});
