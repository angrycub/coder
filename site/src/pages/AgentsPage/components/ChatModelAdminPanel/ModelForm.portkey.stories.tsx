import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import { API } from "#/api/api";
import type * as TypesGen from "#/api/typesGenerated";
import { ChatModelAdminPanel } from "./ChatModelAdminPanel";

// ── Shared mock data ──────────────────────────────────────────────

const now = "2026-02-18T12:00:00.000Z";

/** A handful of realistic OpenAI model entries (prices in USD/1M tokens). */
const mockOpenAIModels: TypesGen.PortkeyModelEntry[] = [
	{
		model_id: "gpt-4o",
		input_per_1m: 2.5,
		output_per_1m: 10,
		cache_read_per_1m: 1.25,
		max_input_tokens: 128000,
	},
	{
		model_id: "gpt-4o-mini",
		input_per_1m: 0.15,
		output_per_1m: 0.6,
		cache_read_per_1m: 0.075,
		max_input_tokens: 128000,
	},
	{
		model_id: "gpt-4-turbo",
		input_per_1m: 10,
		output_per_1m: 30,
		max_input_tokens: 128000,
	},
	{
		model_id: "gpt-3.5-turbo",
		input_per_1m: 0.5,
		output_per_1m: 1.5,
		max_input_tokens: 16385,
	},
	{
		model_id: "o1",
		input_per_1m: 15,
		output_per_1m: 60,
		cache_read_per_1m: 7.5,
		max_input_tokens: 200000,
	},
	{
		model_id: "o3-mini",
		input_per_1m: 1.1,
		output_per_1m: 4.4,
		cache_read_per_1m: 0.55,
		max_input_tokens: 200000,
	},
];

const mockAnthropicModels: TypesGen.PortkeyModelEntry[] = [
	{
		model_id: "claude-3-5-sonnet-20241022",
		input_per_1m: 3,
		output_per_1m: 15,
		cache_read_per_1m: 0.3,
		cache_write_per_1m: 3.75,
		max_input_tokens: 200000,
	},
	{
		model_id: "claude-3-5-haiku-20241022",
		input_per_1m: 0.8,
		output_per_1m: 4,
		cache_read_per_1m: 0.08,
		cache_write_per_1m: 1,
		max_input_tokens: 200000,
	},
	{
		model_id: "claude-3-opus-20240229",
		input_per_1m: 15,
		output_per_1m: 75,
		cache_read_per_1m: 1.5,
		cache_write_per_1m: 18.75,
		max_input_tokens: 200000,
	},
];

const openAIProviderConfig: TypesGen.ChatProviderConfig = {
	id: "provider-openai",
	provider: "openai",
	display_name: "OpenAI",
	enabled: true,
	has_api_key: true,
	central_api_key_enabled: true,
	allow_user_api_key: false,
	allow_central_api_key_fallback: false,
	base_url: "",
	source: "database",
	created_at: now,
	updated_at: now,
};

const anthropicProviderConfig: TypesGen.ChatProviderConfig = {
	id: "provider-anthropic",
	provider: "anthropic",
	display_name: "Anthropic",
	enabled: true,
	has_api_key: true,
	central_api_key_enabled: true,
	allow_user_api_key: false,
	allow_central_api_key_fallback: false,
	base_url: "",
	source: "database",
	created_at: now,
	updated_at: now,
};

const openRouterProviderConfig: TypesGen.ChatProviderConfig = {
	id: "provider-openrouter",
	provider: "openrouter",
	display_name: "OpenRouter",
	enabled: true,
	has_api_key: true,
	central_api_key_enabled: true,
	allow_user_api_key: false,
	allow_central_api_key_fallback: false,
	base_url: "",
	source: "database",
	created_at: now,
	updated_at: now,
};

// ── Helper: inject / remove the portkey-pricing-enabled meta tag ──

function injectPortkeyMeta(enabled: boolean) {
	const existing = document.querySelector(
		"meta[property=portkey-pricing-enabled]",
	);
	if (existing) {
		existing.setAttribute("content", String(enabled));
		return;
	}
	const meta = document.createElement("meta");
	meta.setAttribute("property", "portkey-pricing-enabled");
	meta.setAttribute("content", String(enabled));
	document.head.appendChild(meta);
}

