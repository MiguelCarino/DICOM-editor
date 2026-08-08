// Edits belong to the file they were made on.
//
// The working copy of a dataset is seeded with every editable tag at its current
// value, so it is not a list of changes — it is a whole second dataset. One of
// those shared between files is not a stale-UI problem, it is a file that gets
// written with another file's identity. This suite loads a small study through
// the real drop handler and checks that each file keeps its own.
window.addEventListener('load', () => (async () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);
  const report = () => {
    const pre = document.createElement('pre');
    pre.id = 'TESTOUT';
    pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  };
  // The app's own formatter, so a PN element reads the same here as it does in
  // the working copy we are comparing against.
  const tag = (d, t) => { const e = lookupTag(d, t); return e ? elToString(e).trim() : ''; };

  try {
    // A three-slice series: one study, one series, three instances that differ
    // only in the ways slices of a real series differ.
    const studyUID = '1.2.826.0.1.3680043.10.99999.7.1';
    const seriesUID = '1.2.826.0.1.3680043.10.99999.7.2';
    const slices = [0, 1, 2].map((i) => {
      const n = Forge.W * Forge.H;
      const px = new Uint16Array(n);
      for (let k = 0; k < n; k++) px[k] = (k + i * 500) & 0xFFF;
      return Forge.build({
        rows: Forge.H, cols: Forge.W, pi: 'MONOCHROME2', ba: 16, bs: 12, hb: 11, pr: 0,
        wc: 2048, ww: 4096, modality: 'CT',
        studyUID, seriesUID, instance: i + 1,
        sopInstance: `1.2.826.0.1.3680043.10.99999.7.3.${i + 1}`,
        pixels: px,
      });
    });

    // Through the real handler, not a hand-built files[] — the seeding lives there.
    await handleFiles(slices.map((b, i) => new File([b], `slice${i + 1}.dcm`, { type: 'application/dicom' })));

    ok('three files load', files.length === 3, String(files.length));
    ok('each file carries its own working copy',
       files.length === 3 && new Set(files.map(f => f.pending)).size === 3 && files.every(f => f.pending instanceof Map),
       files.map(f => (f.pending ? f.pending.size : 'none')).join(','));
    ok('pendingEdits points at the file on screen', pendingEdits === files[0].pending);

    // ---- an edit on one file stays on that file ------------------------------
    // editKey resolves whichever key form this dcmjs build produced.
    const NAME = editKey('00100010');
    ok('the working copy is keyed the same way the dataset is',
       files[0].pending.has(NAME), NAME);
    pendingEdits.set(NAME, { vr: 'PN', valueString: 'Edited^SliceOne' });

    switchFile(1);
    ok('switching files moves the pointer', pendingEdits === files[1].pending);
    ok('the edit does not follow the switch',
       pendingEdits.get(NAME).valueString === 'Forge^Test', pendingEdits.get(NAME).valueString);

    switchFile(0);
    ok('and it is still there when we come back',
       pendingEdits.get(NAME).valueString === 'Edited^SliceOne', pendingEdits.get(NAME).valueString);

    // ---- what actually gets written -----------------------------------------
    const written = [];
    for (const f of files) {
      const buf = await buildEditedFile(f).arrayBuffer();
      const msg = DicomMessage.readFile(buf);
      normBin(msg.dict);
      written.push(msg.dict);
    }

    ok('the edited file is the one that was edited',
       tag(written[0], '00100010') === 'Edited^SliceOne', tag(written[0], '00100010'));
    for (let i = 1; i < 3; i++) {
      ok(`slice ${i + 1} is not overwritten with slice 1's name`,
         tag(written[i], '00100010') === 'Forge^Test', tag(written[i], '00100010'));
    }

    // PersonName is its own shape in DICOM, and the writer used to be handed an
    // object it stringified — putting the text "[object Object]" in the file as
    // the patient's name while the editor kept displaying it correctly.
    ok('an edited PersonName is not stringified into the file',
       !/\[object/.test(tag(written[0], '00100010')), tag(written[0], '00100010'));

    // The one that corrupts a series: every slice writing slice 1's identity.
    const sops = written.map(d => tag(d, '00080018'));
    ok('every slice keeps its own SOP Instance UID', new Set(sops).size === 3, sops.join(' | '));
    const nums = written.map(d => tag(d, '00200013'));
    ok('every slice keeps its own Instance Number', nums.join(',') === '1,2,3', nums.join(','));
    ok('they still share one Series Instance UID',
       new Set(written.map(d => tag(d, '0020000e'))).size === 1);

    // ---- bulk rewrites reseed every working copy, not just the visible one ----
    switchFile(0);
    const beforeIds = files.map(f => tag(f.dict, '00100020'));
    files.forEach(f => anonymize(f.dict));
    reseedAllPending();
    const stale = files.filter(f => f.pending.get(editKey('00100020'))?.valueString !== tag(f.dict, '00100020'));
    ok('anonymizing refreshes every file\'s working copy', stale.length === 0,
       stale.map(f => f.name).join(','));
    ok('anonymize actually changed the identifiers',
       files.every((f, i) => tag(f.dict, '00100020') !== beforeIds[i]),
       files.map(f => tag(f.dict, '00100020')).join(','));

    // ---- the Window/Level sliders write the tag, not a lookalike -------------
    // setWL used to store a hard-coded "x0028105x" key. On a dataset keyed
    // without the prefix that added a second entry the writer then emitted
    // alongside the real Window Center, and the slider never read its own value
    // back. Both symptoms come from the same mismatch.
    switchFile(0);
    setWL(275, 850);
    const wcKey = editKey('00281050'), wwKey = editKey('00281051');
    ok('the slider edits the Window Center already in the file',
       files[0].pending.get(wcKey)?.valueString === '275', String(files[0].pending.get(wcKey)?.valueString));
    const strays = [...files[0].pending.keys()].filter(k => !files[0].dict[k]);
    ok('and does not invent a second key for it', strays.length === 0, strays.join(','));

    const back = DicomMessage.readFile(await buildEditedFile(files[0]).arrayBuffer());
    normBin(back.dict);
    ok('the written file carries the new window', tag(back.dict, '00281050') === '275',
       tag(back.dict, '00281050'));
    ok('the written file has one Window Center, not two',
       Object.keys(back.dict).filter(k => /00281050$/i.test(k)).length === 1,
       Object.keys(back.dict).filter(k => /00281050$/i.test(k)).join(','));
    // ---- the exported tag list has to answer "why will this not render?" ----
    switchFile(0);
    const exported = getExportRows();
    ok('the tag export carries the Transfer Syntax UID',
       exported.some(r => r.tag === '(0002,0010)'),
       exported.filter(r => r.tag.startsWith('(0002')).length + ' File Meta rows');
    ok('and still carries the dataset',
       exported.some(r => r.tag === '(0010,0010)'), String(exported.length));
  } catch (e) {
    ok('suite ran to completion', false, (e && e.stack ? e.stack.split('\n')[0] : String(e)));
  }

  report();
})());
