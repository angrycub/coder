package coderd

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/codersdk"
)

const portkeyPricingBaseURL = "https://api.portkey.ai/model-configs/pricing"

// @Summary Get model pricing from Portkey
// @ID get-chat-model-pricing
// @Produce json
// @Tags Agents
// @Param provider path string true "Provider identifier"
// @Param model path string true "Model identifier"
// @Success 200 {object} codersdk.PortkeyPricingResponse
// @Router /api/experimental/chats/model-pricing/{provider}/{model} [get]
func (api *API) getChatModelPricing(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if !api.DeploymentValues.AI.Chat.PortkeyPricingEnabled.Value() {
		httpapi.Write(ctx, rw, http.StatusForbidden, codersdk.Response{
			Message: "Portkey pricing lookup is not enabled on this deployment.",
		})
		return
	}

	provider := chi.URLParam(r, "provider")
	model := chi.URLParam(r, "model")

	url := fmt.Sprintf("%s/%s/%s", portkeyPricingBaseURL, provider, model)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}

	client := api.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}

	resp, err := client.Do(req)
	if err != nil {
		httpapi.Write(ctx, rw, http.StatusBadGateway, codersdk.Response{
			Message: "Failed to reach Portkey API.",
			Detail:  err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		httpapi.Write(ctx, rw, http.StatusNotFound, codersdk.Response{
			Message: fmt.Sprintf("No Portkey pricing found for %s/%s.", provider, model),
		})
		return
	}

	if resp.StatusCode != http.StatusOK {
		httpapi.Write(ctx, rw, http.StatusBadGateway, codersdk.Response{
			Message: fmt.Sprintf("Portkey API returned status %d.", resp.StatusCode),
		})
		return
	}

	var pricing codersdk.PortkeyPricingResponse
	if err := json.NewDecoder(resp.Body).Decode(&pricing); err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}

	httpapi.Write(ctx, rw, http.StatusOK, pricing)
}
