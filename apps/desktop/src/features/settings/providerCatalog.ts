import { writable, type Readable } from "svelte/store";

import { listSupportedProviders, type ProviderCatalog } from "../../ipc/providers";

export interface CatalogStore {
  value: Readable<ProviderCatalog | null>;
  ensure(): Promise<void>;
}

export function createCatalogStore(
  fetcher: () => Promise<ProviderCatalog> = listSupportedProviders
): CatalogStore {
  const value = writable<ProviderCatalog | null>(null);
  let promise: Promise<void> | null = null;

  function ensure(): Promise<void> {
    if (promise) return promise;

    promise = fetcher()
      .then((catalog) => value.set(catalog))
      .catch((error) => {
        console.error("settings/engine: catalog load failed", error);
        promise = null;
        throw error;
      });

    return promise;
  }

  return { value: { subscribe: value.subscribe }, ensure };
}

export const catalogStore = createCatalogStore();
