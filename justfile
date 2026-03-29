# Annotask development commands

# Install dependencies
install:
    pnpm install

# Build everything (shell + plugin + CLI)
build:
    pnpm build

# Build shell UI only
build-shell:
    pnpm build:shell

# Build plugin + CLI only
build-plugin:
    pnpm build:plugin

# Run unit tests
test:
    pnpm test

# Run unit tests in watch mode
test-watch:
    pnpm test:watch

# Run e2e tests (starts dev server automatically)
test-e2e:
    pnpm test:e2e

# Ensure the Planet Explorer API is running (starts it in background if not)
[private]
ensure-api:
    #!/usr/bin/env bash
    if curl -s http://localhost:8888/api/stats > /dev/null 2>&1; then
        echo "[API] Already running on port 8888"
    else
        echo "[API] Starting Planet Explorer API on port 8888..."
        cd playgrounds/api && nohup uvicorn main:app --port 8888 > /tmp/annotask-api.log 2>&1 &
        for i in {1..10}; do
            if curl -s http://localhost:8888/api/stats > /dev/null 2>&1; then
                echo "[API] Ready"
                break
            fi
            sleep 0.5
        done
    fi

# Start the shared Planet Explorer API (foreground, with reload)
api:
    cd playgrounds/api && uvicorn main:app --reload --port 8888

# Start Vue + Vite playground
vue: ensure-api
    pnpm dev:vue-vite

# Start Vue + Webpack playground
vue-webpack: ensure-api
    pnpm dev:vue-webpack

# Start React + Vite playground
react: ensure-api
    pnpm dev:react-vite

# Start Svelte + Vite playground
svelte: ensure-api
    pnpm dev:svelte-vite

# Start shell UI in standalone dev mode
shell:
    pnpm dev:shell

# Stop the background API if running
stop-api:
    #!/usr/bin/env bash
    pid=$(lsof -ti :8888 2>/dev/null)
    if [ -n "$pid" ]; then
        kill $pid
        echo "[API] Stopped"
    else
        echo "[API] Not running"
    fi

# List all playgrounds
list:
    @echo "Playgrounds:"
    @echo "  just api          — Planet Explorer API  (port 8888, foreground)"
    @echo "  just vue          — Vue + Vite           (port 5173)"
    @echo "  just vue-webpack  — Vue + Webpack        (port 8090)"
    @echo "  just react        — React + Vite         (port 5173)"
    @echo "  just svelte       — Svelte + Vite        (port 5173)"
    @echo "  just stop-api     — Stop background API"
    @echo ""
    @echo "The API auto-starts in the background when you run a playground."
    @echo "Use 'just api' to run it in the foreground with hot reload."
