/**
 * MFA utilities — TOTP (RFC 6238) and Base32 (RFC 4648).
 *
 * Implemented using the Web Crypto API (no external package) to mirror the
 * server-side eatthepath/java-otp algorithm:
 *   - Algorithm: HMAC-SHA1
 *   - Time step: 30 seconds
 *   - Code length: 6 digits
 *   - Time tolerance: ±1 step (current, previous, next window)
 *
 * Secret format: 20 random bytes, Base32-encoded → 32-character string.
 */

// ── Base32 ─────────────────────────────────────────────────────────────────

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode arbitrary bytes as a Base32 string (RFC 4648, no padding). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decode a Base32 string (RFC 4648, case-insensitive, ignores padding) to bytes. */
export function base32Decode(input: string): Uint8Array {
  const str = input.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of str) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue; // skip invalid chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// ── Secret generation ──────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret: 20 random bytes → 32-char Base32 string.
 * Mirrors Java's MfaSecretSetupDialog.generateSecret() which uses
 * KeyGenerator("HmacSHA1", 160 bits = 20 bytes).
 */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

// ── TOTP ───────────────────────────────────────────────────────────────────

/** Build the 8-byte big-endian counter buffer for a given time step. */
function counterBuffer(step: number): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // JavaScript bitwise ops are 32-bit, split into two 32-bit halves.
  view.setUint32(0, Math.floor(step / 0x100000000), false);
  view.setUint32(4, step >>> 0, false);
  return buf;
}

/** Generate a 6-digit TOTP code for the given Base32 secret and time. */
async function generateTotp(secret: string, atMs: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  const keyBuffer = new Uint8Array(keyBytes).buffer as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const step = Math.floor(atMs / 1000 / 30);
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, counterBuffer(step));
  const hmac = new Uint8Array(mac);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return String(code).padStart(6, "0");
}

/**
 * Verify a 6-digit TOTP code against a Base32 secret.
 * Checks the current window and ±1 step to tolerate clock skew.
 * Mirrors Java's MfaAuthController.verifyOtp() and MfaSecretSetupDialog.verifyOtp().
 */
export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const now = Date.now();
  const step = 30_000; // 30 seconds in ms
  const windows = [now - step, now, now + step];
  for (const t of windows) {
    if ((await generateTotp(secret, t)) === code) return true;
  }
  return false;
}

// ── QR code URI ─────────────────────────────────────────────────────────────

/**
 * Build the otpauth URI for use in a QR code.
 * Format: otpauth://totp/{issuer}:{username}?secret={secret}&issuer={issuer}
 */
export function buildOtpAuthUri(username: string, secret: string, issuer = "BridgeLink"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({ secret, issuer });
  return `otpauth://totp/${label}?${params.toString()}`;
}
