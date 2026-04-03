import { useQuery } from "react-query";
import { API } from "#/api/api";
import type { PortkeyModelEntry } from "#/api/typesGenerated";
import { toPortkeyProvider } from "./portkeyProviderMap";

export type { PortkeyModelEntry };

export function usePortkeyProviderModels(provider: string | null): {
	models: readonly PortkeyModelEntry[];
	isLoading: boolean;
	error: string | null;
} {
	const portkeyProvider = provider ? toPortkeyProvider(provider) : null;

	const query = useQuery({
		queryKey: ["portkey-provider-models", portkeyProvider],
		queryFn: () => API.experimental.getChatProviderModels(portkeyProvider!),
		enabled: portkeyProvider !== null,
		staleTime: 10 * 60 * 1000, // 10 min — pricing data changes rarely
		retry: false,
	});

	return {
		models: query.data?.models ?? [],
		isLoading: query.isLoading && portkeyProvider !== null,
		error: query.error
			? query.error instanceof Error
				? query.error.message
				: "Failed to load model list."
			: null,
	};
}
