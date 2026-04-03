import { useState, useEffect } from 'react'
import { Table, Heading, Text, Badge, Flex, Card, Spinner } from '@radix-ui/themes'
import LoadingOrbit from '../components/LoadingOrbit'

interface Planet {
  id: number
  name: string
  type: string
  radius_km: number
  gravity_ms2: number
  avg_temp_c: number
  moons: number
  distance_from_sun_mkm: number
  orbital_period_days: number
  discovered_by: string
  description: string
  color: string
}

function getTypeColor(type: string): 'green' | 'purple' | 'blue' | 'orange' | 'gray' {
  switch (type) {
    case 'Terrestrial': return 'green'
    case 'Gas Giant': return 'purple'
    case 'Ice Giant': return 'blue'
    case 'Dwarf': return 'orange'
    default: return 'gray'
  }
}

function formatDistance(mkm: number): string {
  if (mkm >= 1000) return `${(mkm / 1000).toFixed(1)}B km`
  return `${mkm.toFixed(1)}M km`
}

function PlanetsPage() {
  const [planets, setPlanets] = useState<Planet[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/planets')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch planets (${res.status})`)
        return res.json()
      })
      .then((data) => {
        setPlanets(data.planets)
        setTotal(data.total)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div>
        <Heading size="6" mb="4">Planets</Heading>
        <Flex align="center" gap="2">
          <Spinner />
          <Text color="gray">Loading planets...</Text>
        </Flex>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Heading size="6" mb="4">Planets</Heading>
        <Card>
          <Text color="red">Error: {error}</Text>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <Heading size="6" mb="2">Planets</Heading>
      <Text color="gray" size="2" mb="5" as="p">{total} planets in the solar system</Text>

      <Table.Root variant="surface">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Distance</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Radius</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Moons</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Gravity</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {planets.map((planet) => (
            <Table.Row key={planet.id}>
              <Table.Cell>
                <Flex align="center" gap="2">
                  <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: planet.color, flexShrink: 0 }} />
                  <Text weight="medium">{planet.name}</Text>
                </Flex>
              </Table.Cell>
              <Table.Cell>
                <Badge color={getTypeColor(planet.type)} variant="soft">{planet.type}</Badge>
              </Table.Cell>
              <Table.Cell>{formatDistance(planet.distance_from_sun_mkm)}</Table.Cell>
              <Table.Cell>{planet.radius_km.toLocaleString()} km</Table.Cell>
              <Table.Cell>{planet.moons}</Table.Cell>
              <Table.Cell>{planet.gravity_ms2} m/s²</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </div>
  )
}

export default PlanetsPage
