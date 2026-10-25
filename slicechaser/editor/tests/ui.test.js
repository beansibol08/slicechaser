// Drives the editor page in headless Chromium with a fake Electron bridge.
// Run: node tests/ui.test.js   (needs the "playwright" package; SCREENSHOTS=dir saves images)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page_url = 'file://' + path.join(__dirname, '..', 'renderer', 'index.html');
const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_ao.xml'), 'utf8');
const shots = process.env.SCREENSHOTS;

function bridge(opts) {
  // Runs inside the page before app.js.
  window.__writes = [];
  window.__sourceChanged = null;
  window.sliceChaser = {
    env: async () => ({ chaseFile: '/Users/vj/Documents/SliceChaser/chases.json', platform: 'test' }),
    listSources: async () => opts.sources,
    readText: async (p) => { if (!opts.files[p]) throw new Error('missing'); return opts.files[p]; },
    readChase: async () => opts.saved,
    writeChase: async (text) => { window.__writes.push(text); return Date.now(); },
    chooseSource: async () => null,
    watchSource: async () => {},
    revealChase: async () => {},
    onSourceChanged: (fn) => { window.__sourceChanged = fn; }
  };
}

async function lastWrite(page) {
  await page.waitForTimeout(400); // autosave debounce
  const w = await page.evaluate(() => window.__writes[window.__writes.length - 1]);
  return w ? JSON.parse(w) : null;
}

