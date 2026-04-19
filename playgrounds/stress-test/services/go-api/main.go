package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
)

type health struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Port    int    `json:"port"`
	Version string `json:"version"`
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
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		resp := health{Status: "ok", Service: "go-api", Port: port, Version: "0.0.1"}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Printf("encode: %v", err)
		}
	})

	addr := ":" + portStr
	log.Printf("[go-api] listening on http://localhost%s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
