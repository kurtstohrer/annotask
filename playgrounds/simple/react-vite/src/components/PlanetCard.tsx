export interface Planet {
  id: string
  name: string
  type: string
  moons: number
  distance_from_sun_mkm: number
  color?: string
}

interface PlanetCardProps {
  planet: Planet
  active?: boolean
}

// Mirrors vue-vite's PlanetCard: a real project component with a bound prop
// (`planet`), a literal-friendly prop (`active`), and loop rendering on the
// /planets page — the M2 design-tool acceptance surface for React.
export default function PlanetCard({ planet, active }: PlanetCardProps) {
  return (
    <button
      className={`planet-card${active ? ' active' : ''}`}
      style={{ ['--planet-color' as string]: planet.color ?? '#8888ff' }}
    >
      <span className="orb" style={{ background: planet.color ?? '#8888ff' }} />
      <span className="body">
        <span className="name">{planet.name}</span>
        <span className="type">{planet.type}</span>
      </span>
      <span className="meta">
        <span className="moons">{planet.moons} moons</span>
        <span className="distance">{planet.distance_from_sun_mkm} mkm</span>
      </span>
    </button>
  )
}
