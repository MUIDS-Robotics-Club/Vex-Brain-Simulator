import { SdCard } from './sim/sdcard';

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function download(bytes: Uint8Array, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** File manager for the simulated SD card: insert/eject it, add files from disk, remove them, save copies back. */
export class SdCardPanel {
  private overlay: HTMLDivElement;
  private panel: HTMLDivElement;
  private list: HTMLDivElement;
  private status: HTMLSpanElement;
  private insertBtn: HTMLButtonElement;
  private input: HTMLInputElement;

  constructor(private card: SdCard) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'palette-overlay sd-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <div class="palette sd-panel" role="dialog" aria-modal="true" aria-label="SD card files">
        <div class="sd-head">
          <span class="sd-title">SD card</span>
          <span class="sd-status"></span>
          <span class="spacer"></span>
          <button class="btn small" data-act="toggle"></button>
        </div>
        <div class="sd-list" role="list"></div>
        <div class="sd-foot">
          <button class="btn small" data-act="add">Add files&hellip;</button>
          <button class="btn small" data-act="clear">Remove all</button>
          <span class="spacer"></span>
          <span class="dim">Files the Brain saves show up here</span>
        </div>
      </div>
      <input type="file" multiple hidden />`;
    document.body.appendChild(this.overlay);

    this.list = this.overlay.querySelector('.sd-list')!;
    this.panel = this.overlay.querySelector('.sd-panel')!;
    this.status = this.overlay.querySelector('.sd-status')!;
    this.insertBtn = this.overlay.querySelector('[data-act="toggle"]')!;
    this.input = this.overlay.querySelector('input[type="file"]')!;

    this.insertBtn.addEventListener('click', () => {
      if (this.card.inserted) this.card.eject(); else this.card.insert();
      this.render();
    });
    this.overlay.querySelector('[data-act="add"]')!.addEventListener('click', () => this.input.click());
    this.overlay.querySelector('[data-act="clear"]')!.addEventListener('click', () => {
      if (!this.card.list().length) return;
      if (!window.confirm('Remove every file from the SD card?')) return;
      this.card.clear();
      this.render();
    });
    this.input.addEventListener('change', () => {
      const files = Array.from(this.input.files ?? []);
      this.input.value = '';
      this.addFiles(files);
    });
    this.panel.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      this.panel.classList.add('dropping');
    });
    this.panel.addEventListener('dragleave', (e) => {
      if (!this.panel.contains(e.relatedTarget as Node | null)) this.panel.classList.remove('dropping');
    });
    this.panel.addEventListener('drop', (e) => {
      e.preventDefault();
      this.panel.classList.remove('dropping');
      this.addFiles(Array.from(e.dataTransfer?.files ?? []));
    });
    this.overlay.addEventListener('mousedown', (e) => { if (e.target === this.overlay) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.overlay.hidden) this.close(); });
    this.render();
  }

  private addFiles(files: File[]): void {
    if (!files.length) return;
    void Promise.all(files.map(async (f) => this.card.savefile(f.name, new Uint8Array(await f.arrayBuffer())))).then(() => this.render());
  }

  get isOpen(): boolean { return !this.overlay.hidden; }

  open(): void {
    this.render();
    this.overlay.hidden = false;
  }

  close(): void { this.overlay.hidden = true; }

  private render(): void {
    const files = this.card.list();
    this.status.textContent = `${this.card.inserted ? 'Inserted' : 'Ejected'} - ${files.length} file${files.length === 1 ? '' : 's'}`;
    this.status.classList.toggle('out', !this.card.inserted);
    this.insertBtn.textContent = this.card.inserted ? 'Eject' : 'Insert';

    this.list.textContent = '';
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'sd-empty';
      empty.textContent = 'No files. Drop some here, or use Add files.';
      this.list.appendChild(empty);
      return;
    }
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'sd-row';
      row.setAttribute('role', 'listitem');

      const name = document.createElement('span');
      name.className = 'sd-name';
      name.textContent = f.name;
      name.title = f.name;

      const size = document.createElement('span');
      size.className = 'sd-size';
      size.textContent = formatSize(f.size);

      const save = document.createElement('button');
      save.className = 'btn small';
      save.textContent = 'Save';
      save.title = 'Download this file';
      save.addEventListener('click', () => {
        const bytes = this.card.read(f.name);
        if (bytes) download(bytes, f.name);
      });

      const remove = document.createElement('button');
      remove.className = 'btn small danger';
      remove.textContent = 'Remove';
      remove.title = 'Delete this file from the card';
      remove.addEventListener('click', () => { this.card.remove(f.name); this.render(); });

      row.append(name, size, save, remove);
      this.list.appendChild(row);
    }
  }
}
