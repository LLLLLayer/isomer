export type ThemePreference = 'system' | 'light' | 'dark'
export type Language = 'en' | 'zh-CN'

export interface Settings {
  theme: ThemePreference
  language: Language
  /** Command template the terminal pre-fills to summon a coding agent. */
  agentCommand: string
  /** Explicit ism binary path; empty = resolve from PATH. */
  ismPath: string
  /** Preferred diff presentation, remembered across selections. */
  diffLayout: 'split' | 'unified'
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'en',
  agentCommand: 'claude',
  ismPath: '',
  diffLayout: 'split',
}
