// Ambient shim for the internal `ntrip-decoder/lib/config` path used by
// server/ntrip.js (only the UNKOWN_HEADER_ERROR constant is consumed).
declare module 'ntrip-decoder/lib/config' {
  export const UNKOWN_HEADER_ERROR: unknown;
}
