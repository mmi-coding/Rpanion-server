// Ambient shims for `ntrip-client` (a GitHub fork, no published types) and its
// internal sub-paths used by server/ntrip.js. Loose by design for the gradual
// migration phase.
declare module 'ntrip-client' {
  // The fork exports an EventEmitter-like client; keep it permissive for now.
  export class NtripClient {
    constructor(options?: unknown);
    [key: string]: unknown;
  }
}

declare module 'ntrip-client/lib/nmea/ecef' {
  export function geoToEcef(...args: unknown[]): unknown;
}
