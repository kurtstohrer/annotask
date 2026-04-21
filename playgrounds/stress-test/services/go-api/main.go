// Stress-lab Go service — metrics backend for the Svelte streaming MFE.
//
// Deliberately stdlib-only so `go run .` is subsecond. The OpenAPI document
// is embedded via //go:embed and served at /openapi.json so annotask's
// schema scanner picks it up automatically. When routes change, also edit
// openapi.json — no generator is used.
package main

import (
	_ "embed"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
)

//go:embed openapi.json
var openapiSpec []byte

type health struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Port    int    `json:"port"`
	Version string `json:"version"`
}

type metricPoint struct {
	T     string  `json:"t"`
	Value float64 `json:"value"`
}

type metricSeries struct {
	Name   string        `json:"name"`
	Unit   string        `json:"unit"`
	Points []metricPoint `json:"points"`
}

// Mirrors packages/shared-fixtures/index.ts.
var metrics = []metricSeries{
	{
		Name: "requests_per_second", Unit: "rps",
		Points: []metricPoint{
			{T: "2026-04-18T09:00:00Z", Value: 412},
			{T: "2026-04-18T09:05:00Z", Value: 501},
			{T: "2026-04-18T09:10:00Z", Value: 478},
			{T: "2026-04-18T09:15:00Z", Value: 533},
			{T: "2026-04-18T09:20:00Z", Value: 620},
			{T: "2026-04-18T09:25:00Z", Value: 587},
		},
	},
	{
		Name: "p95_latency_ms", Unit: "ms",
		Points: []metricPoint{
			{T: "2026-04-18T09:00:00Z", Value: 82},
			{T: "2026-04-18T09:05:00Z", Value: 91},
			{T: "2026-04-18T09:10:00Z", Value: 87},
			{T: "2026-04-18T09:15:00Z", Value: 103},
			{T: "2026-04-18T09:20:00Z", Value: 118},
			{T: "2026-04-18T09:25:00Z", Value: 95},
		},
	},
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("encode: %v", err)
	}
}

func main() {
	portStr := os.Getenv("PORT")
	if portStr == "" {
		portStr = "4330"
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		log.Fatalf("invalid PORT: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, health{Status: "ok", Service: "go-api", Port: port, Version: "0.0.1"})
	})

	mux.HandleFunc("/api/metrics", func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		if name == "" {
			writeJSON(w, 200, metrics)
			return
		}
		for _, s := range metrics {
			if s.Name == name {
				writeJSON(w, 200, []metricSeries{s})
				return
			}
		}
		writeJSON(w, 404, map[string]string{"error": "not_found", "name": name})
	})

	mux.HandleFunc("/api/metrics/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/api/metrics/")
		for _, s := range metrics {
			if s.Name == name {
				writeJSON(w, 200, s)
				return
			}
		}
		writeJSON(w, 404, map[string]string{"error": "not_found", "name": name})
	})

	mux.HandleFunc("/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write(openapiSpec); err != nil {
			log.Printf("write openapi: %v", err)
		}
	})

	addr := ":" + portStr
	log.Printf("[go-api] listening on http://localhost%s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
