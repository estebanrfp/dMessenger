import { defineConfig, presetUno, presetIcons } from 'unocss'
import transformerDirectives from '@unocss/transformer-directives'

// One vocabulary for surfaces (page / card / field / raised), text (ink / dim /
// faint), one accent, the ok-warn-danger-violet set and the trust ramp for
// roles. Every value is a CSS variable in app.css, as an RGB triplet so
// utilities can carry an alpha (`bg-accent/20`).
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({ scale: 1.15, extraProperties: { display: 'inline-block', 'vertical-align': 'middle' } }),
  ],
  transformers: [transformerDirectives()],
  // Class names live in plain .js here, which the default pipeline does not scan.
  content: { pipeline: { include: [/\.(js|html)($|\?)/] } },
  // Role badges build their classes from the role name at runtime, out of the scanner's sight.
  safelist: ['guest', 'user', 'manager', 'admin', 'superadmin'].flatMap(role => [`bg-role-${role}/20`, `text-role-${role}`]),
  theme: {
    colors: {
      page: rgb('bg-page'),
      card: rgb('bg-card'),
      field: rgb('bg-field'),
      raised: rgb('bg-raised'),
      ink: rgb('text-ink'),
      dim: rgb('text-dim'),
      faint: rgb('text-faint'),
      'on-accent': rgb('text-on-accent'),
      accent: { DEFAULT: rgb('accent'), hover: rgb('accent-hover') },
      ok: rgb('ok'),
      warn: rgb('warn'),
      danger: rgb('danger'),
      violet: rgb('violet'),
      line: rgb('border-line'),
      strong: rgb('border-strong'),
      role: {
        guest: rgb('role-guest'),
        user: rgb('role-user'),
        manager: rgb('role-manager'),
        admin: rgb('role-admin'),
        superadmin: rgb('role-superadmin'),
      },
    },
    borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' },
    boxShadow: { card: 'var(--shadow)' },
    fontFamily: { sans: 'var(--font)', mono: 'var(--mono)' },
  },
  shortcuts: {
    // Four weights, one vocabulary: primary, secondary, ghost, danger — all pills.
    btn: 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium cursor-pointer border border-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-primary': 'btn bg-accent hover:bg-accent-hover text-on-accent',
    'btn-secondary': 'btn bg-field hover:bg-raised border-line text-ink',
    'btn-ghost': 'btn bg-card hover:bg-field border-line text-dim hover:text-ink',
    'btn-danger': 'btn bg-danger hover:opacity-90 text-on-accent',
    'field': 'w-full px-4 py-2 rounded-full bg-field b-1 b-solid b-line focus:b-accent outline-none text-ink placeholder:text-faint',
    'icon-btn': 'w-9 h-9 rounded-full flex items-center justify-center text-dim hover:text-ink hover:bg-field transition-colors',
    chrome: 'h-14 px-4 flex items-center gap-3 border-b border-line flex-shrink-0',
  },
})
