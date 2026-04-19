package com.annotask.stress;

import java.util.Map;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@CrossOrigin(origins = "*")
public class HealthController {
  @GetMapping("/api/health")
  public Map<String, Object> health() {
    return Map.of(
      "status", "ok",
      "service", "java-api",
      "port", 4310,
      "version", "0.0.1"
    );
  }
}
