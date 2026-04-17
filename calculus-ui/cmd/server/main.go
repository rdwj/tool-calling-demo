package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redhat-ai-americas/calculus-ui/static"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	apiURL := os.Getenv("API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:8080"
		slog.Warn("API_URL not set, using default", "url", apiURL)
	}

	backendURL, err := url.Parse(apiURL)
	if err != nil {
		slog.Error("invalid API_URL", "url", apiURL, "error", err)
		os.Exit(1)
	}

	proxy := &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme = backendURL.Scheme
			r.URL.Host = backendURL.Host
			r.Host = backendURL.Host
		},
		FlushInterval: -1, // flush immediately for SSE streaming
	}

	mux := http.NewServeMux()

	// Reverse proxy: browser -> UI server -> backend (no CORS needed)
	mux.Handle("/v1/", proxy)

	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"apiUrl": apiURL})
	})

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	mux.Handle("/", http.FileServer(http.FS(static.Files())))

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 5 * time.Minute, // SSE streams can run long
		IdleTimeout:  60 * time.Second,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("starting server", "port", port, "api_url", apiURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("shutdown failed", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
