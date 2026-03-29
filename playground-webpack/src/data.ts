export interface Continent {
  name: string
  area: number        // million km²
  population: number  // billions
  countries: number
  highestPoint: string
  highestElevation: string
  description: string
  color: string
}

export interface Ocean {
  name: string
  area: number        // million km²
  avgDepth: number    // meters
  maxDepth: number    // meters
  deepestPoint: string
  description: string
  color: string
}

export const continents: Continent[] = [
  { name: 'Asia', area: 44.58, population: 4.75, countries: 49, highestPoint: 'Mount Everest', highestElevation: '8,849 m', description: 'The largest and most populous continent, spanning from the Ural Mountains to the Pacific Ocean. Home to ancient civilizations, diverse ecosystems, and the highest mountain range on Earth.', color: '#e11d48' },
  { name: 'Africa', area: 30.37, population: 1.46, countries: 54, highestPoint: 'Mount Kilimanjaro', highestElevation: '5,895 m', description: 'The second-largest continent, straddling the equator. Known for vast savannas, dense rainforests, the Sahara Desert, and the cradle of human evolution.', color: '#f59e0b' },
  { name: 'North America', area: 24.71, population: 0.58, countries: 23, highestPoint: 'Denali', highestElevation: '6,190 m', description: 'Stretching from the Arctic to the tropics. Features the Great Plains, Rocky Mountains, Great Lakes, and a diverse range of climates and biomes.', color: '#10b981' },
  { name: 'South America', area: 17.84, population: 0.43, countries: 12, highestPoint: 'Aconcagua', highestElevation: '6,961 m', description: 'Home to the Amazon rainforest, Andes mountains, and the driest desert on Earth. Rich in biodiversity with unique wildlife found nowhere else.', color: '#06b6d4' },
  { name: 'Antarctica', area: 14.2, population: 0, countries: 0, highestPoint: 'Vinson Massif', highestElevation: '4,892 m', description: 'The coldest, driest, and windiest continent. Covered by an ice sheet containing 70% of Earth\'s fresh water. No permanent residents, only research stations.', color: '#94a3b8' },
  { name: 'Europe', area: 10.18, population: 0.75, countries: 44, highestPoint: 'Mount Elbrus', highestElevation: '5,642 m', description: 'The second-smallest continent by area but densely populated. Birthplace of Western civilization, the Renaissance, and the Industrial Revolution.', color: '#8b5cf6' },
  { name: 'Australia/Oceania', area: 8.53, population: 0.046, countries: 14, highestPoint: 'Puncak Jaya', highestElevation: '4,884 m', description: 'The smallest continental landmass, surrounded by the Pacific and Indian Oceans. Features unique marsupial wildlife, coral reefs, and thousands of Pacific islands.', color: '#ec4899' },
]

export const oceans: Ocean[] = [
  { name: 'Pacific Ocean', area: 168.72, avgDepth: 4280, maxDepth: 10994, deepestPoint: 'Mariana Trench', description: 'The largest and deepest ocean, covering more area than all land combined. Contains the Ring of Fire, thousands of islands, and the deepest point on Earth.', color: '#1e40af' },
  { name: 'Atlantic Ocean', area: 85.13, avgDepth: 3646, maxDepth: 8376, deepestPoint: 'Puerto Rico Trench', description: 'The second-largest ocean, separating the Americas from Europe and Africa. Features the Mid-Atlantic Ridge, the longest mountain range on Earth.', color: '#0369a1' },
  { name: 'Indian Ocean', area: 70.56, avgDepth: 3741, maxDepth: 7450, deepestPoint: 'Sunda Trench', description: 'The third-largest ocean, bounded by Asia, Africa, and Australia. Known for monsoon wind patterns and warm tropical waters.', color: '#0d9488' },
  { name: 'Southern Ocean', area: 21.96, avgDepth: 3270, maxDepth: 7236, deepestPoint: 'South Sandwich Trench', description: 'The newest officially recognized ocean, encircling Antarctica. Drives global ocean circulation through the Antarctic Circumpolar Current.', color: '#6366f1' },
  { name: 'Arctic Ocean', area: 15.56, avgDepth: 1205, maxDepth: 5450, deepestPoint: 'Molloy Deep', description: 'The smallest and shallowest ocean, largely covered by sea ice. Critical to global climate regulation and home to polar bears, walruses, and narwhals.', color: '#0ea5e9' },
]
