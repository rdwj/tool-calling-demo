# CLAUDE.md

## Project Overview

A minimal, self-contained chat UI that connects to any OpenAI-compatible API endpoint. The Go server embeds static files into a single binary and serves them alongside a config endpoint that tells the frontend where the API lives.

## Build and Run

```bash
# Build binary
make build

# Run locally (connects to localhost:8080 by default)
make run

# Run with custom API endpoint
API_URL=https://my-agent.apps.cluster.example.com make run
```

## Architecture

The project has two layers:

**Go server** (`cmd/server/main.go`) -- a ~70-line HTTP server that:
- Embeds static files via Go's `embed` package (through `static/embed.go`)
- Serves `GET /api/config` returning the API_URL as JSON
- Serves `GET /healthz` for container probes
- Handles graceful shutdown on SIGTERM

**Static frontend** (`static/`) -- vanilla HTML/CSS/JS, no build step:
- Fetches `/api/config` on load to discover the backend
- Sends messages to `${apiUrl}/v1/chat/completions` with `stream: true`
- Parses SSE responses for typewriter streaming effect
- Maintains conversation history in memory

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://localhost:8080` | OpenAI-compatible API endpoint |
| `PORT` | `3000` | Server listen port |

## Deployment to OpenShift

```bash
# Build container
make image-build

# Push to registry (adjust for your registry)
podman tag calculus-ui:latest registry.example.com/my-project/calculus-ui:latest
podman push registry.example.com/my-project/calculus-ui:latest

# Deploy via Helm
helm upgrade --install my-ui chart/ -n my-project \
  --set image.repository=registry.example.com/my-project/calculus-ui \
  --set config.API_URL=http://my-agent:8080

# Or use the Makefile shortcut
make deploy PROJECT=my-project
```

## How the UI Discovers the API

The frontend never hardcodes an API URL. On page load, `app.js` calls `GET /api/config`, which returns `{"apiUrl": "..."}` sourced from the `API_URL` environment variable. This keeps the static files truly static -- the same HTML/CSS/JS works against any backend. The API URL is configured at deploy time via the ConfigMap.

## Sentinel Strings

This is a template repository. During scaffolding, `"calculus-ui"` is replaced with the actual project name. Sentinel occurrences:
- `index.html` title and header
- `go.mod` module path
- `Chart.yaml` name
- `Containerfile` label
- `Makefile` PROJECT/IMAGE_NAME defaults
- `chart/values.yaml` image repository
- `chart/templates/_helpers.tpl` template names

## Testing

```bash
make lint    # go vet
make test    # go test (currently no test files)
```
