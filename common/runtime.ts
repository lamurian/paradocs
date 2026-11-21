/**
 * Runtime detection helpers.
 *
 * Determines whether the current process is a read-only worker (for example
 * a pi-workflow unit or contract guard) that must never create or mutate the
 * knowledge base index.
 */

/** Shape of the environment used by {@link isReadOnlyProcess}. */
export interface ReadOnlyEnv {
  [key: string]: string | undefined;
}

/**
 * Check whether the current process must be treated as read-only.
 *
 * A process is read-only when `PARADOCS_READONLY` is `"1"`, or when either
 * `PI_UNIT_FILE` or `PI_CONTRACT_GUARD_FILE` is set to a non-empty value.
 *
 * @param env - Environment object to inspect. Defaults to `process.env`.
 * @returns True when the process must not write the knowledge base.
 */
export function isReadOnlyProcess(env: ReadOnlyEnv = process.env): boolean {
  if (env.PARADOCS_READONLY === "1") return true;
  if (env.PI_UNIT_FILE) return true;
  if (env.PI_CONTRACT_GUARD_FILE) return true;
  return false;
}
