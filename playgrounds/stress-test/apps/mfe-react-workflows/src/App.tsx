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

const statusColor: Record<WorkflowStatus, string> = {
  pending: 'yellow',
  in_progress: 'blue',
  review: 'violet',
  accepted: 'green',
  denied: 'red',
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [workflows, setWorkflows] = useState<Workflow[]>(seedWorkflows)

  const load = useCallback(async () => {
    setLoading(true)
    setHealthError(null)
    try {
      // Absolute URL — works both solo (:4210 → :4310) and single-spa (:4200 → :4310).
      const API_BASE = 'http://localhost:4310'
      const res = await fetch(`${API_BASE}/api/health`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setHealth((await res.json()) as Health)
      const wfRes = await fetch(`${API_BASE}/api/workflows`)
      if (wfRes.ok) {
        const body = (await wfRes.json()) as Workflow[]
        if (Array.isArray(body) && body.length > 0) setWorkflows(body)
      }
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Container size="md" py="xl">
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
            <li>Workflow status transitions and review queues</li>
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
          <Title order={2} size="h4" mb="sm">Workflow queue</Title>
          <Table withTableBorder striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Title</Table.Th>
                <Table.Th>Owner</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {workflows.map((wf) => (
                <Table.Tr key={wf.id}>
                  <Table.Td><code>{wf.id}</code></Table.Td>
                  <Table.Td>{wf.title}</Table.Td>
                  <Table.Td>{wf.owner ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={statusColor[wf.status] ?? 'gray'} variant="light">{wf.status}</Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  )
}
