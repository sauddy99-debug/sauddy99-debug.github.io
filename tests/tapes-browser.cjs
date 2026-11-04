// Run with Playwright installed: node tests/tapes-browser.cjs
// All file operations use a disposable browser profile's private filesystem.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../apps/Tapes.html'), 'utf8');
const marker = '/* ===================== Init ===================== */';
assert.ok(source.includes(marker));
const html = source.replace(marker, `globalThis.TapesTest = {
  getChildEntry, getProjectDir, getRecordingBlob, renameEntry,
  removeRecordingFile, removeProjectFolder, loadRecordingMetadata,
  resumePlayback, encodeWAV, state, playerEl, useTapesFolder, startRecorder,
  closeSummaryPlayer, summary, rec, validateRecordingName
};\n${marker}`);

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const results = await page.evaluate(async () => {
      const T = TapesTest, results = [];
      const check = (value, message) => { if (!value) throw Error(message); };
      const rejects = async (fn, name) => {
        try { await fn(); } catch (e) { check(e.name === name, `${e.name} instead of ${name}`); return; }
        throw Error(`Expected ${name}`);
      };
      // Model Android providers where resolve() cannot supply usable path components.
      FileSystemDirectoryHandle.prototype.resolve = async () => { throw Error('resolve must not be used'); };
      const storage = await navigator.storage.getDirectory();
      const rootName = 'tapes-verification-' + crypto.randomUUID();
      const root = await storage.getDirectoryHandle(rootName, {create: true});
      T.state.tapesDirHandle = root;
      try {
        const directory = await root.getDirectoryHandle('Project', {create: true});
        const file = await directory.getFileHandle('voice.wav', {create: true});
        const write = async (handle, data) => {
          const stream = await handle.createWritable(); await stream.write(data); await stream.close();
        };
        const wav = T.encodeWAV(new Float32Array(8000), 8000);
        await write(file, wav);
        const project = {name: 'Project', handle: directory, recordings: []};
        const recording = {id: 'voice', stamp: 'fixture', name: 'Voice', fileName: 'voice.wav', handle: file, duration: null};
        project.recordings.push(recording); T.state.projects = [project];
        check((await T.getRecordingBlob(project, recording)).size === wav.size, 'Recording unavailable');
        const recovered = await T.getChildEntry(directory, file, 'stale-name.wav');
        check(recovered.name === 'voice.wav', 'Stale filename did not recover by identity');
        results.push('File access and stale-name recovery work without resolve()');

        const elsewhere = await root.getDirectoryHandle('Elsewhere', {create: true});
        const foreign = await elsewhere.getFileHandle('voice.wav', {create: true});
        await rejects(() => T.getChildEntry(directory, foreign), 'NotFoundError');
        await rejects(() => T.removeRecordingFile(project, {...recording, handle: foreign}), 'NotFoundError');
        check((await directory.getFileHandle('voice.wav')).kind === 'file', 'Wrong file deleted');
        const denied = {getFileHandle: async () => { throw new DOMException('Denied', 'NotAllowedError'); }};
        await rejects(() => T.getChildEntry(denied, file), 'NotAllowedError');
        results.push('Foreign same-name handles are rejected; permission errors are preserved');

        await T.loadRecordingMetadata(project, recording);
        check(!recording.audioError && Math.abs(recording.duration - 1) < .01, 'Valid WAV metadata failed');
        await write(file, 'not a WAV');
        await T.loadRecordingMetadata(project, recording, true);
        check(recording.audioErrorLabel === 'Audio decode failed', 'Decode error mislabeled');
        await write(file, wav);
        await T.loadRecordingMetadata(project, recording, true);
        check(!recording.audioError && recording.audioErrorMessage === '', 'Retry did not clear error');
        const missing = {...recording, id: 'missing', handle: foreign, duration: null};
        project.recordings.push(missing);
        await T.loadRecordingMetadata(project, missing);
        check(missing.audioErrorLabel === 'File access failed', 'Access error mislabeled');
        results.push('WAV metadata distinguishes access/decode errors and recovers on retry');

        const renamed = await T.renameEntry(directory, file, 'renamed.wav');
        check((await renamed.getFile()).size === wav.size, 'Rename changed WAV');
        await rejects(() => directory.getFileHandle('voice.wav'), 'NotFoundError');
        const movedProject = await T.renameEntry(root, directory, 'Renamed project');
        const movedFile = await movedProject.getFileHandle('renamed.wav');
        check((await movedFile.getFile()).size === wav.size, 'Project rename lost file');
        await rejects(() => root.getDirectoryHandle('Project'), 'NotFoundError');
        await T.removeRecordingFile({handle: movedProject, name: 'Renamed project'}, {handle: movedFile, fileName: 'renamed.wav'});
        await rejects(() => movedProject.getFileHandle('renamed.wav'), 'NotFoundError');
        await T.removeProjectFolder({handle: movedProject, name: 'Renamed project'});
        await rejects(() => root.getDirectoryHandle('Renamed project'), 'NotFoundError');
        results.push('File and project rename/delete preserve content and target the correct entries');

        const icon = document.createElement('span'); icon.dataset.iconFor = 'play-test'; document.body.append(icon);
        const alerts = []; window.alert = message => alerts.push(message);
        T.state.player.currentRecordingId = 'play-test';
        T.playerEl.play = async () => { throw new DOMException('Blocked', 'NotAllowedError'); };
        await T.resumePlayback('play-test');
        check(alerts.length === 1 && alerts[0].includes('NotAllowedError'), 'Playback failure not reported');
        check(icon.innerHTML.includes('<path'), 'Playback failure shows playing icon');
        T.playerEl.play = async () => {};
        await T.resumePlayback('play-test');
        check(icon.innerHTML.includes('<rect'), 'Successful play does not show pause icon');
        T.playerEl.play = async () => { throw Error('Old request'); };
        T.state.player.currentRecordingId = 'other';
        await T.resumePlayback('play-test');
        check(alerts.length === 1, 'Stale playback failure generated an alert');
        results.push('Playback failures reset the icon and show details; stale failures are ignored');
      } finally {
        await storage.removeEntry(rootName, {recursive: true});
      }
      return results;
    });
    results.forEach(result => console.log('PASS:', result));
    await page.evaluate(async () => {
      const T = TapesTest;
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle('merge-fixture', {create: true});
      const project = await folder.getDirectoryHandle('Merge project', {create: true});
      for (const [name, value] of [['First.wav', .2], ['Second.wav', .6]]) {
        const file = await project.getFileHandle(name, {create: true});
        const stream = await file.createWritable();
        await stream.write(T.encodeWAV(new Float32Array(8000).fill(value), 8000));
        await stream.close();
      }
      T.state.player.currentRecordingId = null;
      await T.useTapesFolder(folder);
      window.fixtureFolder = folder;
    });
    await page.locator('[data-project-id]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-duration-for]')].every(e => e.textContent === '00:01'));
    await page.locator('#btn-merge-recordings').click();
    // Select in reverse filename order to verify that merge follows selection order.
    const selections = page.locator('[data-merge-select]');
    await selections.filter({hasText: 'Second'}).click();
    await selections.filter({hasText: 'First'}).click();
    await page.locator('#btn-merge-selected').click();
    await page.waitForFunction(() => document.querySelector('#recorder-title').textContent === 'Save merged recording');
    assert.equal(await page.evaluate(() => TapesTest.rec.pendingDuration), 2);
    assert.equal(await page.evaluate(() => Math.round(TapesTest.rec.pendingRawSamples[0] * 10)), 6);
    assert.equal(await page.evaluate(() => Math.round(TapesTest.rec.pendingRawSamples[Math.floor(TapesTest.rec.pendingRawSamples.length * .75)] * 10)), 2);
    await page.locator('#input-recording-name').fill('Combined.wav');
    await page.locator('#btn-save-new').click();
    await page.waitForFunction(() => TapesTest.state.view === 'view-project' && TapesTest.state.projects[0].recordings.length === 3);
    const saved = await page.evaluate(async () => {
      const dir = await fixtureFolder.getDirectoryHandle('Merge project');
      const file = await (await dir.getFileHandle('Combined.wav')).getFile();
      return {size: file.size, names: [...TapesTest.state.projects[0].recordings.map(r => r.fileName)]};
    });
    assert.ok(saved.size > 44);
    assert.deepEqual(saved.names.sort(), ['Combined.wav', 'First.wav', 'Second.wav']);
    console.log('PASS: Merge preserves selection order, saves a separate WAV, and keeps both originals');
    const first = await page.evaluate(() => TapesTest.state.projects[0].recordings.find(r => r.fileName === 'First.wav').id);
    await page.evaluate(id => TapesTest.startRecorder(null, id), first);
    assert.equal(await page.locator('#recorder-title').textContent(), 'Summarise recording');
    assert.equal(await page.locator('#summary-source').isVisible(), true);
    assert.equal(await page.evaluate(() => TapesTest.summary.sourceId), first);
    for (const width of [390, 1440]) {
      await page.setViewportSize({width, height: 900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.locator('#btn-cancel-recorder').click();
    await page.waitForFunction(() => TapesTest.state.view === 'view-project');
    assert.equal(await page.evaluate(() => TapesTest.summary.sourceId), null);
    const names = await page.evaluate(() => {
      const T = TapesTest;
      const invalid = ['', '.wav', 'bad/name', 'CON', 'x'.repeat(81)];
      return {valid: T.validateRecordingName(' Example.wav '), rejected: invalid.map(name => {
        try { T.validateRecordingName(name); return false; } catch { return true; }
      })};
    });
    assert.equal(names.valid, 'Example'); assert.ok(names.rejected.every(Boolean));
    await page.evaluate(async () => {
      TapesTest.state.tapesDirHandle = null;
      await (await navigator.storage.getDirectory()).removeEntry('merge-fixture', {recursive: true});
    });
    console.log('PASS: Summary setup/cancel, mobile layout, and WAV filename validation');
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
  } finally {
    if (browser) await browser.close();
    await new Promise(r => server.close(r));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
