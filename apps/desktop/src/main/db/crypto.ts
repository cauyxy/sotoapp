import { safeStorage } from "electron";
import type { CryptoPort } from "./store.js";

// Real CryptoPort backed by Electron safeStorage (macOS Keychain / Windows
// DPAPI). Ciphertext is stored base64 in provider_secrets.api_key; plaintext
// only ever exists in the main process (plan §4/§5). If the OS keychain is
// unavailable, encryption is unsafe — we fail closed rather than silently
// persisting plaintext.
export function createSafeStorageCrypto(): CryptoPort {
  return {
    encrypt(plain: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("safeStorage encryption is unavailable on this platform");
      }
      return safeStorage.encryptString(plain).toString("base64");
    },
    decrypt(cipher: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("safeStorage encryption is unavailable on this platform");
      }
      return safeStorage.decryptString(Buffer.from(cipher, "base64"));
    },
  };
}
