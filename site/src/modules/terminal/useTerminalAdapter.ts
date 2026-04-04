import { isDevBuild } from "#/utils/buildInfo";
import { useDashboard } from "../dashboard/useDashboard";

/**
 * Returns which terminal engine should be used based on the active experiments
 * and whether this is a development build.
 *
 * - "ghostty" → use the ghostty-web WASM-based adapter
 * - "xterm"   → use the xterm.js adapter (default)
 */
export function useTerminalEngine(): "xterm" | "ghostty" {
  const { experiments, buildInfo } = useDashboard();
  const useGhostty =
    experiments.includes("ghostty-terminal") || isDevBuild(buildInfo);
  return useGhostty ? "ghostty" : "xterm";
}
