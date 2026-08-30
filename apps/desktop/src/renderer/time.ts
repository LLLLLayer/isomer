/** Compact relative time for cards and comments (i18n-keyed). */
export function relTime(
  epochOrIso: number | string,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const then = typeof epochOrIso === 'number' ? epochOrIso * 1000 : Date.parse(epochOrIso)
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return t('time.now')
  if (mins < 60) return t('time.minutes', { count: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('time.hours', { count: hours })
  return t('time.days', { count: Math.round(hours / 24) })
}
