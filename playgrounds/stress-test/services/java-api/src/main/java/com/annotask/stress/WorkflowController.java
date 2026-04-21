package com.annotask.stress;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/workflows")
@CrossOrigin(origins = "*")
public class WorkflowController {

  private final ConcurrentHashMap<String, Map<String, Object>> store = seed();

  private static ConcurrentHashMap<String, Map<String, Object>> seed() {
    ConcurrentHashMap<String, Map<String, Object>> m = new ConcurrentHashMap<>();
    for (int i = 1; i <= 8; i++) {
      String id = "wf-" + i;
      m.put(id, Map.of(
        "id", id,
        "title", "Workflow " + i,
        "status", i % 3 == 0 ? "review" : i % 3 == 1 ? "pending" : "in_progress",
        "created_at", Instant.now().minusSeconds(3600L * i).toString()
      ));
    }
    return m;
  }

  @GetMapping
  public List<Map<String, Object>> list(@RequestParam(required = false) String status) {
    return store.values().stream()
      .filter(w -> status == null || status.equals(w.get("status")))
      .toList();
  }

  @GetMapping("/{id}")
  public ResponseEntity<Map<String, Object>> get(@PathVariable String id) {
    Map<String, Object> wf = store.get(id);
    return wf == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(wf);
  }

  @PostMapping("/{id}/transitions")
  public Map<String, Object> transition(@PathVariable String id, @RequestParam String to) {
    Map<String, Object> wf = store.get(id);
    if (wf == null) {
      return Map.of("error", "not_found", "id", id);
    }
    Map<String, Object> updated = Map.of(
      "id", id,
      "title", wf.get("title"),
      "status", to,
      "created_at", wf.get("created_at"),
      "transition_id", UUID.randomUUID().toString(),
      "transitioned_at", Instant.now().toString()
    );
    store.put(id, updated);
    return updated;
  }
}
