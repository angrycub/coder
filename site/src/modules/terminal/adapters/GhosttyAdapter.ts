import type { ITerminalAdapter } from "../TerminalAdapter";

// ---------------------------------------------------------------------------
// Minimal type stubs for the ghostty-web package API.
// The package is not yet installed; these stubs let the TypeScript compiler
// accept the adapter until `pnpm add ghostty-web` is run.
// ---------------------------------------------------------------------------
type GhosttyTerminalOptions = {
  fontSize?: number;
  theme?: { background?: string; foreground?: string };
  fontFamily?: string;
};

type GhosttyDisposable = { dispose(): void };

interface GhosttyTerminalInstance {
  open(element: HTMLElement): void;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  readonly cols: number;
  readonly rows: number;
  onData(handler: (data: string) => void): GhosttyDisposable;
  onResize(
    handler: (event: { cols: number; rows: number }) => void,
  ): GhosttyDisposable;
  onSelectionChange(handler: () => void): GhosttyDisposable;
  getSelection(): string;
  focus(): void;
  clear(): void;
  writeln(text: string): void;
  attachCustomKeyEventHandler(
    handler: (event: KeyboardEvent) => boolean,
  ): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Lazy WASM initialisation — called once per page load.
// ---------------------------------------------------------------------------
let ghosttyReadyPromise: Promise<void> | null = null;

/**
 * Ensure the ghostty-web WASM module has been loaded. Calling this multiple
 * times is safe — the promise is cached after the first call.
 */
export async function ensureGhosttyReady(): Promise<void> {
  if (!ghosttyReadyPromise) {
    // Dynamic import so the WASM bundle is only fetched when the Ghostty
    // adapter is actually used (experiment enabled).
    ghosttyReadyPromise = import("ghostty-web").then((mod) => mod.init());
  }
  return ghosttyReadyPromise;
}

export type GhosttyAdapterOptions = {
  fontFamily?: string;
  fontSize?: number;
  backgroundColor?: string;
  onOpenLink?: (uri: string) => void;
};

export class GhosttyAdapter implements ITerminalAdapter {
  private term: GhosttyTerminalInstance | null = null;
  private options: GhosttyAdapterOptions;
  private containerElement: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Pending data written before open() is called
  private pendingWrites: Array<string | Uint8Array> = [];

  constructor(options: GhosttyAdapterOptions = {}) {
    this.options = options;
  }

  /**
   * Initialise the WASM module and create the Terminal instance. Must be
   * awaited before open() is called.
   */
  async initialize(): Promise<void> {
    await ensureGhosttyReady();
    const { Terminal } = await import("ghostty-web");
    const { fontFamily = "monospace", fontSize = 16, backgroundColor } =
      this.options;

    const termOptions: GhosttyTerminalOptions = {
      fontSize,
      fontFamily,
      ...(backgroundColor ? { theme: { background: backgroundColor } } : {}),
    };

    this.term = new Terminal(termOptions) as unknown as GhosttyTerminalInstance;
  }

  open(element: HTMLElement): void {
    if (!this.term) {
      throw new Error(
        "GhosttyAdapter.initialize() must be awaited before open()",
      );
    }
    this.containerElement = element;
    this.term.open(element);

    // Flush any writes that arrived before open()
    for (const data of this.pendingWrites) {
      this.term.write(data);
    }
    this.pendingWrites = [];
  }

  write(data: string | Uint8Array): void {
    if (!this.term) {
      this.pendingWrites.push(data);
      return;
    }
    this.term.write(data);
  }

  resize(cols: number, rows: number): void {
    this.term?.resize(cols, rows);
  }

  fit(): void {
    if (!this.term || !this.containerElement) {
      return;
    }
    // ghostty-web doesn't ship a FitAddon equivalent yet, so we compute
    // dimensions from the container and a fixed cell size approximation.
    // This will be replaced once ghostty-web exposes a proper fit API.
    const { width, height } = this.containerElement.getBoundingClientRect();
    const fontSize = this.options.fontSize ?? 16;
    // Approximate character cell dimensions. These match typical monospace
    // metrics and will be close enough until a real fit API is available.
    const cellWidth = fontSize * 0.6;
    const cellHeight = fontSize * 1.2;
    const cols = Math.max(2, Math.floor(width / cellWidth));
    const rows = Math.max(1, Math.floor(height / cellHeight));
    this.term.resize(cols, rows);
  }

  getDimensions(): { cols: number; rows: number } {
    if (!this.term) {
      return { cols: 80, rows: 24 };
    }
    return { cols: this.term.cols, rows: this.term.rows };
  }

  onData(handler: (data: string) => void): { dispose(): void } {
    if (!this.term) {
      return { dispose: () => {} };
    }
    return this.term.onData(handler);
  }

  onResize(
    handler: (cols: number, rows: number) => void,
  ): { dispose(): void } {
    if (!this.term) {
      return { dispose: () => {} };
    }
    return this.term.onResize((evt) => handler(evt.cols, evt.rows));
  }

  onSelectionChange(handler: () => void): { dispose(): void } {
    if (!this.term) {
      return { dispose: () => {} };
    }
    return this.term.onSelectionChange(handler);
  }

  getSelection(): string {
    return this.term?.getSelection() ?? "";
  }

  focus(): void {
    this.term?.focus();
  }

  clear(): void {
    this.term?.clear();
  }

  writeln(text: string): void {
    this.term?.writeln(text);
  }

  attachCustomKeyEventHandler(
    handler: (event: KeyboardEvent) => boolean,
  ): void {
    this.term?.attachCustomKeyEventHandler(handler);
  }

  setOptions(_options: Record<string, unknown>): void {
    // ghostty-web options are set at construction time; runtime mutation is
    // not yet supported. windowsMode in particular is a no-op because
    // Ghostty handles CRLF natively.
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.term?.dispose();
    this.term = null;
    this.containerElement = null;
    this.pendingWrites = [];
  }
}