function removePortkeyMeta() {
	document
		.querySelector("meta[property=portkey-pricing-enabled]")
		?.remove();
}

// ── Meta ──────────────────────────────────────────────────────────

const meta: Meta<typeof ChatModelAdminPanel> = {
	title: "pages/AgentsPage/ChatModelAdminPanel/PortkeyModelAutocomplete",
	component: ChatModelAdminPanel,
	args: {
		section: "models",
		providerConfigsData: [openAIProviderConfig],
		modelConfigsData: [],
		modelCatalogData: { providers: [] },
		isLoading: false,
		providerConfigsError: null,
		modelConfigsError: null,
		modelCatalogError: null,
		onCreateProvider: fn(async () => ({})),
		onUpdateProvider: fn(async () => ({})),
		onDeleteProvider: fn(async () => undefined),
		isProviderMutationPending: false,
		providerMutationError: null,
		onCreateModel: fn(async () => ({})),
		onUpdateModel: fn(async () => ({})),
		onDeleteModel: fn(async () => undefined),
		isCreatingModel: false,
		isUpdatingModel: false,
		isDeletingModel: false,
		modelMutationError: null,
	},
};

export default meta;
type Story = StoryObj<typeof ChatModelAdminPanel>;

// ── Helper: open the "Add model" form for a given provider ────────

const openAddModelForm = async (
	body: ReturnType<typeof within>,
	providerLabel: string,
) => {
	const trigger = await body.findByRole("button", { name: "Add model" });
	await userEvent.click(trigger);
	await waitFor(async () => {
		const item = body.getByRole("menuitem", {
			name: new RegExp(providerLabel, "i"),
		});
		await userEvent.click(item);
	});
};

// ── Stories ───────────────────────────────────────────────────────

/**
 * When the flag is OFF the model identifier field stays a plain text
 * input — no combobox, no Portkey calls.
 */
export const FlagDisabled: Story = {
	beforeEach: () => {
		removePortkeyMeta();
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: mockOpenAIModels,
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		// Plain input should be present (no combobox trigger button).
		await expect(
			await body.findByPlaceholderText(/gpt-5, claude-sonnet/i),
		).toBeInTheDocument();

		// The Portkey API must NOT have been called.
		expect(API.experimental.getChatProviderModels).not.toHaveBeenCalled();
	},
};

/**
 * When the flag is ON and the provider is supported, the model
 * identifier field becomes a Combobox once models have loaded.
 */
export const FlagEnabled: Story = {
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: mockOpenAIModels,
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		// A combobox trigger button should appear once models load.
		await expect(
			await body.findByRole("combobox"),
		).toBeInTheDocument();
	},
};

/**
 * Type in the search box and verify filtering works — only models
 * matching the query should be visible in the dropdown.
 */
export const ModelSearch: Story = {
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: mockOpenAIModels,
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		// Open the combobox.
		const combobox = await body.findByRole("combobox");
		await userEvent.click(combobox);

		// Type a search term.
		const input = await body.findByPlaceholderText(/Search models/i);
		await userEvent.type(input, "mini");

		// Only the "mini" model should be visible.
		await expect(await body.findByText("gpt-4o-mini")).toBeInTheDocument();
		expect(body.queryByText("gpt-4-turbo")).not.toBeInTheDocument();
	},
};

/**
 * Selecting a model from the combobox populates the pricing fields
 * and auto-expands the Pricing section.
 */
export const SelectModelAutoFillsPricing: Story = {
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: mockOpenAIModels,
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		// Open the combobox and select gpt-4o.
		const combobox = await body.findByRole("combobox");
		await userEvent.click(combobox);
		const option = await body.findByText("gpt-4o");
		await userEvent.click(option);

		// Pricing section should now be expanded.
		await expect(
			await body.findByText(/Input Price Per Million Tokens/i),
		).toBeInTheDocument();

		// Pricing fields should be pre-filled with the mock values.
		await expect(
			await body.findByDisplayValue("2.5"),
		).toBeInTheDocument();
		await expect(
			await body.findByDisplayValue("10"),
		).toBeInTheDocument();
	},
};

