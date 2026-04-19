export interface Product {
  id: number
  name: string
  category: string
  price_cents: number
  image_emoji: string
  in_stock: boolean
  rating: number
  review_count: number
  summary: string
}

export interface Category {
  id: string
  name: string
  icon: string
}

export interface ProductListResponse {
  products: Product[]
  total: number
}

export interface CatalogStats {
  total_products: number
  in_stock: number
  total_reviews: number
  best_seller: string
  highest_rated: string
}
