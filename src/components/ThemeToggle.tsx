import { setTheme, useThemePref, type ThemePref } from '../lib/theme'
import { cx } from '../lib/util'

const OPTIONS: { value: ThemePref; label: string; icon: JSX.Element }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3.1" />
        <g strokeLinecap="round">
          <path d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3" />
        </g>
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.6" y="2.6" width="12.8" height="8.6" rx="1.4" />
        <path d="M5.6 13.8h4.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z" strokeLinejoin="round" />
      </svg>
    ),
  },
]

/** Three-way theme control: light, follow the OS, or dark. */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const pref = useThemePref()
  const index = OPTIONS.findIndex(o => o.value === pref)

  return (
    <div
      className={cx('theme-toggle', compact && 'compact')}
      role="radiogroup"
      aria-label="Colour theme"
      style={{ '--slot': index } as React.CSSProperties}
    >
      <span className="theme-thumb" aria-hidden="true" />
      {OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={pref === option.value}
          aria-label={option.label}
          title={`${option.label} theme`}
          className={cx('theme-option', pref === option.value && 'on')}
          onClick={() => setTheme(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  )
}
