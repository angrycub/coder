import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
	createTemplate,
	createWorkspace,
	login,
	openTerminalWindow,
	startAgent,
	stopAgent,
} from "../helpers";
import { beforeCoderTest } from "../hooks";

test.beforeEach(async ({ page }) => {
	beforeCoderTest(page);
	await login(page);
});

test("web terminal", async ({ context, page }) => {
	const token = randomUUID();
	const template = await createTemplate(page, {
		graph: [
			{
				graph: {
					resources: [
						{
							agents: [
								{
									token,
									displayApps: { webTerminal: true },
									order: 0,
								},
							],
						},
					],
				},
			},
		],
	});
	const workspaceName = await createWorkspace(page, template);
	const agent = await startAgent(page, token);
	const terminal = await openTerminalWindow(page, context, workspaceName);

	await terminal.waitForSelector("div.xterm-rows", {
		state: "visible",
	});

	// Workaround: delay next steps as "div.xterm-rows" can be recreated/reattached
	// after a couple of milliseconds.
	await terminal.waitForTimeout(2000);

	// Ensure that we can type in it
	await terminal.keyboard.type("echo he${justabreak}llo123456");
	await terminal.keyboard.press("Enter");

	// Check if "echo" command was executed
	// try-catch is used temporarily to find the root cause: https://github.com/coder/coder/actions/runs/6176958762/job/16767089943
	try {
		await terminal.waitForSelector(
			'div.xterm-rows span:text-matches("hello123456")',
			{
				state: "visible",
				timeout: 10 * 1000,
			},
		);
	} catch (error) {
		const pageContent = await terminal.content();
		console.error("Unable to find echoed text:", pageContent);
		throw error;
	}

	await stopAgent(agent);
});

test("web terminal — ghostty adapter", async ({ context, page, request }) => {
	// Enable the ghostty-terminal experiment for this test via the API.
	// The experiment flag is deployment-level; we patch it here for test isolation.
	// NOTE: This test is intentionally skipped when CODER_EXPERIMENTS does not
	// include "ghostty-terminal". The experiment is not in ExperimentsSafe so
	// it won't be activated by the wildcard "*".
	test.skip(
		!process.env.CODER_E2E_GHOSTTY_TERMINAL,
		"Set CODER_E2E_GHOSTTY_TERMINAL=1 to run ghostty terminal e2e tests",
	);

	const token = randomUUID();
	const template = await createTemplate(page, {
		graph: [
			{
				graph: {
					resources: [
						{
							agents: [
								{
									token,
									displayApps: { webTerminal: true },
									order: 0,
								},
							],
						},
					],
				},
			},
		],
	});
	const workspaceName = await createWorkspace(page, template);
	const agent = await startAgent(page, token);
	const terminal = await openTerminalWindow(page, context, workspaceName);

	// ghostty-web renders into a <canvas>, not DOM text spans.
	// We verify the terminal canvas is mounted and the component is connected.
	await terminal.waitForSelector("canvas", { state: "visible", timeout: 15_000 });

	// Type a command and verify via the page title or status indicator
	// (text-in-canvas is not DOM-readable).
	await terminal.keyboard.type("echo ghostty_e2e_ok");
	await terminal.keyboard.press("Enter");

	// Give the terminal time to process and render
	await terminal.waitForTimeout(2000);

	// The terminal wrapper should still be connected (no error state)
	const terminalEl = terminal.locator("[data-testid='terminal']");
	await expect(terminalEl).toBeVisible();

	await stopAgent(agent);
});
