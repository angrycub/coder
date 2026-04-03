package coderd

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"

	_ "embed"

	"cdr.dev/slog/v3"
	"github.com/go-chi/chi/v5"

	"github.com/coder/coder/v2/coderd/httpapi"
	"github.com/coder/coder/v2/coderd/util/ptr"
	"github.com/coder/coder/v2/codersdk"
)

const portkeyBulkBaseURL = "https://configs.portkey.ai/pricing"

// litellmContextWindowData is the vendored LiteLLM context window dataset.
// Keys are either bare model IDs or "{provider}/{model}" slugs.
// Values are max_input_tokens integers.
//
//go:embed litellm_context_window.json
var litellmContextWindowData []byte

// googleTierSuffix matches Portkey's pricing-tier suffixes on Google model IDs,
// e.g. "gemini-1.5-flash-lte-128k" or "gemini-1.5-pro-latest-gt-128k".
var googleTierSuffix = regexp.MustCompile(`-(lte|gt|latest-lte|latest-gt)-\d+k$`)

// contextWindowLookup builds a map from model ID to max_input_tokens from
// either a user-supplied file path (for air-gapped deployments) or the
// embedded vendored copy.
func contextWindowLookup(overridePath string) (map[string]int64, error) {
	raw := litellmContextWindowData
	if overridePath != "" {
		b, err := os.ReadFile(overridePath)
		if err != nil {
			return nil, fmt.Errorf("read litellm context window file %q: %w", overridePath, err)
		}
		raw = b
	}
	var m map[string]int64
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("parse litellm context window data: %w", err)
	}
	return m, nil
}

// lookupContextWindow finds the max_input_tokens for a model ID.
// It tries the following in order:
//  1. Exact key match (handles most providers already in the dataset)
//  2. "{litellmProvider}/{modelID}" variants for providers that use prefixed keys
//  3. Google-specific: strip the Portkey pricing-tier suffix and retry
func lookupContextWindow(ctxMap map[string]int64, modelID string, litellmProviders []string) *int64 {
	if v, ok := ctxMap[modelID]; ok {
		return ptr.Ref(v)
	}
	for _, prov := range litellmProviders {
		if v, ok := ctxMap[prov+"/"+modelID]; ok {
			return ptr.Ref(v)
		}
	}
	// Google tier-suffix normalization
	if googleTierSuffix.MatchString(modelID) {
		normalized := googleTierSuffix.ReplaceAllString(modelID, "")
		if v, ok := ctxMap[normalized]; ok {
			return ptr.Ref(v)
		}
	}
	return nil
}

// portkeyToLiteLLMProviders maps a Portkey provider slug to the LiteLLM
// prefix(es) used for that provider's models in the context window dataset.
var portkeyToLiteLLMProviders = map[string][]string{
	"openai":        {},                           // bare keys e.g. "gpt-4o"
	"anthropic":     {},                           // bare aliases added during vendoring
	"google":        {"gemini"},                   // "gemini/gemini-2.0-flash"
	"azure-openai":  {"azure"},                    // "azure/gpt-4o"
	"bedrock":       {},                           // bare keys e.g. "anthropic.claude-3-5-sonnet-..."
	"vertex-ai":     {"vertex_ai"},                // "vertex_ai/gemini-2.0-flash"
	"groq":          {"groq"},                     // "groq/llama-3.3-70b-versatile"
	"deepseek":      {"deepseek"},
	"x-ai":          {"xai"},                      // "xai/grok-2"
	"cohere":        {"cohere"},
	"mistral-ai":    {"mistral", "codestral"},
	"fireworks-ai":  {"fireworks_ai"},
	"perplexity-ai": {"perplexity"},
	"together-ai":   {"together_ai"},
	"anyscale":      {"anyscale"},
	"deepinfra":     {"deepinfra"},
	"cerebras":      {"cerebras"},
}

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

	// Load context window data (vendored or user-supplied override).
	ctxPath := strings.TrimSpace(api.DeploymentValues.AI.Chat.LiteLLMContextPath.Value())
	ctxMap, err := contextWindowLookup(ctxPath)
	if err != nil {
		// Non-fatal: log and continue without context data.
		api.Logger.Warn(ctx, "failed to load litellm context window data", slog.Error(err))
		ctxMap = map[string]int64{}
	}

	litellmProviders := portkeyToLiteLLMProviders[provider]

	models := make([]codersdk.PortkeyModelEntry, 0, len(raw))
	for modelID, entry := range raw {
		if modelID == "default" {
			continue
		}
		m := codersdk.PortkeyModelEntry{
			ModelID:        modelID,
			MaxInputTokens: lookupContextWindow(ctxMap, modelID, litellmProviders),
		}
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
