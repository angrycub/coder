package coderd

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"

	"github.com/go-chi/chi/v5"

	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/util/ptr"
	"github.com/coder/coder/v2/codersdk"
)

const portkeyBulkBaseURL = "https://configs.portkey.ai/pricing"

// roundPrice converts a Portkey cents-per-token price to USD per 1 million
// tokens, rounded to 4 significant figures to eliminate float artifacts
// (e.g. 0.0003 * 10_000 = 2.999999996 → 3.0).
func roundPrice(centsPerToken float64) float64 {
	dollarsPerMillion := (centsPerToken / 100) * 1_000_000
	if dollarsPerMillion == 0 {
		return 0
	}
	mag := math.Pow(10, math.Floor(math.Log10(math.Abs(dollarsPerMillion))))
	return math.Round(dollarsPerMillion/mag*1000) / 1000 * mag
}

// portkeyBulkEntry mirrors the per-model shape in the bulk pricing JSON.
type portkeyBulkEntry struct {
	PricingConfig struct {
		PayAsYouGo *struct {
			RequestToken         *struct{ Price float64 `json:"price"` } `json:"request_token"`
			ResponseToken        *struct{ Price float64 `json:"price"` } `json:"response_token"`
			CacheReadInputToken  *struct{ Price float64 `json:"price"` } `json:"cache_read_input_token"`
			CacheWriteInputToken *struct{ Price float64 `json:"price"` } `json:"cache_write_input_token"`
		} `json:"pay_as_you_go"`
	} `json:"pricing_config"`
}

// @Summary List all models for a provider from Portkey
// @ID get-chat-provider-models
// @Produce json
// @Tags Agents
// @Param provider path string true "Provider identifier"
// @Success 200 {object} codersdk.PortkeyProviderModelsResponse
// @Router /api/experimental/chats/model-pricing/{provider}/models [get]
func (api *API) getChatProviderModels(rw http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if !api.DeploymentValues.AI.Chat.PortkeyPricingEnabled.Value() {
		httpapi.Write(ctx, rw, http.StatusForbidden, codersdk.Response{
			Message: "Portkey pricing lookup is not enabled on this deployment.",
		})
		return
	}

	provider := chi.URLParam(r, "provider")
	url := fmt.Sprintf("%s/%s.json", portkeyBulkBaseURL, provider)

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
			Message: fmt.Sprintf("No Portkey model catalog found for provider %q.", provider),
		})
		return
	}

	if resp.StatusCode != http.StatusOK {
		httpapi.Write(ctx, rw, http.StatusBadGateway, codersdk.Response{
			Message: fmt.Sprintf("Portkey API returned status %d.", resp.StatusCode),
		})
		return
	}

	var raw map[string]portkeyBulkEntry
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		httpapi.InternalServerError(rw, err)
		return
	}

	models := make([]codersdk.PortkeyModelEntry, 0, len(raw))
	for modelID, entry := range raw {
		if modelID == "default" {
			continue
		}
		m := codersdk.PortkeyModelEntry{ModelID: modelID}
		if payg := entry.PricingConfig.PayAsYouGo; payg != nil {
			if payg.RequestToken != nil && payg.RequestToken.Price > 0 {
				m.InputPer1M = ptr.Ref(roundPrice(payg.RequestToken.Price))
			}
			if payg.ResponseToken != nil && payg.ResponseToken.Price > 0 {
				m.OutputPer1M = ptr.Ref(roundPrice(payg.ResponseToken.Price))
			}
			if payg.CacheReadInputToken != nil && payg.CacheReadInputToken.Price > 0 {
				m.CacheReadPer1M = ptr.Ref(roundPrice(payg.CacheReadInputToken.Price))
			}
			if payg.CacheWriteInputToken != nil && payg.CacheWriteInputToken.Price > 0 {
				m.CacheWritePer1M = ptr.Ref(roundPrice(payg.CacheWriteInputToken.Price))
			}
		}
		models = append(models, m)
	}

	sort.Slice(models, func(i, j int) bool {
		return models[i].ModelID < models[j].ModelID
	})

	httpapi.Write(ctx, rw, http.StatusOK, codersdk.PortkeyProviderModelsResponse{
		Models: models,
	})
}
