// Pure-TS port of soto_provider::errors. The HTTP transport (undici) is
// implemented in the Electron main process; these types are shared so the
// request/response shaping below can signal failures the same way.

export type ProviderErrorCode =
  | "invalid_configuration"
  | "authentication_failed"
  | "rate_limited"
  | "service_unavailable"
  | "request_failed"
  | "empty_response";

export class ProviderException extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderException";
    this.code = code;
  }
}
