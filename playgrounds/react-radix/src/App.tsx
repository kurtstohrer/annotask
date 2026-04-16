import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
  Progress,
  Select,
  Separator,
  Slider,
  Switch,
  Table,
  Text,
  TextField,
  Badge,
  Callout,
} from '@radix-ui/themes'

const products = [
  { id: 1, name: 'Zeus', status: 'active', price: '$29' },
  { id: 2, name: 'Hermes', status: 'paused', price: '$49' },
  { id: 3, name: 'Atlas', status: 'active', price: '$99' },
]

export default function App() {
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [notify, setNotify] = useState(true)
  const [tone, setTone] = useState<string>('soft')
  const [volume, setVolume] = useState<number[]>([40])

  return (
    <Box p="6" style={{ maxWidth: 960, margin: '0 auto' }}>
      <Flex direction="column" gap="4" mb="5">
        <Heading as="h1" size="7">Annotask × Radix Themes</Heading>
        <Text color="gray">Test-bed for the barrel-export component scanner (Strategy 2).</Text>
      </Flex>

      <Flex direction="column" gap="4">
        <Card>
          <Heading as="h2" size="4" mb="3">Form controls</Heading>
          <Grid columns={{ initial: '1', sm: '2' }} gap="4">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" color="gray">Name</Text>
              <TextField.Root placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" color="gray">Button tone</Text>
              <Select.Root value={tone} onValueChange={setTone}>
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value="solid">Solid</Select.Item>
                  <Select.Item value="soft">Soft</Select.Item>
                  <Select.Item value="surface">Surface</Select.Item>
                  <Select.Item value="outline">Outline</Select.Item>
                  <Select.Item value="ghost">Ghost</Select.Item>
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex gap="2" align="center">
              <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} />
              <Text size="2">I agree to the terms</Text>
            </Flex>
            <Flex gap="2" align="center">
              <Switch checked={notify} onCheckedChange={setNotify} />
              <Text size="2">Email me on updates</Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: '1 / -1' }}>
              <Text as="label" size="2" color="gray">Volume — {volume[0]}</Text>
              <Slider value={volume} onValueChange={setVolume} min={0} max={100} />
            </Flex>
          </Grid>
          <Separator size="4" my="4" />
          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray">Cancel</Button>
            <Button variant={tone as 'solid'}>Submit</Button>
          </Flex>
        </Card>

        <Card>
          <Heading as="h2" size="4" mb="3">Status indicators</Heading>
          <Flex gap="3" align="center" wrap="wrap">
            <Badge color="iris">Primary</Badge>
            <Badge color="green">Success</Badge>
            <Badge color="amber">Warn</Badge>
            <Badge color="red">Danger</Badge>
            <Box style={{ flex: 1, minWidth: 200 }}>
              <Progress value={volume[0]} />
            </Box>
          </Flex>
          <Callout.Root mt="3">
            <Callout.Text>
              This playground exercises the barrel-exported Radix Themes API — a single
              <code> @radix-ui/themes </code> package with many re-exported components.
            </Callout.Text>
          </Callout.Root>
        </Card>

        <Card>
          <Heading as="h2" size="4" mb="3">Table</Heading>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Price</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {products.map((p) => (
                <Table.Row key={p.id}>
                  <Table.RowHeaderCell>{p.id}</Table.RowHeaderCell>
                  <Table.Cell>{p.name}</Table.Cell>
                  <Table.Cell>
                    <Badge color={p.status === 'active' ? 'green' : 'amber'}>{p.status}</Badge>
                  </Table.Cell>
                  <Table.Cell>{p.price}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card>
      </Flex>
    </Box>
  )
}
