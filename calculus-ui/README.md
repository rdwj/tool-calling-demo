# calculus-ui

A minimal chat UI that connects to any OpenAI-compatible API endpoint (vLLM, an AI agent, a gateway, etc.). Ships as a single Go binary with embedded static files -- no Node.js, no build step, no framework dependencies.

<!-- TODO: Add screenshot -->

## Quick Start

```bash
# Build and run (defaults to http://localhost:8080 as the API backend)
make build
API_URL=http://localhost:8080 ./bin/server

# Or just:
make run
```

Then open http://localhost:3000.

## Configuration

Set these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://localhost:8080` | OpenAI-compatible chat completions endpoint |
| `PORT` | `3000` | Server listen port |

The frontend discovers the API endpoint at runtime via `GET /api/config`, so the same binary works against any backend without rebuilding.

## Deployment

Build the container and deploy to OpenShift:

```bash
make image-build
make deploy PROJECT=my-project
```

See `chart/values.yaml` for Helm configuration, including `config.API_URL` to point at your backend service.