// Click the visual center of a slice by name.
async function clickSlice(page, name, opts = {}) {
  const box = await page.locator('#stage').boundingBox();
  const c = await page.evaluate((n) => window.__sliceChaserState.slices.find((s) => s.name === n).geom.center, name);
  const x = box.x + c[0] * box.width, y = box.y + c[1] * box.height;
  await page.mouse.click(x, y, opts);
  return { x, y };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const src = '/Users/vj/Documents/Resolume Arena/Preferences/AdvancedOutput.xml';
  await page.addInitScript(bridge, { sources: [{ path: src, label: 'Arena: current setup', live: true }], files: { [src]: sample }, saved: null });
  await page.goto(page_url);
  await page.waitForFunction(() => window.__sliceChaserState.slices.length === 4);

  // slices listed, grouped by screen, with the unreadable one reported
  assert.equal(await page.locator('#sliceList label').count(), 4);
  assert.deepEqual(await page.locator('#sliceList .screen-name').allTextContents(), ['LED wall', 'Floor']);
  assert.match(await page.locator('#skippedNote').textContent(), /Broken/);
  assert.equal(await page.locator('#sourceSelect').inputValue(), src);
  let file = await lastWrite(page);
  assert.equal(file.slices.length, 4, 'geometry is pushed to the chase file on load');
  if (shots) await page.screenshot({ path: path.join(shots, '1-loaded.png') });

  // generate left-to-right (include the disabled Center slice)
  await page.uncheck('#enabledOnly');
  await page.selectOption('#patternSelect', 'ltr');
  await page.click('#genNew');
  file = await lastWrite(page);
  assert.equal(file.sequences.length, 1);
  assert.equal(file.sequences[0].name, 'Left to right');
  assert.equal(file.sequences[0].steps.length, 3);
  assert.equal(await page.locator('#steps li canvas').count(), 3);

  // click toggles a slice in the current step; Ctrl+Z restores
  await page.click('#steps li >> nth=1');
  await clickSlice(page, 'Left wing');
  file = await lastWrite(page);
  assert.deepEqual(file.sequences[0].steps[1], [0, 1, 3]);
  await page.keyboard.press('Control+z');
  file = await lastWrite(page);
  assert.deepEqual(file.sequences[0].steps[1], [1, 3]);
  await page.keyboard.press('Control+Shift+z');
  file = await lastWrite(page);
  assert.deepEqual(file.sequences[0].steps[1], [0, 1, 3]);

  // drag paints across slices with one action
  await page.keyboard.press('n'); // new empty step after current
  file = await lastWrite(page);
  assert.equal(file.sequences[0].steps.length, 4);
  assert.deepEqual(file.sequences[0].steps[2], []);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.25, { steps: 12 });
  await page.mouse.up();
  file = await lastWrite(page);
  assert.deepEqual(file.sequences[0].steps[2], [0, 1, 2]);
  await page.keyboard.press('Control+z');
  file = await lastWrite(page);
  assert.deepEqual(file.sequences[0].steps[2], [], 'one drag is one undo');

  // checkbox list edits the same step
  await page.locator('#sliceList label', { hasText: 'Triangle' }).locator('input').check();
  file = await lastWrite(page);
  assert.deepEqual(file.sequences[0].steps[2], [3]);

  // step tools
  await page.click('#dupStep');
  await page.click('#leftStep');
  await page.click('#delStep');
  file = await lastWrite(page);
  assert.equal(file.sequences[0].steps.length, 4);
  await page.keyboard.press('Delete');
  file = await lastWrite(page);
  assert.equal(file.sequences[0].steps.length, 3);

  // rename by double-click
  await page.dblclick('#seqList li');
  await page.fill('#seqList input', 'Wings sweep');
  await page.keyboard.press('Enter');
  file = await lastWrite(page);
  assert.equal(file.sequences[0].name, 'Wings sweep');
  assert.equal(file.editor.sequences[0].name, 'Wings sweep');

  // a second sequence, then reorder; ids stay with their sequences
  await page.selectOption('#patternSelect', 'cout');
  await page.click('#genNew');
  await page.click('#upSeq');
  file = await lastWrite(page);
  assert.deepEqual(file.sequences.map((q) => q.name), ['Center out', 'Wings sweep']);
  assert.deepEqual(file.sequences.map((q) => q.id), [2, 1]);

  // preview plays without touching the saved steps
  await page.fill('#bpm', '240');
  await page.click('#playBtn');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#playBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#steps li.playing').count(), 1);
  if (shots) await page.screenshot({ path: path.join(shots, '2-playing.png') });
  await page.keyboard.press(' ');
  assert.equal(await page.locator('#playBtn').getAttribute('aria-pressed'), 'false');
  file = await lastWrite(page);
  assert.equal(file.editor.preview.bpm, 240);

  // Arena saves a changed setup: the editor reloads it and keeps sequences by slice key
  const changed = sample.replace('value="Left wing"', 'value="Left wing renamed"').replace('<v x="0" y="0"/>\n\t\t\t\t\t\t\t<v x="480" y="0"/>', '<v x="0" y="0"/>\n\t\t\t\t\t\t\t<v x="400" y="0"/>');
  await page.evaluate(([p, text]) => { window.__srcText = text; window.sliceChaser.readText = async () => text; window.__sourceChanged(p); }, [src, changed]);
  await page.waitForFunction(() => window.__sliceChaserState.slices[0].name === 'Left wing renamed');
  file = await lastWrite(page);
  assert.equal(file.slices[0].name, 'Left wing renamed');
  assert.ok(file.sequences.find((q) => q.name === 'Wings sweep').steps[1].includes(0));
  if (shots) await page.screenshot({ path: path.join(shots, '3-edited.png') });

  // delete + undo
  await page.click('#delSeq');
  file = await lastWrite(page);
  assert.equal(file.sequences.length, 1);
  await page.keyboard.press('Control+z');
  file = await lastWrite(page);
  assert.equal(file.sequences.length, 2);

  // restart from the saved file: everything comes back
  const saved = JSON.stringify(file);
  const page2 = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  page2.on('pageerror', (e) => errors.push(e.message));
  await page2.addInitScript(bridge, { sources: [], files: {}, saved }); // source file gone
  await page2.goto(page_url);
  await page2.waitForFunction(() => window.__sliceChaserState.sequences.length === 2);
  assert.equal(await page2.locator('#sliceList label').count(), 4, 'slices restored from chases.json');
  assert.equal(await page2.locator('#seqList li.active .seq-name').textContent(), 'Center out');
  assert.equal(await page2.inputValue('#bpm'), '240');

  // first run with nothing at all
  const page3 = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  page3.on('pageerror', (e) => errors.push(e.message));
  await page3.addInitScript(bridge, { sources: [], files: {}, saved: null });
  await page3.goto(page_url);
  await page3.waitForTimeout(200);
  assert.ok(await page3.locator('#emptyStage').isVisible());
  assert.match(await page3.locator('#emptyText').textContent(), /No Advanced Output setup found/);
  assert.ok(await page3.locator('#genNew').isDisabled());
  if (shots) await page3.screenshot({ path: path.join(shots, '4-empty.png') });

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('All UI tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
