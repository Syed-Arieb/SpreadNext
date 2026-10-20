import { Injectable } from '@angular/core';

interface FormulaEngineExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  evaluate(pointer: number, length: number): void;
  export_csv(pointer: number, length: number): void;
  export_xlsx(pointer: number, length: number): void;
  result_ptr(): number;
  result_len(): number;
}

interface EngineResult {
  values?: string[][];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class FormulaEngine {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private engine?: Promise<FormulaEngineExports>;

  async evaluate(rows: number, columns: number, cells: string[][]): Promise<string[][]> {
    const wasm = await this.load();
    const input = this.encoder.encode(JSON.stringify({ rows, columns, cells }));
    const pointer = wasm.alloc(input.length);

    try {
      new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
      wasm.evaluate(pointer, input.length);
    } finally {
      wasm.dealloc(pointer, input.length);
    }

    const outputPointer = wasm.result_ptr();
    const outputLength = wasm.result_len();
    const output = this.decoder.decode(
      new Uint8Array(wasm.memory.buffer, outputPointer, outputLength)
    );
    const result = JSON.parse(output) as EngineResult;

    if (result.error) {
      throw new Error(result.error);
    }

    if (!Array.isArray(result.values)) {
      throw new Error('Formula engine returned an invalid result');
    }

    return result.values;
  }

  async exportCsv(rows: number, columns: number, cells: string[][]): Promise<string> {
    const wasm = await this.load();
    const input = this.encoder.encode(JSON.stringify({ rows, columns, cells }));
    const pointer = wasm.alloc(input.length);

    try {
      new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
      wasm.export_csv(pointer, input.length);
    } finally {
      wasm.dealloc(pointer, input.length);
    }

    const outputPointer = wasm.result_ptr();
    const outputLength = wasm.result_len();
    const output = new Uint8Array(wasm.memory.buffer, outputPointer, outputLength);

    if (output.length === 0) {
      throw new Error('Formula engine returned an empty export');
    }

    if (output[0] !== 0) {
      throw new Error(this.decoder.decode(output.subarray(1)));
    }

    return this.decoder.decode(output.subarray(1));
  }

  async exportXlsx(rows: number, columns: number, cells: string[][]): Promise<Uint8Array<ArrayBuffer>> {
    const wasm = await this.load();
    const input = this.encoder.encode(JSON.stringify({ rows, columns, cells }));
    const pointer = wasm.alloc(input.length);

    try {
      new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
      wasm.export_xlsx(pointer, input.length);
    } finally {
      wasm.dealloc(pointer, input.length);
    }

    const outputPointer = wasm.result_ptr();
    const outputLength = wasm.result_len();
    const output = new Uint8Array(wasm.memory.buffer, outputPointer, outputLength);

    if (output.length === 0) {
      throw new Error('Formula engine returned an empty export');
    }

    if (output[0] !== 0) {
      throw new Error(this.decoder.decode(output.subarray(1)));
    }

    return output.slice(1);
  }

  private load(): Promise<FormulaEngineExports> {
    if (!this.engine) {
      this.engine = this.instantiate();
    }

    return this.engine;
  }

  private async instantiate(): Promise<FormulaEngineExports> {
    const response = await fetch(new URL('formula-engine.wasm', document.baseURI));

    if (!response.ok) {
      throw new Error(`Unable to load the formula engine (${response.status})`);
    }

    let instance: WebAssembly.Instance;

    try {
      const result = await WebAssembly.instantiateStreaming(response.clone(), {});
      instance = result.instance;
    } catch {
      const result = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      instance = result.instance;
    }

    return instance.exports as unknown as FormulaEngineExports;
  }
}
