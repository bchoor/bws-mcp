export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

export class AccessTokenParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessTokenParseError";
  }
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function base64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function hkdfExpandSha256(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const hashLen = 32;
  const n = Math.ceil(length / hashLen);
  const okm = new Uint8Array(n * hashLen);
  let previous = new Uint8Array(0);
  for (let i = 1; i <= n; i++) {
    const input = new Uint8Array(previous.length + info.length + 1);
    input.set(previous, 0);
    input.set(info, previous.length);
    input[previous.length + info.length] = i;
    previous = new Uint8Array(await hmacSha256(prk, input));
    okm.set(previous, (i - 1) * hashLen);
  }
  return okm.slice(0, length);
}

async function deriveShareableKey(secret: Uint8Array, name: string, info: string): Promise<Uint8Array> {
  const prk = await hmacSha256(new TextEncoder().encode(`bitwarden-${name}`), secret);
  return hkdfExpandSha256(prk, new TextEncoder().encode(info), 64);
}

function splitCompositeKey(composite: Uint8Array): { encKey: Uint8Array; macKey: Uint8Array } {
  if (composite.length !== 64) {
    throw new CryptoError("Expected a 64-byte AES-HMAC key");
  }
  return { encKey: composite.slice(0, 32), macKey: composite.slice(32, 64) };
}

export async function parseAccessToken(token: string): Promise<{
  accessTokenId: string;
  clientSecret: string;
  encryptionKey: Uint8Array;
}> {
  const colon = token.split(":");
  if (colon.length !== 2) {
    throw new AccessTokenParseError("Access token is malformed");
  }
  const [firstPart, keyB64] = colon;
  if (firstPart == null || keyB64 == null) {
    throw new AccessTokenParseError("Access token is malformed");
  }
  const parts = firstPart.split(".");
  if (parts.length !== 3 || parts[0] !== "0") {
    throw new AccessTokenParseError("Access token is malformed");
  }
  const accessTokenId = parts[1];
  const clientSecret = parts[2];
  if (accessTokenId == null || clientSecret == null || accessTokenId === "" || clientSecret === "") {
    throw new AccessTokenParseError("Access token is malformed");
  }
  const rawKey = base64ToBytes(keyB64);
  if (rawKey.length !== 16) {
    throw new AccessTokenParseError("Access token is malformed");
  }
  const encryptionKey = await deriveShareableKey(rawKey, "accesstoken", "sm-access-token");
  return { accessTokenId, clientSecret, encryptionKey };
}

function parseEncStringType2(value: string): { iv: Uint8Array; data: Uint8Array; mac: Uint8Array } | null {
  const dot = value.indexOf(".");
  if (dot < 0) {
    return null;
  }
  const encType = value.slice(0, dot);
  const rest = value.slice(dot + 1);
  if (encType !== "2") {
    return null;
  }
  const parts = rest.split("|");
  if (parts.length !== 3 || parts[0] == null || parts[1] == null || parts[2] == null) {
    return null;
  }
  return {
    iv: base64ToBytes(parts[0]),
    data: base64ToBytes(parts[1]),
    mac: base64ToBytes(parts[2]),
  };
}

export function looksLikeEncString(value: string): boolean {
  return /^\d+\./.test(value);
}

async function decryptType2(value: string, compositeKey: Uint8Array): Promise<Uint8Array> {
  const parsed = parseEncStringType2(value);
  if (parsed == null) {
    throw new CryptoError("Unsupported EncString");
  }
  const { encKey, macKey } = splitCompositeKey(compositeKey);
  const macData = new Uint8Array(parsed.iv.length + parsed.data.length);
  macData.set(parsed.iv, 0);
  macData.set(parsed.data, parsed.iv.length);
  const computed = await hmacSha256(macKey, macData);
  if (!timingSafeEqual(computed, parsed.mac)) {
    throw new CryptoError("MAC check failed");
  }
  const cryptoKey = await crypto.subtle.importKey("raw", encKey, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: parsed.iv }, cryptoKey, parsed.data);
  return new Uint8Array(plain);
}

export async function decryptUtf8(encString: string, compositeKey: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await decryptType2(encString, compositeKey));
}

export async function decryptMaybeUtf8(value: string, compositeKey: Uint8Array): Promise<string> {
  if (!looksLikeEncString(value)) {
    return value;
  }
  return decryptUtf8(value, compositeKey);
}
