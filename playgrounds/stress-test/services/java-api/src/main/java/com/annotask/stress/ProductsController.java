package com.annotask.stress;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/products")
@CrossOrigin(origins = "*")
public class ProductsController {

  // Mirrors packages/shared-fixtures/index.ts. Springdoc picks the return
  // types up automatically and publishes them in /v3/api-docs.
  private final ConcurrentHashMap<String, Map<String, Object>> store = seed();

  private static ConcurrentHashMap<String, Map<String, Object>> seed() {
    ConcurrentHashMap<String, Map<String, Object>> m = new ConcurrentHashMap<>();
    m.put("p-1", Map.of("id", "p-1", "name", "Field telemetry node", "category", "hardware", "price_cents", 29900,  "in_stock", true));
    m.put("p-2", Map.of("id", "p-2", "name", "Edge relay gateway",   "category", "hardware", "price_cents", 59900,  "in_stock", false));
    m.put("p-3", Map.of("id", "p-3", "name", "Observability plan",   "category", "software", "price_cents", 19900,  "in_stock", true));
    m.put("p-4", Map.of("id", "p-4", "name", "Fleet support (yr)",   "category", "service",  "price_cents", 120000, "in_stock", true));
    return m;
  }

  @GetMapping
  public List<Map<String, Object>> list(
      @RequestParam(required = false) String category,
      @RequestParam(required = false) Boolean in_stock) {
    return store.values().stream()
      .filter(p -> category == null || category.equals(p.get("category")))
      .filter(p -> in_stock == null || in_stock.equals(p.get("in_stock")))
      .toList();
  }

  @GetMapping("/{id}")
  public ResponseEntity<Map<String, Object>> get(@PathVariable String id) {
    Map<String, Object> product = store.get(id);
    return product == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(product);
  }
}
