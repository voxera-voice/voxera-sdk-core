/**
 * Socket payload encryption using AES-256-GCM via Web Crypto API.
 *
 * Wire format: base64( IV[12] || ciphertext || authTag[16] )
 * Encrypted socket payload: { _e: 1, d: "<base64 string>" }
 */

const IV_LENGTH = 12;
const ALGORITHM = 'AES-GCM';

export class SocketCrypto {
  private key: CryptoKey | null = null;
  private readonly rawKey: Uint8Array;

  constructor(base64Key: string) {
    const binary = atob(base64Key);
    this.rawKey = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      this.rawKey[i] = binary.charCodeAt(i);
    }
  }

  private async getKey(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = await crypto.subtle.importKey(
        'raw',
        this.rawKey.buffer as ArrayBuffer,
        { name: ALGORITHM },
        false,
        ['encrypt', 'decrypt'],
      );
    }
    return this.key;
  }

  /**
   * Encrypt a payload object.
   * Returns a base64 string containing IV + ciphertext + authTag.
   */
  async encrypt(data: any): Promise<string> {
    const key = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(JSON.stringify(data));

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      encoded,
    );

    // Combine IV + ciphertext (GCM appends the 16-byte tag automatically)
    const combined = new Uint8Array(IV_LENGTH + cipherBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuffer), IV_LENGTH);

    return uint8ToBase64(combined);
  }

  /**
   * Decrypt a base64-encoded payload back to an object.
   * Returns null on failure (e.g. tampered data, wrong key).
   */
  async decrypt(encoded: string): Promise<any | null> {
    try {
      const key = await this.getKey();
      const combined = base64ToUint8(encoded);

      const iv = combined.slice(0, IV_LENGTH);
      const ciphertext = combined.slice(IV_LENGTH);

      const plainBuffer = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        ciphertext,
      );

      const json = new TextDecoder().decode(plainBuffer);
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
}

/** Check whether a socket payload is encrypted */
export function isEncryptedPayload(data: any): data is { _e: 1; d: string } {
  return data && typeof data === 'object' && data._e === 1 && typeof data.d === 'string';
}

// ─── Base64 helpers (browser-safe, no Node Buffer dependency) ───────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
