/** Uniform command result shape, isomorphic with ism's error report. */
export interface AppError {
  code: string
  message: string
  hint?: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export const ok = <T>(data: T): Result<T> => ({ ok: true, data })
export const err = <T>(error: AppError): Result<T> => ({ ok: false, error })
