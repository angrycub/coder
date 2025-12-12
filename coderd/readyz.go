package coderd

import (
	"context"
	"net/http"
	"time"
)

// readyz returns 200 OK if the server is ready to serve traffic.
// It checks database connectivity and entitlement errors that would
// prevent the server from functioning correctly (e.g., multiple
// replicas without a high availability license).
//
// This endpoint is designed for use with Kubernetes readiness probes
// or load balancer health checks. Unlike /healthz (liveness), this
// endpoint checks if the server can actually serve traffic correctly.
//
// @Summary Readiness check
// @ID readyz
// @Produce text/plain
// @Tags General
// @Success 200 {string} string "OK"
// @Failure 503 {string} string "Error message"
// @Router /readyz [get]
func (api *API) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Check database connectivity
	if _, err := api.Database.Ping(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("database ping failed"))
		return
	}

	// Check for entitlement errors that would prevent correct operation.
	// This includes errors like "multiple replicas without HA license"
	// which would cause intermittent failures for users.
	if api.Entitlements.HasErrors() {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("entitlement error"))
		return
	}

	_, _ = w.Write([]byte("OK"))
}
