import { useEffect, useState } from 'react'
import { MantineProvider } from '@mantine/core'
import { getTheme, onThemeChange, type StressTheme } from '@annotask/stress-ui-tokens'
import { App } from './App'

export function Root() {
  const [theme, setTheme] = useState<StressTheme>(getTheme())
  useEffect(() => onThemeChange(setTheme), [])

  return (
    <MantineProvider forceColorScheme={theme}>
      <App />
    </MantineProvider>
  )
}
