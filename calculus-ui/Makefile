PROJECT     ?= calculus-ui
IMAGE_NAME  ?= calculus-ui
IMAGE_TAG   ?= latest
PORT        ?= 3000

.PHONY: build run test lint image-build deploy clean help

build: ## Build the UI server binary
	go build -o bin/server ./cmd/server

run: ## Run locally
	API_URL=$${API_URL:-http://localhost:8080} go run ./cmd/server

test: ## Run tests
	go test ./... -v

lint: ## Run go vet
	go vet ./...

image-build: ## Build container image
	podman build --platform linux/amd64 -t $(IMAGE_NAME):$(IMAGE_TAG) -f Containerfile . --no-cache

deploy: ## Deploy to OpenShift
	helm upgrade --install $(PROJECT) chart/ -n $(PROJECT) --wait

clean: ## Remove build artifacts
	rm -rf bin/

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