/**
 * When a model has context window data, selecting it fills the Context
 * Limit field automatically.
 */
export const SelectModelFillsContextLimit: Story = {
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: mockOpenAIModels,
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		const combobox = await body.findByRole("combobox");
		await userEvent.click(combobox);
		const option = await body.findByText("gpt-4o");
		await userEvent.click(option);

		// Context Limit field should be pre-filled with gpt-4o's 128000.
		await expect(
			await body.findByDisplayValue("128000"),
		).toBeInTheDocument();
	},
};

/**
 * Model entries show a price hint (input/output per 1M) inline in the
 * dropdown list so admins can compare models at a glance.
 */
export const PriceHintsInDropdown: Story = {
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: mockOpenAIModels,
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		const combobox = await body.findByRole("combobox");
		await userEvent.click(combobox);

		// The price hint for gpt-4o should appear alongside the model name.
		await expect(
			await body.findByText(/\$2\.5\/\$10 \/1M/),
		).toBeInTheDocument();
	},
};

/**
 * A model with no pricing data (e.g. a future model not yet in the
 * Portkey catalog) should appear in the list without a price hint, and
 * selecting it should leave the pricing fields empty.
 */
export const ModelWithNoPricing: Story = {
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: [
				{ model_id: "gpt-5" }, // no pricing yet
				...mockOpenAIModels,
			],
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		const combobox = await body.findByRole("combobox");
		await userEvent.click(combobox);

		// gpt-5 should appear but without a price hint.
		const gpt5Item = await body.findByText("gpt-5");
		await expect(gpt5Item).toBeInTheDocument();

		// Select gpt-5 — pricing section should NOT auto-expand.
		await userEvent.click(gpt5Item);
		expect(
			body.queryByText(/Input Price Per Million Tokens/i),
		).not.toBeInTheDocument();
	},
};

/**
 * For providers not in the Portkey catalog (openrouter, vercel,
 * openaicompat) the field falls back to a plain text input regardless
 * of the flag.
 */
export const UnsupportedProviderFallsBackToInput: Story = {
	args: {
		providerConfigsData: [openRouterProviderConfig],
	},
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: [],
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenRouter");

		// Should be a plain input, not a combobox trigger.
		await expect(
			await body.findByPlaceholderText(/gpt-5, claude-sonnet/i),
		).toBeInTheDocument();
		expect(body.queryByRole("combobox")).not.toBeInTheDocument();

		// getChatProviderModels should never have been called.
		expect(API.experimental.getChatProviderModels).not.toHaveBeenCalled();
	},
};

/**
 * While models are loading the input shows a "Loading models…"
 * placeholder so the admin knows something is happening.
 */
export const LoadingState: Story = {
	beforeEach: () => {
		injectPortkeyMeta(true);
		// Never resolves — simulates an in-flight request.
		spyOn(API.experimental, "getChatProviderModels").mockReturnValue(
			new Promise(() => {}),
		);
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "OpenAI");

		await expect(
			await body.findByPlaceholderText(/Loading models/i),
		).toBeInTheDocument();
		expect(body.queryByRole("combobox")).not.toBeInTheDocument();
	},
};

/**
 * Anthropic models have cache read AND write pricing — verify all
 * four pricing fields are populated correctly on selection.
 */
export const AnthropicWithFullCachePricing: Story = {
	args: {
		providerConfigsData: [anthropicProviderConfig],
	},
	beforeEach: () => {
		injectPortkeyMeta(true);
		spyOn(API.experimental, "getChatProviderModels").mockResolvedValue({
			models: mockAnthropicModels,
		});
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await openAddModelForm(body, "Anthropic");

		const combobox = await body.findByRole("combobox");
		await userEvent.click(combobox);

		const option = await body.findByText("claude-3-5-sonnet-20241022");
		await userEvent.click(option);

		// All four pricing fields should be populated.
		await expect(await body.findByDisplayValue("3")).toBeInTheDocument();
		await expect(await body.findByDisplayValue("15")).toBeInTheDocument();
		await expect(await body.findByDisplayValue("0.3")).toBeInTheDocument();
		await expect(await body.findByDisplayValue("3.75")).toBeInTheDocument();
	},
};
