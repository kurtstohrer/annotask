import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import type { Health, Workflow, WorkflowStatus } from '@annotask/stress-contracts'
import { workflows as seedWorkflows } from '@annotask/stress-fixtures'

const API_BASE = 'http://localhost:4310'

const statusColor: Record<WorkflowStatus, string> = {
  pending: 'yellow',
  in_progress: 'blue',
  review: 'violet',
  accepted: 'green',
  denied: 'red',
}

const NEXT_STATUS: Record<WorkflowStatus, WorkflowStatus | null> = {
  pending: 'in_progress',
  in_progress: 'review',
  review: 'accepted',
  accepted: null,
  denied: null,
}

const STATUS_FILTERS: Array<WorkflowStatus | 'all'> = [
  'all', 'pending', 'in_progress', 'review', 'accepted', 'denied',
]

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [workflows, setWorkflows] = useState<Workflow[]>(seedWorkflows)
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all')
  const [transitioning, setTransitioning] = useState<string | null>(null)
  const [lastTransition, setLastTransition] = useState<string | null>(null)

  const fetchWorkflows = useCallback(async (status: WorkflowStatus | 'all') => {
    const url = new URL(`${API_BASE}/api/workflows`)
    if (status !== 'all') url.searchParams.set('status', status)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as Workflow[]
      if (Array.isArray(body)) setWorkflows(body)
    } catch {
      // keep seed data when Java is down
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setHealthError(null)
    try {
      const res = await fetch(`${API_BASE}/api/health`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setHealth((await res.json()) as Health)
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
    await fetchWorkflows(statusFilter)
  }, [fetchWorkflows, statusFilter])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilter = async (next: WorkflowStatus | 'all') => {
    setStatusFilter(next)
    await fetchWorkflows(next)
  }

  const advance = async (wf: Workflow) => {
    const next = NEXT_STATUS[wf.status]
    if (!next) return
    setTransitioning(wf.id)
    try {
      const res = await fetch(
        `${API_BASE}/api/workflows/${wf.id}/transitions?to=${next}`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { transition_id?: string; status?: WorkflowStatus }
      setLastTransition(
        `${wf.id} → ${body.status ?? next} (${(body.transition_id ?? '').slice(0, 8)})`,
      )
      await fetchWorkflows(statusFilter)
    } catch (err) {
      setLastTransition(`${wf.id} transition failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      setTransitioning(null)
    }
  }

  return (
    <Box
      style={{
        minHeight: '100%',
        padding: '32px 40px',
        background: 'var(--stress-bg)',
        color: 'var(--stress-text)',
      }}
    >
      <Container size="lg" p={0}>
        <Stack gap="lg">
          <Box>
            <Title order={1} size="h2">React Workflows</Title>
            <Text c="dimmed" size="sm">
              MFE <code>react-workflows</code> · port 4210 · backed by Java on :4310 · Mantine UI
            </Text>
          </Box>

          <Card withBorder radius="md" padding="lg">
            <Title order={2} size="h4" mb="xs">What this stresses</Title>
            <Text component="ul" m={0} pl="md">
              <li>Dense React CRUD with Mantine component discovery</li>
              <li>Status filter hits Java <code>/api/workflows?status=</code></li>
              <li>Row actions POST to <code>/api/workflows/{'{id}'}/transitions?to=</code></li>
              <li>Tasks created here land under <code>mfe: react-workflows</code></li>
            </Text>
          </Card>

          <Card withBorder radius="md" padding="lg">
            <Group justify="space-between" mb="sm">
              <Title order={2} size="h4">Upstream health</Title>
              <Button size="xs" variant="light" onClick={load} loading={loading}>Refresh</Button>
            </Group>
            {healthError && (
              <Alert color="red" variant="light" title="Java service unreachable" mb="sm">
                <code>{healthError}</code> — start with <code>just java</code>.
              </Alert>
            )}
            {health && (
              <Table withTableBorder highlightOnHover>
                <Table.Tbody>
                  <Table.Tr><Table.Td>status</Table.Td><Table.Td><Badge color="green" variant="light">{health.status}</Badge></Table.Td></Table.Tr>
                  <Table.Tr><Table.Td>service</Table.Td><Table.Td><code>{health.service}</code></Table.Td></Table.Tr>
                  <Table.Tr><Table.Td>port</Table.Td><Table.Td><code>{health.port}</code></Table.Td></Table.Tr>
                  <Table.Tr><Table.Td>version</Table.Td><Table.Td><code>{health.version}</code></Table.Td></Table.Tr>
                </Table.Tbody>
              </Table>
            )}
          </Card>

          <Card withBorder radius="md" padding="lg">
            <Group justify="space-between" mb="sm">
              <Title order={2} size="h4">Workflow queue</Title>
              <Button.Group>
                {STATUS_FILTERS.map((s) => (
                  <Button
                    key={s}
                    size="xs"
                    variant={statusFilter === s ? 'filled' : 'default'}
                    onClick={() => applyFilter(s)}
                  >
                    {s}
                  </Button>
                ))}
              </Button.Group>
            </Group>
            {lastTransition && (
              <Alert color="blue" variant="light" mb="sm">
                <code>{lastTransition}</code>
              </Alert>
            )}
            <Table withTableBorder striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Title</Table.Th>
                  <Table.Th>Owner</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {workflows.map((wf) => {
                  const next = NEXT_STATUS[wf.status]
                  return (
                    <Table.Tr key={wf.id}>
                      <Table.Td><code>{wf.id}</code></Table.Td>
                      <Table.Td>{wf.title}</Table.Td>
                      <Table.Td>{wf.owner ?? '—'}</Table.Td>
                      <Table.Td>
                        <Badge color={statusColor[wf.status] ?? 'gray'} variant="light">{wf.status}</Badge>
                      </Table.Td>
                      <Table.Td>
                        {next ? (
                          <Button
                            size="xs"
                            variant="light"
                            loading={transitioning === wf.id}
                            onClick={() => advance(wf)}
                          >
                            → {next}
                          </Button>
                        ) : (
                          <Text c="dimmed" size="xs">—</Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Card>
        </Stack>
      </Container>
    </Box>
  )
}
