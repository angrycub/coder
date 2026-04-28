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
  readonly options: Record<string, unknown>;
  readonly element?: HTMLElement;
  readonly textarea?: HTMLTextAreaElement;
  onData(handler: (data: string) => void): GhosttyDisposable;
  onResize(
    handler: (event: { cols: number; rows: number }) => void,
  ): GhosttyDisposable;
  onKey(handler: (event: { key: string; domEvent: KeyboardEvent }) => void): GhosttyDisposable;
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

    // ---------------------------------------------------------------------------
    // DEBUG: Check whether the requested font is loaded and report ligature support.
    // ---------------------------------------------------------------------------
    await this.logFontDiagnostics(fontFamily, fontSize);

    this.term = new Terminal(termOptions) as unknown as GhosttyTerminalInstance;
    console.debug("[GhosttyAdapter] Terminal instance created", { termOptions });
  }

  /**
   * Log font loading status and ligature capability for the given font family.
   * Uses the CSS Font Loading API and Canvas 2D measureText to confirm the
   * correct font is active and whether OpenType ligatures are rendering.
   */
  private async logFontDiagnostics(fontFamily: string, fontSize: number): Promise<void> {
    // The first font name in the CSS stack is the preferred face.
    const preferredFont = fontFamily.split(",")[0].trim().replace(/['"/]/g, "");
    const fontSpec = `${fontSize}px ${fontFamily}`;

    // 1. CSS Font Loading API — is the font ready?
    const isLoaded = document.fonts.check(fontSpec);
    console.debug("[GhosttyAdapter] Font check (synchronous)", {
      preferredFont,
      fontSpec,
      isLoaded,
    });

    if (!isLoaded) {
      console.warn(
        `[GhosttyAdapter] Preferred font "${preferredFont}" is NOT loaded yet — ` +
        "terminal will use a fallback until fonts finish loading. " +
        "This can cause incorrect cell sizing."
      );
      // Wait for fonts to load and re-check.
      try {
        await document.fonts.load(fontSpec);
        const isLoadedAfterWait = document.fonts.check(fontSpec);
        console.debug("[GhosttyAdapter] Font check (after load)", {
          preferredFont,
          isLoadedAfterWait,
        });
      } catch (e) {
        console.warn("[GhosttyAdapter] document.fonts.load() failed", e);
      }
    }

    // 2. Log all fonts the browser currently has loaded that match the family name.
    const matchingFaces: string[] = [];
    document.fonts.forEach((face) => {
      if (face.family.replace(/['"/]/g, "").toLowerCase() === preferredFont.toLowerCase()) {
        matchingFaces.push(`${face.family} ${face.style} ${face.weight} — ${face.status}`);
      }
    });
    if (matchingFaces.length > 0) {
      console.debug(`[GhosttyAdapter] Loaded FontFace entries for "${preferredFont}":`, matchingFaces);
    } else {
      console.warn(`[GhosttyAdapter] No FontFace entries found for "${preferredFont}" — browser is using a system fallback.`);
    }

    // 3. Canvas 2D resolved font — what the browser actually used.
    //    This is the ground truth: the ctx.font property after assignment
    //    reflects the computed/resolved font, which may differ from what was set
    //    if the requested font isn't available.
    const probeCtx = document.createElement("canvas").getContext("2d")!;
    probeCtx.font = fontSpec;
    console.debug("[GhosttyAdapter] Canvas 2D resolved font", {
      requested: fontSpec,
      resolved: probeCtx.font,
      matches: probeCtx.font.includes(preferredFont),
    });

    // 4. Ligature support analysis.
    //
    // NOTE: Width-comparison detection does NOT work for monospace fonts like
    // Fira Code. In a monospace font every glyph — including ligature glyphs —
    // occupies the same advance width as a single character. A two-character
    // ligature like "->" is still exactly two cells wide, so measureText("->")
    // always equals measureText("-") + measureText(">") regardless of whether
    // ligatures are active. Width comparison only works for proportional fonts.
    //
    // The correct checks for a monospace terminal font are:
    //   a) Does the font support ligatures at all (font-feature-settings)?
    //   b) Does the renderer activate them (ctx.fontVariantLigatures or
    //      font-feature-settings on the canvas context)?
    //
    // ghostty-web sets ctx.font as a plain string (e.g. "16px 'Fira Code'")
    // with no fontVariantLigatures or fontFeatureSettings property on the
    // Canvas2D context. Canvas 2D does NOT apply OpenType calt/liga features
    // by default — they must be explicitly enabled.
    //
    // ITerminalOptions has no fontFeatureSettings field, so there is currently
    // no API to enable ligatures through ghostty-web's Terminal constructor.

    // Check what Canvas 2D would need to enable ligatures.
    const canvasLigatureProps = {
      fontVariantLigatures: (probeCtx as unknown as Record<string, unknown>).fontVariantLigatures ?? "(not supported)",
      fontFeatureSettings: (probeCtx as unknown as Record<string, unknown>).fontFeatureSettings ?? "(not supported)",
    };

    console.info(
      `[GhosttyAdapter] Ligature status for "${preferredFont}":`,
      {
        fontSupportsLigatures: ["Fira Code", "JetBrains Mono", "Cascadia Code", "Monaspace", "Iosevka"].some(
          (f) => preferredFont.toLowerCase().includes(f.toLowerCase())
        ),
        isMonospaceFont: true,
        widthDetectionValid: false,
        reason: "Monospace fonts keep ligature glyphs at fixed cell width — width comparison cannot detect them.",
        ghosttyWebHasFontFeatureSettingsOption: false,
        canvasContextProps: canvasLigatureProps,
        conclusion:
          "ghostty-web does not currently expose a fontFeatureSettings option and Canvas 2D " +
          "does not enable OpenType liga/calt by default. Ligatures are NOT active regardless of font choice.",
      }
    );
  }

  open(element: HTMLElement): void {
    if (!this.term) {
      throw new Error(
        "GhosttyAdapter.initialize() must be awaited before open()",
      );
    }
    this.containerElement = element;
    this.term.open(element);

    // Expose the Terminal instance on the container element for DevTools debugging.
    // Usage: document.querySelector('[data-terminal-scope]').__ghostty.input('ls\r', true)
    (element as HTMLElement & { __ghostty?: GhosttyTerminalInstance }).__ghostty = this.term;

    // ---------------------------------------------------------------------------
    // DEBUG: Log every step of the keystroke pipeline.
    // ---------------------------------------------------------------------------

    // 1. Raw DOM keydown on the container element (where ghostty-web listens).
    element.addEventListener("keydown", (e) => {
      console.debug("[GhosttyAdapter] container keydown", {
        key: e.key,
        code: e.code,
        target: (e.target as HTMLElement)?.tagName,
        activeElement: document.activeElement?.tagName,
        containerHasFocus: document.activeElement === element || element.contains(document.activeElement),
        disableStdin: this.term?.options.disableStdin,
      });
    }, { capture: true });

    // 2. ghostty-web's onKey fires after InputHandler processes the keydown
    //    (only if the customKeyEventHandler returns true).
    this.term.onKey((evt) => {
      console.debug("[GhosttyAdapter] onKey fired", {
        key: evt.key,
        domEvent: evt.domEvent.type,
      });
    });

    // 3. onData fires when ghostty-web produces encoded bytes to send to the PTY.
    //    This is what WorkspaceTerminal sends over the websocket.
    this.term.onData((data) => {
      console.debug("[GhosttyAdapter] onData fired", {
        data: JSON.stringify(data),
        disableStdin: this.term?.options.disableStdin,
      });
    });

    // 4. Log focus/blur on the container and the hidden textarea.
    element.addEventListener("focus", () => {
      console.debug("[GhosttyAdapter] container focused", {
        activeElement: document.activeElement?.tagName,
      });
    });
    element.addEventListener("blur", () => {
      console.debug("[GhosttyAdapter] container blurred", {
        activeElement: document.activeElement?.tagName,
      });
    });

    // Log after open() so textarea/element are populated.
    console.debug("[GhosttyAdapter] open() complete", {
      containerTabIndex: element.tabIndex,
      containerContentEditable: element.contentEditable,
      textareaPresent: !!this.term.textarea,
      textareaTabIndex: this.term.textarea?.tabIndex,
      disableStdin: this.term.options.disableStdin,
    });

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
    console.debug("[GhosttyAdapter] focus() called", {
      activeElement: document.activeElement?.tagName,
      disableStdin: this.term?.options.disableStdin,
    });
    this.term?.focus();
    console.debug("[GhosttyAdapter] focus() after term.focus()", {
      activeElement: document.activeElement?.tagName,
      activeElementId: document.activeElement?.id,
    });
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
    // Wrap the handler to add logging and fix the boolean polarity mismatch.
    // xterm.js convention: return true  = allow default handling (pass to terminal)
    //                      return false = consume the event (don't send to terminal)
    // ghostty-web convention: return true  = consumed, STOP processing (opposite!)
    //                         return false = not consumed, continue to onData
    // So we must invert the return value when bridging xterm handlers into ghostty-web.
    const wrappedHandler = (event: KeyboardEvent): boolean => {
      const xtermResult = handler(event);
      const ghosttyResult = !xtermResult; // invert: xterm true→ghostty false (allow)
      console.debug("[GhosttyAdapter] customKeyEventHandler", {
        key: event.key,
        type: event.type,
        xtermReturned: xtermResult,
        ghosttyReturned: ghosttyResult,
        disableStdin: this.term?.options.disableStdin,
      });
      return ghosttyResult;
    };
    this.term?.attachCustomKeyEventHandler(wrappedHandler);
  }

  setOptions(options: Record<string, unknown>): void {
    if (!this.term) {
      return;
    }
    console.debug("[GhosttyAdapter] setOptions called", {
      options,
      currentDisableStdin: this.term.options.disableStdin,
    });
    // ghostty-web exposes options via a Proxy — assign individual keys so the
    // Proxy setter fires handleOptionChange for each one rather than replacing
    // the whole Proxy object (which would break internal state).
    // windowsMode is intentionally ignored: ghostty-web handles CRLF natively.
    for (const [key, value] of Object.entries(options)) {
      if (key === "windowsMode") {
        continue;
      }
      (this.term.options as Record<string, unknown>)[key] = value;
    }
    console.debug("[GhosttyAdapter] setOptions applied", {
      newDisableStdin: this.term.options.disableStdin,
    });
    // When stdin is being re-enabled, restore focus to the terminal's
    // textarea so that keyboard events are captured immediately.
    if (options.disableStdin === false) {
      console.debug("[GhosttyAdapter] re-enabling stdin, calling focus()");
      this.term.focus();
    }
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
