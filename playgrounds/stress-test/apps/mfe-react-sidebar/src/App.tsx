import { useEffect, useState, type ComponentType } from 'react'
import {
  Badge,
  Box,
  Flex,
  Heading,
  IconButton,
  Separator,
  Text,
  Theme,
} from '@radix-ui/themes'
import {
  ActivityLogIcon,
  ComponentInstanceIcon,
  CubeIcon,
  DashboardIcon,
  LayersIcon,
  LightningBoltIcon,
  MoonIcon,
  RocketIcon,
  SunIcon,
} from '@radix-ui/react-icons'
import {
  applyTheme,
  getTheme,
  onThemeChange,
  type StressTheme,
} from '@annotask/stress-ui-tokens'

type IconType = ComponentType<{ className?: string; style?: React.CSSProperties }>

interface NavItem {
  hash: string
  label: string
  stack: string
  icon: IconType
  accent: string
}

const NAV: NavItem[] = [
  { hash: '#/',       label: 'Overview',       stack: 'host shell',        icon: DashboardIcon,          accent: '#5a8dff' },
  { hash: '#/vue',    label: 'Vue · Data Lab',       stack: 'Vue · Naive UI',     icon: CubeIcon,               accent: '#41b883' },
  { hash: '#/react',  label: 'React · Workflows',    stack: 'React · Mantine',    icon: LayersIcon,             accent: '#61dafb' },
  { hash: '#/svelte', label: 'Svelte · Streaming',   stack: 'Svelte · bits-ui',   icon: LightningBoltIcon,      accent: '#ff6a3d' },
  { hash: '#/solid',  label: 'Solid · Components',   stack: 'Solid · Kobalte',    icon: ComponentInstanceIcon,  accent: '#2c7bd0' },
  { hash: '#/htmx',   label: 'htmx · Partials',      stack: 'htmx · Pico.css',    icon: RocketIcon,             accent: '#b964d3' },
  { hash: '#/vue/health', label: 'Services Health',  stack: 'All 5 backends',     icon: ActivityLogIcon,        accent: '#5ad0a7' },
]

function useHash() {
  const [hash, setHash] = useState<string>(
    typeof window === 'undefined' ? '#/' : window.location.hash || '#/',
  )
  useEffect(() => {
    const fn = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
  }, [])
  return hash
}

function useStressTheme(): [StressTheme, (t: StressTheme) => void] {
  const [theme, setTheme] = useState<StressTheme>(getTheme())
  useEffect(() => onThemeChange(setTheme), [])
  return [
    theme,
    (next) => {
      applyTheme(next)
      setTheme(next)
    },
  ]
}

export function App() {
  const hash = useHash()
  const [theme, setTheme] = useStressTheme()
  const isDark = theme === 'dark'

  return (
    <Theme
      appearance={isDark ? 'dark' : 'light'}
      accentColor="blue"
      grayColor="slate"
      radius="medium"
      scaling="95%"
      hasBackground={false}
      style={{ height: '100%' }}
    >
      <Flex
        direction="column"
        style={{
          height: '100%',
          color: 'var(--stress-sidebar-text)',
          background: 'var(--stress-surface)',
          padding: '20px 14px',
          gap: 16,
        }}
      >
        <Flex align="center" gap="2" px="2">
          <Box
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background:
                'linear-gradient(135deg, var(--stress-sidebar-accent), #8c5cff)',
              boxShadow: '0 4px 12px rgba(90, 141, 255, 0.35)',
            }}
          />
          <Box>
            <Heading
              as="h1"
              size="3"
              weight="bold"
              style={{ color: 'var(--stress-sidebar-text)', lineHeight: 1 }}
            >
              Annotask
            </Heading>
            <Text
              size="1"
              style={{ color: 'var(--stress-sidebar-text-muted)' }}
            >
              Stress Lab
            </Text>
          </Box>
        </Flex>

        <Separator
          size="4"
          style={{
            background: 'var(--stress-sidebar-border)',
            margin: '4px 0',
          }}
        />

        <Text
          size="1"
          weight="bold"
          style={{
            color: 'var(--stress-sidebar-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            padding: '0 8px',
          }}
        >
          MFEs
        </Text>

        <Flex direction="column" gap="1" style={{ flex: 1, minHeight: 0 }}>
          {(() => {
            const activeHash = NAV
              .map((n) => n.hash)
              .filter((h) => hash === h || (h !== '#/' && hash.startsWith(h + '/')))
              .sort((a, b) => b.length - a.length)[0]
            return NAV.map((item) => {
            const active = item.hash === activeHash
            const Icon = item.icon
            return (
              <a
                key={item.hash}
                href={item.hash}
                className={active ? 'nav-link active' : 'nav-link'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: active
                    ? 'var(--stress-sidebar-text)'
                    : 'var(--stress-sidebar-text-muted)',
                  background: active
                    ? 'var(--stress-sidebar-surface-2)'
                    : 'transparent',
                  border: '1px solid',
                  borderColor: active
                    ? 'var(--stress-sidebar-border)'
                    : 'transparent',
                  transition: 'background 120ms ease, color 120ms ease',
                }}
              >
                <Box
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: active
                      ? item.accent
                      : 'var(--stress-sidebar-surface)',
                    color: active ? '#0b1220' : item.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 auto',
                  }}
                >
                  <Icon style={{ width: 14, height: 14 }} />
                </Box>
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Text size="2" weight={active ? 'bold' : 'medium'} as="div">
                    {item.label}
                  </Text>
                  <Text
                    size="1"
                    as="div"
                    style={{ color: 'var(--stress-sidebar-text-muted)' }}
                  >
                    {item.stack}
                  </Text>
                </Box>
              </a>
            )
            })
          })()}
        </Flex>

        <Separator
          size="4"
          style={{ background: 'var(--stress-sidebar-border)' }}
        />

        <Flex align="center" justify="between" px="2">
          <Flex direction="column" gap="1">
            <Text
              size="1"
              style={{ color: 'var(--stress-sidebar-text-muted)' }}
            >
              Theme
            </Text>
            <Badge
              variant="soft"
              color={isDark ? 'indigo' : 'amber'}
              radius="full"
            >
              {isDark ? 'Dark' : 'Light'}
            </Badge>
          </Flex>
          <IconButton
            aria-label="Toggle theme"
            variant="soft"
            size="3"
            radius="full"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            style={{
              background: 'var(--stress-sidebar-surface-2)',
              color: 'var(--stress-sidebar-text)',
              cursor: 'pointer',
            }}
          >
            {isDark ? (
              <SunIcon style={{ width: 18, height: 18 }} />
            ) : (
              <MoonIcon style={{ width: 18, height: 18 }} />
            )}
          </IconButton>
        </Flex>
      </Flex>
    </Theme>
  )
}
