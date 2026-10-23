// Merge into frontend/tailwind.config.ts -> theme.extend
export const fosTheme = {
  colors: {
    navy: { 900: '#081D3C', 700: '#103562', 500: '#1B4B8A' },
    gold: { 400: '#D6BA80', 700: '#71541A' },
    mango: { 500: '#FF7A1A' },
    jade: { 500: '#12B76A' },
    ruby: { 500: '#E5484D' },
    ink: { 900: '#0E1A2B', 500: '#5B6472' },
    line: '#E3E8EF',
    surface: '#F6F8FB',
  },
  fontFamily: {
    sans: ['var(--font-manrope)', 'var(--font-kantumruy)', 'system-ui', 'sans-serif'],
    khmer: ['var(--font-kantumruy)', 'system-ui', 'sans-serif'],
  },
  fontSize: {
    display: ['28px', { lineHeight: '34px', fontWeight: '800', letterSpacing: '-0.03em' }],
    title: ['20px', { lineHeight: '26px', fontWeight: '800' }],
    section: ['17px', { lineHeight: '22px', fontWeight: '700' }],
    body: ['15px', { lineHeight: '22px', fontWeight: '500' }],
    caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
    price: ['18px', { lineHeight: '22px', fontWeight: '800' }],
  },
  borderRadius: { card: '20px', hero: '24px', sheet: '28px', thumb: '16px', cat: '22px' },
  boxShadow: {
    'fos-sm': '0 1px 2px rgba(8,29,60,.06)',
    'fos-md': '0 8px 24px rgba(8,29,60,.08)',
    'fos-lg': '0 24px 60px rgba(8,29,60,.18)',
    'fos-cta': '0 10px 24px rgba(16,53,98,.35)',
  },
  backgroundImage: {
    'grad-hero': 'linear-gradient(135deg,#081D3C 0%,#103562 55%,#1B4B8A 100%)',
    'grad-gold': 'linear-gradient(120deg,#F3E3B8,#D6BA80 50%,#B8964E)',
    'grad-promo': 'linear-gradient(135deg,#FF7A1A,#FFB547)',
    'grad-cta': 'linear-gradient(135deg,#103562,#1B4B8A)',
  },
  spacing: { gutter: '16px', section: '24px' },
}
