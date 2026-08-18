const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function looksLikeSolanaAddress(input: string): boolean {
  return BASE58_RE.test(input) && input.length >= 32 && input.length <= 44;
}

export function looksLikeTxSignature(input: string): boolean {
  return BASE58_RE.test(input) && input.length >= 64 && input.length <= 128;
}
