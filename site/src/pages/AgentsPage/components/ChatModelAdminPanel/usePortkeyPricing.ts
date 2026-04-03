/**
 * usePortkeyPricing
 *
 * Fetches model pricing from the Portkey open-source pricing API:
 *   GET https://api.portkey.ai/model-configs/pricing/{provider}/{model}
 *
 * Portkey returns prices in USD **cents per token**.
 * This hook converts them to **USD per 1 million tokens** so they match
 * the form fields (cost.input_price_per_million_tokens, etc.).
 *
 * Conversion: centsPerToken * 10_000 = dollarsPerMillionTokens
 *   (because 1 dollar = 100 cents, and 1M tokens = 1_000_000 tokens)
 */

import { useState } from "react";
import { API } from "#/api/api";

export interface PortkeyPricingResult {
	inputPer1M?: number;
	outputPer1M?: number;
	cacheReadPer1M?: number;
	cacheWritePer1M?: number;
}

interface UsePortkeyPricingOptions {
	provider: string | null;
	// model is unused at construction time; it is passed to fetchPricing()
	model: string | null;
	onSuccess: (pricing: PortkeyPricingResult) => void;
}

interface UsePortkeyPricingReturn {
	fetchPricing: (model: string) => void;
	isLoading: boolean;
	error: string | null;
}

/** Convert Portkey's cents-per-token to dollars per 1 million tokens. */
function centsPerTokenToDollarsPerMillion(
	centsPerToken: number | undefined,
): number | undefined {
	if (centsPerToken === undefined || centsPerToken === null) return undefined;
	// centsPerToken / 100 => dollars per token
	// * 1_000_000        => dollars per million tokens
	return (centsPerToken / 100) * 1_000_000;
}

/** Normalize a Coder provider name to the Portkey provider slug. */
function toPortkeyProvider(provider: string): string {
	const p = provider.trim().toLowerCase();

	// Map known Coder provider IDs to Portkey slugs.
	const providerMap: Record<string, string> = {
		azure: "azure-openai",
		bedrock: "bedrock",
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

	return providerMap[p] ?? p;
}

interface PortkeyApiResponse {
	pay_as_you_go?: {
		request_token?: { price?: number };
		response_token?: { price?: number };
		cache_read_input_token?: { price?: number };
		cache_write_input_token?: { price?: number };
	};
}

export function usePortkeyPricing({
	provider,
	onSuccess,
}: UsePortkeyPricingOptions): UsePortkeyPricingReturn {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchPricing = (model: string) => {
		if (!provider || !model) return;

		const portkeyProvider = toPortkeyProvider(provider);

		setIsLoading(true);
		setError(null);

		API.experimental
			.getChatModelPricing(portkeyProvider, model)
			.then((data) => {
				const d = data as PortkeyApiResponse;
				const payg = d.pay_as_you_go;
				const result: PortkeyPricingResult = {
					inputPer1M: centsPerTokenToDollarsPerMillion(payg?.request_token?.price),
					outputPer1M: centsPerTokenToDollarsPerMillion(payg?.response_token?.price),
					cacheReadPer1M: centsPerTokenToDollarsPerMillion(payg?.cache_read_input_token?.price),
					cacheWritePer1M: centsPerTokenToDollarsPerMillion(payg?.cache_write_input_token?.price),
				};
				onSuccess(result);
			})
			.catch((err: unknown) => {
				const message =
					err instanceof Error ? err.message : "Failed to fetch Portkey pricing.";
				setError(message);
			})
			.finally(() => {
				setIsLoading(false);
			});
	};

	return { fetchPricing, isLoading, error };
}
