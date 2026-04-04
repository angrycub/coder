import {
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ExponentialBackoff,
  type Websocket,
  WebsocketBuilder,
  WebsocketEvent,
} from "websocket-ts";
import { useEffectEvent } from "#/hooks/hookPolyfills";
import { useClipboard } from "#/hooks/useClipboard";
import { cn } from "#/utils/cn";
import { terminalWebsocketUrl } from "#/utils/terminal";
import type { ITerminalAdapter } from "./TerminalAdapter";
import type { ConnectionStatus } from "./types";
import { useTerminalEngine } from "./useTerminalAdapter";

export type WorkspaceTerminalHandle = {
  refit: () => void;
};

type WorkspaceTerminalProps = {
  ref?: Ref<WorkspaceTerminalHandle>;
  agentId: string | undefined;
  operatingSystem?: string;
  className?: string;
  autoFocus?: boolean;
  isVisible?: boolean;
  initialCommand?: string;
  containerName?: string;
  containerUser?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Error) => void;
  reconnectionToken: string;
  baseUrl?: string;
  terminalFontFamily?: string;
  renderer?: string;
  backgroundColor?: string;
  onOpenLink?: (uri: string) => void;
  loading?: boolean;
  errorMessage?: string;
  testId?: string;
};

const DEFAULT_TERMINAL_FONT_FAMILY = "monospace";
const ESCAPED_CARRIAGE_RETURN = "\x1b\r";

const encodeTerminalPayload = (payload: Record<string, number | string>) => {
  return new TextEncoder().encode(JSON.stringify(payload));
};

