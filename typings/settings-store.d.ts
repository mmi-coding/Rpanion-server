// Ambient shim for `settings-store` (no bundled or @types typings on npm).
// Covers the surface the backend + tests use: value/setValue/clear/init.
// Highest-leverage shim in the migration — ~15 modules read settings here.
declare module 'settings-store' {
  /** Read a setting, returning `defaultValue` when the key is absent. */
  export function value<T = unknown>(key: string, defaultValue?: T): T;
  /** Persist a setting. */
  export function setValue(key: string, value: unknown): void;
  /** Clear the in-memory store (used by tests). */
  export function clear(): void;
  /** Initialise the store. */
  export function init(options?: unknown): void;
}
