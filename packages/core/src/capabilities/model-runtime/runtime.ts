import type { ModelInput, ModelOutput } from "../model-input/modelInput.js";

export interface ModelRuntimeOptions {
  timeoutMs?: number;
}

export interface ModelRuntime {
  respond(input: ModelInput, options?: ModelRuntimeOptions): Promise<ModelOutput>;
}