export const WorkspaceTerminal = ({
  ref,
  agentId,
  operatingSystem,
  className,
  autoFocus = true,
  isVisible = true,
  initialCommand,
  containerName,
  containerUser,
  onStatusChange,
  onError,
  reconnectionToken,
  baseUrl,
  terminalFontFamily = DEFAULT_TERMINAL_FONT_FAMILY,
  renderer,
  backgroundColor,
  onOpenLink,
  loading = false,
  errorMessage,
  testId,
}: WorkspaceTerminalProps) => {
  const scopeId = useId();
  const terminalWrapperRef = useRef<HTMLDivElement>(null);
  const websocketRef = useRef<Websocket | undefined>(undefined);
  const handleOpenLink = useEffectEvent((uri: string) => {
    onOpenLink ? onOpenLink(uri) : window.open(uri, "_blank", "noopener");
  });
  const handleStatusChange = useEffectEvent((status: ConnectionStatus) => {
    onStatusChange?.(status);
  });
  const [adapter, setAdapter] = useState<ITerminalAdapter>();
  const { copyToClipboard } = useClipboard();
  const terminalEngine = useTerminalEngine();

  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  if (isVisible && !hasBeenVisible) {
    setHasBeenVisible(true);
  }

  const reportTerminalError = useEffectEvent((error: Error) => {
    console.error(error);
    onError?.(error);
  });

  const getTerminalDimensions = useCallback(
    (adapter: ITerminalAdapter): { height: number; width: number } | null => {
      const { cols, rows } = adapter.getDimensions();
      if (rows <= 0 || cols <= 0) {
        reportTerminalError(
          new Error(
            `Terminal has non-positive dimensions: ${rows}x${cols}`,
          ),
        );
        return null;
      }
      return { height: rows, width: cols };
    },
    [reportTerminalError],
  );

  const refit = useCallback(() => {
    if (!adapter) {
      return;
    }
    adapter.fit();
  }, [adapter]);

  useImperativeHandle(
    ref,
    () => ({
      refit,
    }),
    [refit],
  );

  // ---------------------------------------------------------------------------
  // Effect: initialise the terminal adapter when the component first becomes
  // visible. Tears down and recreates if the engine selection changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasBeenVisible) {
      return;
    }

    const mountNode = terminalWrapperRef.current;
    if (!mountNode) {
      reportTerminalError(new Error("Terminal mount container is unavailable"));
      return;
    }

    let disposed = false;
    let nextAdapter: ITerminalAdapter | null = null;

    const setupAdapter = async () => {
      if (terminalEngine === "ghostty") {
        // Dynamic imports keep the xterm bundle out of the ghostty path
        const { GhosttyAdapter } = await import("./adapters/GhosttyAdapter");
        const ghosttyAdapter = new GhosttyAdapter({
          fontFamily: terminalFontFamily,
          fontSize: 16,
          backgroundColor,
          onOpenLink: handleOpenLink,
        });
        await ghosttyAdapter.initialize();
        if (disposed) {
          ghosttyAdapter.dispose();
          return;
        }
        nextAdapter = ghosttyAdapter;
      } else {
        const { XtermAdapter } = await import("./adapters/XtermAdapter");
        nextAdapter = new XtermAdapter({
          fontFamily: terminalFontFamily,
          fontSize: 16,
          backgroundColor,
          renderer,
          onOpenLink: handleOpenLink,
        });
      }

      const isMac = navigator.platform.match("Mac");
      const copySelection = () => {
        const selection = nextAdapter!.getSelection();
        if (selection) {
          copyToClipboard(selection);
        }
      };

      nextAdapter.attachCustomKeyEventHandler((event) => {
        // Shift+Enter → send escaped carriage return
        if (event.shiftKey && event.key === "Enter") {
          if (event.type === "keydown") {
            websocketRef.current?.send(
              encodeTerminalPayload({ data: ESCAPED_CARRIAGE_RETURN }),
            );
          }
          return false;
        }

        // Ctrl+Shift+C (or Cmd+Shift+C on Mac) → copy selection
        if (
          (isMac ? event.metaKey : event.ctrlKey) &&
          event.shiftKey &&
          event.key === "C"
        ) {
          event.preventDefault();
          if (event.type === "keydown") {
            copySelection();
          }
          return false;
        }

        return true;
      });

      nextAdapter.onSelectionChange(copySelection);

      nextAdapter.open(mountNode);
      nextAdapter.fit();

      const handleWindowResize = () => nextAdapter?.fit();
      window.addEventListener("resize", handleWindowResize);

      const resizeObserver = new ResizeObserver(() => {
        nextAdapter?.fit();
      });
      resizeObserver.observe(mountNode);

      setAdapter(nextAdapter);

      return () => {
        window.removeEventListener("resize", handleWindowResize);
        resizeObserver.disconnect();
      };
    };

    const cleanupPromise = setupAdapter();

    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => {
        cleanup?.();
        nextAdapter?.dispose();
        setAdapter(undefined);
      });
    };
  }, [
    hasBeenVisible,
    terminalEngine,
    copyToClipboard,
    handleOpenLink,
    renderer,
    reportTerminalError,
    terminalFontFamily,
    backgroundColor,
  ]);

  // ---------------------------------------------------------------------------
  // Effect: refit when visibility is restored
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isVisible) {
      return;
    }
    refit();
  }, [isVisible, refit]);

  // ---------------------------------------------------------------------------
  // Effect: connect WebSocket once the adapter is ready
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!adapter || !hasBeenVisible) {
      return;
    }

    adapter.clear();
    if (autoFocus) {
      adapter.focus();
    }
    adapter.setOptions({ disableStdin: true });

    if (loading) {
      return;
    }

    if (errorMessage) {
      adapter.writeln(errorMessage);
      handleStatusChange("disconnected");
      return;
    }

    if (!agentId) {
      const error = new Error("Terminal requires agentId to connect");
      reportTerminalError(error);
      adapter.writeln(error.message);
      handleStatusChange("disconnected");
      return;
    }

    refit();
    const initialDimensions = getTerminalDimensions(adapter) ?? {
      height: 24,
      width: 80,
    };

    let websocket: Websocket | null;
    const disposers = [
      adapter.onData((data) => {
        websocket?.send(encodeTerminalPayload({ data }));
      }),
      adapter.onResize((cols, rows) => {
        if (rows <= 0 || cols <= 0) {
          reportTerminalError(
            new Error(
              `Terminal received non-positive resize: ${rows}x${cols}`,
            ),
          );
          return;
        }
        websocket?.send(encodeTerminalPayload({ height: rows, width: cols }));
      }),
    ];

    let disposed = false;
    terminalWebsocketUrl(
      baseUrl,
      reconnectionToken,
      agentId,
      initialCommand,
      initialDimensions.height,
      initialDimensions.width,
      containerName,
      containerUser,
    )
      .then((url) => {
        if (disposed) {
          return;
        }

        websocket = new WebsocketBuilder(url)
          .withBackoff(new ExponentialBackoff(1000, 6))
          .build();

        const scheduleTerminalResize = () => {
          window.setTimeout(() => {
            if (disposed) {
              return;
            }
            const dimensions = getTerminalDimensions(adapter);
            if (!dimensions) {
              return;
            }
            websocket?.send(
              encodeTerminalPayload({
                height: dimensions.height,
                width: dimensions.width,
              }),
            );
          }, 0);
        };

        websocket.binaryType = "arraybuffer";
        websocketRef.current = websocket;

        websocket.addEventListener(WebsocketEvent.open, () => {
          if (disposed) {
            return;
          }
          adapter.setOptions({
            disableStdin: false,
            windowsMode: operatingSystem === "windows",
          });
          refit();
          scheduleTerminalResize();
          handleStatusChange("connected");
        });

        websocket.addEventListener(WebsocketEvent.error, (_, event) => {
          if (disposed) {
            return;
          }
          console.error("WebSocket error:", event);
          adapter.setOptions({ disableStdin: true });
          handleStatusChange("disconnected");
        });

        websocket.addEventListener(WebsocketEvent.close, () => {
          if (disposed) {
            return;
          }
          adapter.setOptions({ disableStdin: true });
          handleStatusChange("disconnected");
        });

        websocket.addEventListener(WebsocketEvent.message, (_, event) => {
          if (disposed) {
            return;
          }
          if (typeof event.data === "string") {
            // This exclusively occurs when testing.
            // "jest-websocket-mock" doesn't support ArrayBuffer.
            adapter.write(event.data);
          } else {
            adapter.write(new Uint8Array(event.data));
          }
        });

        websocket.addEventListener(WebsocketEvent.reconnect, () => {
          if (disposed || !websocket) {
            return;
          }
          websocket.binaryType = "arraybuffer";
          refit();
          const dimensions = getTerminalDimensions(adapter);
          if (!dimensions) {
            return;
          }
          websocket.send(
            encodeTerminalPayload({
              height: dimensions.height,
              width: dimensions.width,
            }),
          );
        });
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        console.error("WebSocket connection failed:", error);
        reportTerminalError(
          error instanceof Error ? error : new Error(String(error)),
        );
        handleStatusChange("disconnected");
      });

    return () => {
      disposed = true;
      for (const disposer of disposers) {
        disposer.dispose();
      }
      websocket?.close(1000);
      websocketRef.current = undefined;
    };
  }, [
    hasBeenVisible,
    agentId,
    autoFocus,
    baseUrl,
    containerName,
    containerUser,
    errorMessage,
    getTerminalDimensions,
    handleStatusChange,
    initialCommand,
    loading,
    operatingSystem,
    reconnectionToken,
    refit,
    reportTerminalError,
    adapter,
  ]);

  const terminalScopeSelector = `[data-terminal-scope="${scopeId}"]`;

  // Only inject xterm-specific CSS when using the xterm engine.
  const xtermStyles =
    terminalEngine === "xterm"
      ? `
      ${terminalScopeSelector} .xterm {
        padding: 4px;
        width: 100%;
        height: 100%;
      }

      ${terminalScopeSelector} .xterm-viewport {
        /* This is required to force full-width on the terminal. */
        /* Otherwise there's a small white bar to the right of the scrollbar. */
        width: auto !important;
      }

      ${terminalScopeSelector} .xterm-viewport::-webkit-scrollbar {
        width: 10px;
      }

      ${terminalScopeSelector} .xterm-viewport::-webkit-scrollbar-track {
        background-color: inherit;
      }

      ${terminalScopeSelector} .xterm-viewport::-webkit-scrollbar-thumb {
        min-height: 20px;
        background-color: rgba(255, 255, 255, 0.18);
      }
    `
      : "";

  return (
    <>
      {xtermStyles && <style>{xtermStyles}</style>}
      <div
        className={cn(
          "workspace-terminal h-full w-full flex-1 min-h-0 overflow-hidden bg-surface-tertiary",
          className,
        )}
        ref={terminalWrapperRef}
        data-terminal-scope={scopeId}
        data-testid={testId}
      />
    </>
  );
};
