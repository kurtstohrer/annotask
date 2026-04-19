package com.annotask.stress;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.CrossOrigin;

@SpringBootApplication
@CrossOrigin(origins = "*")
public class StressJavaApiApplication {
  public static void main(String[] args) {
    SpringApplication.run(StressJavaApiApplication.class, args);
  }
}
