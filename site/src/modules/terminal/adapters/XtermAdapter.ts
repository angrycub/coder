import "@xterm/xterm/css/xterm.css";
import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { ITerminalAdapter } from "../TerminalAdapter";

export type XtermAdapterOptions = {
  fontFamily?: string;
  fontSize?: number;
  backgroundColor?: string;
  renderer?: string;
  onOpenLink?: (uri: string) => void;
};

export class XtermAdapter implements ITerminalAdapter {
  private terminal: Terminal;
  private fitAddon: FitAddon;

  constructor(options: XtermAdapterOptions = {}) {
    const {
      fontFamily = "monospace",
      fontSize = 16,
      backgroundColor,
      renderer,
      onOpenLink,
    } = options;

    this.terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      disableStdin: false,
      fontFamily,
      fontSize,
      ...(backgroundColor ? { theme: { background: backgroundColor } } : {}),
    });

    if (renderer === "webgl") {
      this.terminal.loadAddon(new WebglAddon());
    } else if (renderer === "canvas") {
      this.terminal.loadAddon(new CanvasAddon());
    }

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = "11";
    this.terminal.loadAddon(
      new WebLinksAddon((_, uri) => {
        onOpenLink ? onOpenLink(uri) : window.open(uri, "_blank", "noopener");
      }),
    );
  }

  open(element: HTMLElement): void {
    this.terminal.open(element);
  }

  write(data: string | Uint8Array): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  fit(): void {
    // Fit twice — first fit can overflow slightly in some scenarios.
    // Applying a second fit resolves this.
    try {
      this.fitAddon.fit();
      this.fitAddon.fit();
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: Expected transient fit failure while xterm initializes.
      console.debug("Terminal fit skipped: renderer not ready", error);
    }
  }

  getDimensions(): { cols: number; rows: number } {
    return { cols: this.terminal.cols, rows: this.terminal.rows };
  }

  onData(handler: (data: string) => void): { dispose(): void } {
    return this.terminal.onData(handler);
  }

  onResize(handler: (cols: number, rows: number) => void): { dispose(): void } {
    return this.terminal.onResize((evt) => handler(evt.cols, evt.rows));
  }

  onSelectionChange(handler: () => void): { dispose(): void } {
    return this.terminal.onSelectionChange(handler);
  }

  getSelection(): string {
    return this.terminal.getSelection();
  }

  focus(): void {
    this.terminal.focus();
  }

  clear(): void {
    this.terminal.clear();
  }

  writeln(text: string): void {
    this.terminal.writeln(text);
  }

  attachCustomKeyEventHandler(
    handler: (event: KeyboardEvent) => boolean,
  ): void {
    this.terminal.attachCustomKeyEventHandler(handler);
  }

  setOptions(options: Record<string, unknown>): void {
    this.terminal.options = options as never;
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
