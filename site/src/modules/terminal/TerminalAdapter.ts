/**
 * ITerminalAdapter defines the contract that both the xterm.js and ghostty-web
 * terminal implementations must satisfy. WorkspaceTerminal interacts with the
 * terminal exclusively through this interface, keeping the component logic
 * independent of the underlying engine.
 */
export interface ITerminalAdapter {
  /**
   * Mount the terminal into a DOM element. Must be called before any other
   * method.
   */
  open(element: HTMLElement): void;

  /** Write PTY output bytes to the terminal display. */
  write(data: string | Uint8Array): void;

  /** Resize the terminal grid. */
  resize(cols: number, rows: number): void;

  /**
   * Fit the terminal to fill its container element. Should be called whenever
   * the container dimensions change.
   */
  fit(): void;

  /** Return the current terminal grid dimensions. */
  getDimensions(): { cols: number; rows: number };

  /**
   * Register a handler called whenever the user types or pastes into the
   * terminal. The handler receives the UTF-8 string to send to the PTY.
   */
  onData(handler: (data: string) => void): { dispose(): void };

  /**
   * Register a handler called whenever the terminal grid is resized (e.g. by
   * fit()). The handler receives the new column and row counts.
   */
  onResize(handler: (cols: number, rows: number) => void): { dispose(): void };

  /**
   * Register a handler called whenever the text selection changes.
   */
  onSelectionChange(handler: () => void): { dispose(): void };

  /** Return the currently selected text, or an empty string. */
  getSelection(): string;

  /**
   * Focus the terminal so keyboard input is captured immediately.
   */
  focus(): void;

  /**
   * Clear the terminal screen.
   */
  clear(): void;

  /**
   * Write a line of text followed by a newline. Useful for error/status
   * messages before the WebSocket is connected.
   */
  writeln(text: string): void;

  /**
   * Attach a custom keyboard event handler. Return true to let xterm handle
   * the event normally, false to suppress it.
   */
  attachCustomKeyEventHandler(
    handler: (event: KeyboardEvent) => boolean,
  ): void;

  /**
   * Set a terminal option at runtime. The key/value semantics match the
   * xterm.js ITerminalOptions interface for the options that Coder uses.
   */
  setOptions(options: Record<string, unknown>): void;

  /**
   * Release all resources (DOM nodes, WebGL context, event listeners, etc.).
   * The adapter must not be used after dispose() is called.
   */
  dispose(): void;
}
