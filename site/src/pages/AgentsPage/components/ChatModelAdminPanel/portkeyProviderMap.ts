/**
 * Maps Coder provider IDs to Portkey provider slugs.
 * Returns null for providers that have no Portkey catalog
 * (generic gateways like openrouter, vercel, openaicompat).
 */

const PORTKEY_PROVIDER_MAP: Record<string, string> = {
	azure: "azure-openai",
	bedrock: "bedrock",
	gemini: "google",
	"vertex-ai": "vertex-ai",
	vertex: "vertex-ai",
	"together-ai": "together-ai",
	together: "together-ai",
	"groq-ai": "groq",
	"mistral-ai": "mistral-ai",
	mistral: "mistral-ai",
	"cohere-ai": "cohere",
	"fireworks-ai": "fireworks-ai",
	fireworks: "fireworks-ai",
	"perplexity-ai": "perplexity-ai",
	perplexity: "perplexity-ai",
};

const PORTKEY_IDENTITY_PROVIDERS = new Set([
	"openai",
	"anthropic",
	"google",
	"groq",
	"deepseek",
	"x-ai",
	"cohere",
	"anyscale",
	"deepinfra",
	"cerebras",
	"together-ai",
	"mistral-ai",
	"fireworks-ai",
	"perplexity-ai",
	"vertex-ai",
	"bedrock",
	"azure-openai",
]);

const PORTKEY_UNSUPPORTED = new Set([
	"openaicompat",
	"openai-compatible",
	"openai_compatible",
	"openrouter",
	"vercel",
]);

/**
 * Returns the Portkey provider slug for a given Coder provider name,
 * or null if the provider has no Portkey model catalog.
 */
export function toPortkeyProvider(provider: string): string | null {
	const p = provider.trim().toLowerCase();
	if (PORTKEY_UNSUPPORTED.has(p)) return null;
	const mapped = PORTKEY_PROVIDER_MAP[p];
	if (mapped) return mapped;
	return PORTKEY_IDENTITY_PROVIDERS.has(p) ? p : null;
}
