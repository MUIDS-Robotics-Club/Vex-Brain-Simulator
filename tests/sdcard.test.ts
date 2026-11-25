import { describe, expect, it } from 'vitest';
import { Runtime } from '../src/sim/runtime';
import { Ctx2D } from '../src/sim/screen';
import { CBuf } from '../src/sim/helpers';
import { SdCard } from '../src/sim/sdcard';

function mockCtx(): Ctx2D {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillRect: () => {}, strokeRect: () => {}, clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, fill: () => {}, stroke: () => {}, fillText: () => {}, measureText: () => ({ width: 10 }),
  };
}

async function exec(rt: Runtime, src: string, lang: 'cpp' | 'py'): Promise<string[]> {
  const logs: string[] = [];
  rt.onLog = (t, k) => logs.push(`${k}:${t}`);
  await rt.run(src, lang);
  return logs;
}

describe('SD card', () => {
  it('round-trips text and binary buffers', () => {
    const card = new SdCard();
    card.savefile('u.txt', 'hé');
    const text = new CBuf(8);
    expect(card.loadfile('u.txt', text, 7)).toBe(3);
    expect(text.s).toBe('hé');

    card.savefile('b.bin', new Uint8Array([0xff, 0x00, 0x41]));
    const bin = new CBuf(8);
    card.loadfile('b.bin', bin, 3);
    expect([...bin.s].map((c) => c.charCodeAt(0))).toEqual([0xff, 0, 0x41]);
  });

  it('saves, loads and appends files', async () => {
    const rt = new Runtime(mockCtx());
    const logs = await exec(rt, `
      int main() {
        Brain.SDcard.savefile("note.txt", (uint8_t*)"hello", 5);
        char buf[16] = {};
        int n = Brain.SDcard.loadfile("note.txt", (uint8_t*)buf, sizeof(buf) - 1);
        printf("%d %s %d\\n", n, buf, Brain.SDcard.size("note.txt"));
        Brain.SDcard.appendfile("note.txt", (uint8_t*)"!", 1);
        printf("%s\\n", Brain.SDcard.exists("note.txt") ? "yes" : "no");
        return 0;
      }`, 'cpp');
    expect(logs).toEqual(['out:5 hello 5', 'out:yes']);
    expect(rt.sdcard.size('note.txt')).toBe(6);
  });

  it('keeps files between runs', async () => {
    const rt = new Runtime(mockCtx());
    await exec(rt, `
      int main() {
        Brain.SDcard.savefile("run.txt", (uint8_t*)"kept", 4);
        return 0;
      }`, 'cpp');
    const logs = await exec(rt, `
      int main() {
        char buf[8] = {};
        Brain.SDcard.loadfile("run.txt", (uint8_t*)buf, sizeof(buf) - 1);
        printf("%s\\n", buf);
        return 0;
      }`, 'cpp');
    expect(logs).toEqual(['out:kept']);
  });

  it('works with python bytearrays', async () => {
    const rt = new Runtime(mockCtx());
    const logs = await exec(rt, `
brain = Brain()
brain.sdcard.savefile("note.txt", bytearray("hi"))
print(brain.sdcard.is_inserted())
print(brain.sdcard.loadfile("note.txt").decode("utf-8"))
`, 'py');
    expect(logs).toEqual(['out:True', 'out:hi']);
  });

  it('cuts the Brain off from the files while ejected', () => {
    const card = new SdCard();
    card.savefile('note.txt', 'hi');
    card.eject();
    expect(card.isInserted()).toBe(false);
    expect(card.exists('note.txt')).toBe(false);
    expect(card.loadfile('note.txt')).toEqual(new Uint8Array());
    expect(card.savefile('note.txt', 'no')).toBe(0);
    card.insert();
    expect(card.exists('note.txt')).toBe(true);
    expect(card.list()).toEqual([{ name: 'note.txt', size: 2 }]);
  });

  it('draws an image from the card and warns when it is missing', async () => {
    const ctx = mockCtx();
    const drawn: string[] = [];
    ctx.drawImage = (_img, x, y) => { drawn.push(`${x} ${y}`); };
    const rt = new Runtime(ctx);
    rt.sdcard.savefile('logo.bmp', new Uint8Array([0x42, 0x4d]));
    rt.screen.loadImage = async (name) => (name === 'logo.bmp' ? ({} as CanvasImageSource) : undefined);

    const ok = await exec(rt, `int main() { Brain.Screen.drawImageFromFile("logo.bmp", 10, 20); return 0; }`, 'cpp');
    expect(drawn).toEqual(['10 20']);
    expect(ok.filter((l) => l.startsWith('warn'))).toEqual([]);

    const missing = await exec(rt, `int main() { Brain.Screen.drawImageFromFile("nope.bmp", 0, 0); return 0; }`, 'cpp');
    expect(missing.some((l) => l.startsWith('warn:drawImageFromFile("nope.bmp")'))).toBe(true);
  });

  it('serializes files, contents and the card state', () => {
    const card = new SdCard();
    card.savefile('a.bin', new Uint8Array([0xff, 0x00, 0x41]));
    card.savefile('b.txt', 'hello');
    const restored = SdCard.fromJSON(JSON.stringify(card.toJSON()));
    expect(restored.list()).toEqual(card.list());
    expect(restored.read('a.bin')).toEqual(new Uint8Array([0xff, 0x00, 0x41]));
    const text = new CBuf(8);
    restored.loadfile('b.txt', text, 7);
    expect(text.s).toBe('hello');
  });
});
