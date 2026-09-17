/**
 * Result type for expected failures across Hydra package boundaries.
 *
 * Expected failures are values, not exceptions. Only true programmer errors
 * or unreachable infrastructure crashes should throw.
 */
export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T, E = never>(value: T): Result<T, E> => ({
  ok: true,
  value,
});

export const err = <T = never, E = string>(error: E): Result<T, E> => ({
  ok: false,
  error,
});

export const isOk = <T, E>(result: Result<T, E>): result is Extract<Result<T, E>, { ok: true }> =>
  result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Extract<Result<T, E>, { ok: false }> =>
  !result.ok;

export const mapResult = <T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => (result.ok ? ok(fn(result.value)) : result);

export const mapErr = <T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> => (result.ok ? result : err(fn(result.error)));
