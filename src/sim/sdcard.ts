import { CBuf } from './helpers';

const enc = new TextEncoder();
const dec = new TextDecoder('latin1');

/** Text bytes decode as UTF-8; anything else is kept byte-for-byte as latin1 so binary buffers survive. */
function decodeBytes(b: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return dec.decode(b); }
}

export function toBytes(v: unknown, len?: unknown): Uint8Array {
  let b: Uint8Array;
  if (v instanceof Uint8Array) b = v;
  else if (v instanceof CBuf) b = enc.encode(v.s);
  else if (Array.isArray(v)) b = Uint8Array.from(v.map((n) => Number(n) & 0xff));
  else b = enc.encode(String(v ?? ''));
  if (len === undefined) return b;
  const n = Math.max(0, Math.trunc(Number(len)));
  return b.subarray(0, n);
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * In-memory stand-in for the card in the Brain's SD slot. Files survive Run/Stop, like a real card. There is no
 * browser API for a removable card, so nothing here touches the real disk; the UI can seed and edit the files.
 */
export class SdCard {
  private files = new Map<string, Uint8Array>();
  private present = true;
  /** Called after a change the app may want to persist. */
  onChange: () => void = () => {};

  get inserted(): boolean { return this.present; }
  isInserted(): boolean { return this.present; }
  /** Python spelling. */
  is_inserted(): boolean { return this.present; }

  insert(): void {
    if (this.present) return;
    this.present = true;
    this.onChange();
  }

  eject(): void {
    if (!this.present) return;
    this.present = false;
    this.onChange();
  }

  exists(name: unknown): boolean { return this.present && this.files.has(String(name)); }

  size(name: unknown): number { return this.present ? this.files.get(String(name))?.length ?? 0 : 0; }

  filesize(name: unknown): number { return this.size(name); }

  savefile(name: unknown, data: unknown, len?: unknown): number {
    if (!this.present) return 0;
    const b = toBytes(data, len);
    this.files.set(String(name), b.slice());
    this.onChange();
    return b.length;
  }

  appendfile(name: unknown, data: unknown, len?: unknown): number {
    if (!this.present) return 0;
    const key = String(name);
    const old = this.files.get(key);
    if (!old) return 0; // matches the Brain: appendfile does not create a missing file
    const add = toBytes(data, len);
    const next = new Uint8Array(old.length + add.length);
    next.set(old);
    next.set(add, old.length);
    this.files.set(key, next);
    this.onChange();
    return add.length;
  }

  loadfile(name: unknown, buffer?: unknown, len?: unknown): Uint8Array | number {
    const file = this.present ? this.files.get(String(name)) : undefined;
    if (!file) return buffer === undefined ? new Uint8Array() : 0;
    if (buffer === undefined) return file.slice();

    const max = len === undefined ? file.length : Math.max(0, Math.trunc(Number(len)));
    const data = file.subarray(0, max);
    if (buffer instanceof CBuf) buffer.s = decodeBytes(data);
    else if (buffer instanceof Uint8Array) buffer.set(data);
    else if (Array.isArray(buffer)) for (let i = 0; i < data.length; i++) buffer[i] = data[i];
    return data.length;
  }

  savetextfile(name: unknown, text: unknown): number {
    return this.savefile(name, text);
  }

  appendtextfile(name: unknown, text: unknown): number {
    return this.appendfile(name, text);
  }

  loadtextfile(name: unknown, buffer: unknown, len?: unknown): number {
    const n = this.loadfile(name, buffer, len);
    return typeof n === 'number' ? n : 0;
  }

  // ---------------------------------------------------------------- file manager
  list(): { name: string; size: number }[] {
    return [...this.files].map(([name, b]) => ({ name, size: b.length })).sort((a, b) => a.name.localeCompare(b.name));
  }

  read(name: string): Uint8Array | undefined { return this.files.get(name)?.slice(); }

  remove(name: string): void {
    if (this.files.delete(name)) this.onChange();
  }

  clear(): void {
    if (!this.files.size) return;
    this.files.clear();
    this.onChange();
  }

  toJSON(): { inserted: boolean; files: Record<string, string> } {
    const files: Record<string, string> = Object.create(null);
    for (const [name, b] of this.files) files[name] = toBase64(b);
    return { inserted: this.present, files };
  }

  static fromJSON(raw: string | null | undefined): SdCard {
    const card = new SdCard();
    if (!raw) return card;
    try {
      const data = JSON.parse(raw) as { inserted?: boolean; files?: Record<string, string> };
      card.present = data.inserted !== false;
      for (const [name, b] of Object.entries(data.files ?? {})) card.files.set(name, fromBase64(String(b)));
    } catch { /* unreadable saved card: start empty instead of breaking startup */ }
    return card;
  }
}
