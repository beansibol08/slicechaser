// SliceChaser editor UI.
(function () {
  'use strict';
  var api = window.sliceChaser;
  var Geom = window.SCGeom, Ao = window.SCAo, Patterns = window.SCPatterns, Chase = window.SCChase;
  var $ = function (id) { return document.getElementById(id); };

  var COLORS = {
    compBg: '#0f1420', line: '#36415c', ink: '#e4e8f2', muted: '#8f9ab3',
    tungsten: '255,180,74', cyan: '#63d0ea', litText: '#3b2600'
  };

  var state = {
    env: null,
    sources: [],
    sourcePath: null,
    comp: { width: 1920, height: 1080 },
    slices: [],          // { key, name, screen, enabled, geom }
    skipped: [],
    sequences: [],       // { id, name, steps: [[key]] }
    nextId: 1,
    seqId: null,
    step: 0,
    renaming: null,
    hoverKey: null,
    preview: { playing: false, start: 0, bpm: 128, beats: 4, echoes: 1, sustain: 0.2, release: 0.8 },
    dirty: false
  };
  var undoStack = [], redoStack = [];
  var saveTimer = null;
  var view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0 }; // canvas mapping, CSS pixels

  // ------------------------------------------------------------------ helpers
  function currentSeq() {
    return state.sequences.find(function (q) { return q.id === state.seqId; }) || null;
  }
  function currentStepKeys() {
    var q = currentSeq();
    return q && q.steps[state.step] ? q.steps[state.step] : null;
  }
  function sliceByKey(key) {
    return state.slices.find(function (s) { return s.key === key; });
  }
  function clampStep() {
    var q = currentSeq();
    var n = q ? q.steps.length : 0;
    state.step = n ? Math.min(Math.max(state.step, 0), n - 1) : 0;
  }
  function uniqueName(base) {
    var names = state.sequences.map(function (q) { return q.name; });
    if (names.indexOf(base) < 0) return base;
    for (var i = 2; ; i++) if (names.indexOf(base + ' ' + i) < 0) return base + ' ' + i;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ undo + save
  function snapshot() {
    return JSON.stringify({ sequences: state.sequences, seqId: state.seqId, step: state.step, nextId: state.nextId });
  }
  function restore(s) {
    var o = JSON.parse(s);
    state.sequences = o.sequences; state.seqId = o.seqId; state.step = o.step; state.nextId = o.nextId;
    clampStep();
    renderAll();
    scheduleSave();
  }
  function beginChange() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
  }
  function mutate(fn) {
    beginChange();
    fn();
    clampStep();
    renderAll();
    scheduleSave();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  function scheduleSave() {
    state.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }
  function save() {
    if (!api) return;
    var file = Chase.buildFile(state.comp, state.slices, state.sequences, {
      sourcePath: state.sourcePath,
      nextId: state.nextId,
      currentSequence: state.seqId,
      preview: { bpm: state.preview.bpm, beats: state.preview.beats, echoes: state.preview.echoes, sustain: state.preview.sustain, release: state.preview.release }
    });
    api.writeChase(JSON.stringify(file)).then(function () {
      state.dirty = false;
      setSaveStatus('ok', 'Saved ' + new Date().toLocaleTimeString());
    }, function (err) {
      setSaveStatus('error', 'Could not save: ' + (err && err.message ? err.message : err));
    });
  }
  function setSaveStatus(kind, text) {
    $('saveStatus').className = 'save ' + kind;
    $('saveText').textContent = text;
  }

  // ------------------------------------------------------------------ loading
  function applySlices(parsed) {
    state.comp = { width: parsed.compWidth, height: parsed.compHeight };
    var skipped = parsed.skipped.slice();
    state.slices = [];
    parsed.slices.forEach(function (s) {
      var g = Geom.buildSliceGeometry(s, parsed.compWidth, parsed.compHeight);
      if (!g) { skipped.push(s.name); return; }
      state.slices.push({ key: s.key, name: s.name, screen: s.screen, enabled: s.enabled, geom: g });
    });
    state.skipped = skipped;
  }

  function loadSource(path, opts) {
    opts = opts || {};
    return api.readText(path).then(function (text) {
      var parsed = Ao.parseAdvancedOutput(text);
      if (!parsed.slices.length && !opts.quiet) {
        throw new Error('No slices found in this file.');
      }
      applySlices(parsed);
      state.sourcePath = path;
      api.watchSource(path);
      renderAll();
      scheduleSave(); // push fresh geometry to Resolume
    }).catch(function (err) {
      if (!opts.quiet) setSaveStatus('error', 'Could not read ' + baseName(path) + ': ' + (err.message || err));
      renderAll();
      throw err;
    });
  }

  function baseName(p) { return String(p).split(/[\\/]/).pop(); }

  function refreshSources() {
    return api.listSources().then(function (list) {
      state.sources = list;
      renderSources();
    });
  }

  function init() {
    if (!api) { renderAll(); return; }
    api.onSourceChanged(function (file) {
      if (file === state.sourcePath) loadSource(file, { quiet: true }).catch(function () {});
    });
    Promise.all([api.env(), api.readChase(), api.listSources()]).then(function (res) {
      state.env = res[0];
      state.sources = res[2];
      $('saveStatus').title = state.env.chaseFile;
      var saved = null;
      if (res[1]) {
        try { saved = Chase.readFile(res[1]); } catch (e) { setSaveStatus('error', 'chases.json is damaged; it will be replaced on the next save'); }
      }
      if (saved) {
        state.sequences = saved.sequences;
        state.comp = saved.comp;
        state.slices = saved.slices.map(function (s) { s.enabled = true; return s; });
        var ed = saved.editor || {};
        state.nextId = Math.max(ed.nextId || 1, 1 + state.sequences.reduce(function (m, q) { return Math.max(m, q.id); }, 0));
        state.seqId = state.sequences.some(function (q) { return q.id === ed.currentSequence; }) ? ed.currentSequence : (state.sequences[0] ? state.sequences[0].id : null);
        if (ed.preview) Object.assign(state.preview, ed.preview, { playing: false });
        state.sourcePath = ed.sourcePath || null;
        setSaveStatus('ok', 'Loaded chases.json');
      }
      syncPreviewInputs();
      var candidates = [];
      if (state.sourcePath) candidates.push(state.sourcePath);
      var live = state.sources.find(function (s) { return s.live; });
      if (live) candidates.push(live.path);
      if (state.sources[0]) candidates.push(state.sources[0].path);
      var tryNext = function (i) {
        if (i >= candidates.length) { renderAll(); return; }
        loadSource(candidates[i], { quiet: true }).catch(function () { tryNext(i + 1); });
      };
      tryNext(0);
      renderAll();
    });
  }

  // ------------------------------------------------------------------ rendering
  function renderAll() {
    renderSources();
    renderSequences();
    renderSteps();
    renderSliceList();
    renderStage();
    renderButtons();
  }

  function renderSources() {
    var sel = $('sourceSelect');
    sel.textContent = '';
    var paths = state.sources.map(function (s) { return s.path; });
    if (state.sourcePath && paths.indexOf(state.sourcePath) < 0) {
      var o = el('option', null, 'File: ' + baseName(state.sourcePath));
      o.value = state.sourcePath;
      sel.appendChild(o);
    }
    state.sources.forEach(function (s) {
      var o = el('option', null, s.label);
      o.value = s.path;
      o.title = s.path;
      sel.appendChild(o);
    });
    if (!sel.options.length) {
      var none = el('option', null, 'No Advanced Output file found');
      none.value = '';
      sel.appendChild(none);
    }
    sel.value = state.sourcePath || '';
    sel.title = state.sourcePath || '';
  }

  function renderSequences() {
    var list = $('seqList');
    list.textContent = '';
    if (!state.sequences.length) {
      list.appendChild(el('li', 'empty-list', 'No sequences yet. Click New, or generate one below.'));
      return;
    }
    state.sequences.forEach(function (q) {
      var li = el('li', q.id === state.seqId ? 'active' : '');
      li.dataset.id = q.id;
      if (state.renaming === q.id) {
        var input = el('input');
        input.value = q.name;
        input.setAttribute('aria-label', 'Sequence name');
        var done = false;
        var commit = function (keep) {
          if (done) return;
          done = true;
          var name = input.value.trim();
          state.renaming = null;
          if (keep && name && name !== q.name) mutate(function () { q.name = name; });
          else renderAll();
        };
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') commit(true);
          if (e.key === 'Escape') commit(false);
          e.stopPropagation();
        });
        input.addEventListener('blur', function () { commit(true); });
        li.appendChild(input);
        list.appendChild(li);
        setTimeout(function () { input.focus(); input.select(); }, 0);
        return;
      }
      li.appendChild(el('span', 'seq-name', q.name));
      li.appendChild(el('span', 'seq-steps', q.steps.length + (q.steps.length === 1 ? ' step' : ' steps')));
      li.title = 'Double-click to rename';
      li.addEventListener('click', function () {
        if (state.seqId === q.id) return;
        state.seqId = q.id;
        state.step = 0;
        renderAll();
        scheduleSave();
      });
      li.addEventListener('dblclick', function () { state.renaming = q.id; renderSequences(); });
      list.appendChild(li);
    });
  }

  function renderButtons() {
    var q = currentSeq();
    var idx = q ? state.sequences.indexOf(q) : -1;
    var hasSteps = !!(q && q.steps.length);
    $('dupSeq').disabled = !q;
    $('renameSeq').disabled = !q;
    $('delSeq').disabled = !q;
    $('upSeq').disabled = idx <= 0;
    $('downSeq').disabled = !q || idx >= state.sequences.length - 1;
    $('addStep').disabled = false;
    $('dupStep').disabled = !hasSteps;
    $('clearStep').disabled = !hasSteps;
    $('delStep').disabled = !hasSteps;
    $('leftStep').disabled = !hasSteps || state.step === 0;
    $('rightStep').disabled = !hasSteps || state.step >= q.steps.length - 1;
    $('allOn').disabled = !state.slices.length;
    $('allOff').disabled = !hasSteps;
    $('genNew').disabled = !state.slices.length;
    $('genReplace').disabled = !state.slices.length || !q;
    $('playBtn').disabled = !hasSteps;
  }

  // --- stage canvas
  function fitStage() {
    var wrap = $('stageWrap');
    var cs = getComputedStyle(wrap);
    var availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var aspect = state.comp.width / state.comp.height;
    var w = Math.max(10, Math.min(availW, availH * aspect));
    var h = w / aspect;
    var canvas = $('stage');
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    view.w = w; view.h = h;
  }

  function tracePath(ctx, outline, w, h) {
    ctx.beginPath();
    outline.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(p[0] * w, p[1] * h);
      else ctx.lineTo(p[0] * w, p[1] * h);
    });
    ctx.closePath();
  }

  // opacity: function(key) -> 0..1
  function drawSlices(ctx, w, h, opacity, opts) {
    opts = opts || {};
    ctx.fillStyle = COLORS.compBg;
    ctx.fillRect(0, 0, w, h);
    var unlit = [], lit = [];
    state.slices.forEach(function (s) {
      var o = opacity(s.key);
      (o > 0.001 ? lit : unlit).push([s, o]);
    });
    unlit.forEach(function (pair) {
      var s = pair[0];
      tracePath(ctx, s.geom.outline, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fill();
      if (opts.detail) {
        ctx.setLineDash(s.enabled === false ? [4, 3] : []);
        ctx.strokeStyle = COLORS.line;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    lit.forEach(function (pair) {
      var s = pair[0], o = pair[1];
      tracePath(ctx, s.geom.outline, w, h);
      ctx.save();
      ctx.shadowColor = 'rgba(' + COLORS.tungsten + ',' + (0.85 * o) + ')';
      ctx.shadowBlur = opts.detail ? 22 * o : 4 * o;
      ctx.fillStyle = 'rgba(' + COLORS.tungsten + ',' + o + ')';
      ctx.fill();
      ctx.restore();
      if (opts.detail) {
        ctx.strokeStyle = 'rgba(' + COLORS.tungsten + ',1)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
    if (opts.detail) {
      if (state.hoverKey) {
        var hs = sliceByKey(state.hoverKey);
        if (hs) {
          tracePath(ctx, hs.geom.outline, w, h);
          ctx.strokeStyle = COLORS.cyan;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.font = '11px system-ui, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      state.slices.forEach(function (s) {
        var xs = s.geom.outline.map(function (p) { return p[0] * w; });
        var ys = s.geom.outline.map(function (p) { return p[1] * h; });
        var bw = Math.max.apply(null, xs) - Math.min.apply(null, xs);
        var bh = Math.max.apply(null, ys) - Math.min.apply(null, ys);
        var tw = ctx.measureText(s.name).width;
        if (tw + 8 > bw || bh < 16) return;
        ctx.fillStyle = opacity(s.key) > 0.5 ? COLORS.litText : COLORS.muted;
        ctx.fillText(s.name, s.geom.center[0] * w, s.geom.center[1] * h);
      });
    }
  }

  var previewOpacity = null; // set while playing
  function renderStage() {
    var empty = $('emptyStage');
    var canvas = $('stage');
    if (!state.slices.length) {
      canvas.hidden = true;
      empty.hidden = false;
      $('emptyText').textContent = !api
        ? 'This page needs the SliceChaser app to read your files.'
        : state.sources.length
          ? 'The selected file has no slices. Add slices in Arena\'s Advanced Output, or pick another file.'
          : 'No Advanced Output setup found. Open Advanced Output in Resolume Arena once so it saves your slices, then press Reload, or open a preset file.';
      $('sliceCount').textContent = '';
      return;
    }
    canvas.hidden = false;
    empty.hidden = true;
    fitStage();
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var keys = currentStepKeys() || [];
    var on = {};
    keys.forEach(function (k) { on[k] = 1; });
    drawSlices(ctx, view.w, view.h, previewOpacity ? function (k) { return previewOpacity[k] || 0; } : function (k) { return on[k] || 0; }, { detail: true });
  }

  // --- steps lane
  function stepThumbSize() {
    var aspect = state.comp.width / state.comp.height;
    var h = 44, w = Math.round(h * aspect);
    if (w > 110) { w = 110; h = Math.round(w / aspect); }
    if (w < 30) w = 30;
    return { w: w, h: h };
  }

  function renderSteps() {
    var ol = $('steps');
    ol.textContent = '';
    var q = currentSeq();
    if (!q) {
      ol.appendChild(el('li', 'hint', 'Pick or create a sequence to edit its steps.'));
      return;
    }
    var size = stepThumbSize();
    var dpr = window.devicePixelRatio || 1;
    q.steps.forEach(function (keys, i) {
      var li = el('li', i === state.step ? 'current' : '');
      li.dataset.index = i;
      li.setAttribute('aria-label', 'Step ' + (i + 1) + ', ' + keys.length + ' slices');
      var c = document.createElement('canvas');
      c.width = size.w * dpr; c.height = size.h * dpr;
      c.style.width = size.w + 'px'; c.style.height = size.h + 'px';
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var on = {};
      keys.forEach(function (k) { on[k] = 1; });
      drawSlices(ctx, size.w, size.h, function (k) { return on[k] || 0; }, { detail: false });
      li.appendChild(c);
      li.appendChild(el('span', 'step-num', String(i + 1)));
      li.addEventListener('click', function () { selectStep(i); });
      ol.appendChild(li);
    });
    var add = el('li', 'add-cell', '+');
    add.title = 'Add step';
    add.setAttribute('aria-label', 'Add step');
    add.style.height = (size.h + 30) + 'px';
    add.addEventListener('click', addStep);
    ol.appendChild(add);
    var cur = ol.children[state.step];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function selectStep(i) {
    state.step = i;
    clampStep();
    renderSteps();
    renderSliceList();
    renderStage();
    renderButtons();
  }

  // --- slice list
  function renderSliceList() {
    var ul = $('sliceList');
    ul.textContent = '';
    $('sliceCount').textContent = state.slices.length ? String(state.slices.length) : '';
    var keys = currentStepKeys();
    var on = {};
    (keys || []).forEach(function (k) { on[k] = true; });
    var lastScreen = null;
    state.slices.forEach(function (s) {
      if (s.screen !== lastScreen) {
        ul.appendChild(el('li', 'screen-name', s.screen));
        lastScreen = s.screen;
      }
      var li = el('li');
      var label = el('label', s.key === state.hoverKey ? 'hover' : '');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !!on[s.key];
      cb.addEventListener('change', function () { setSlices([s.key], cb.checked, true); });
      label.appendChild(cb);
      label.appendChild(el('span', 'slice-name' + (s.enabled === false ? ' off' : ''), s.name));
      if (s.enabled === false) label.title = 'Disabled in Advanced Output';
      label.addEventListener('mouseenter', function () { state.hoverKey = s.key; renderStage(); });
      label.addEventListener('mouseleave', function () { state.hoverKey = null; renderStage(); });
      li.appendChild(label);
      ul.appendChild(li);
    });
    var notes = [];
    if (state.skipped.length) notes.push('Could not read ' + state.skipped.length + ' slice' + (state.skipped.length > 1 ? 's' : '') + ': ' + state.skipped.join(', ') + '.');
    var known = {};
    state.slices.forEach(function (s) { known[s.key] = true; });
    var missing = {};
    state.sequences.forEach(function (q) { q.steps.forEach(function (st) { st.forEach(function (k) { if (!known[k]) missing[k] = true; }); }); });
    var nMissing = Object.keys(missing).length;
    if (nMissing) notes.push(nMissing + ' slice' + (nMissing > 1 ? 's' : '') + ' used in sequences ' + (nMissing > 1 ? 'are' : 'is') + ' not in this setup and will be skipped.');
    $('skippedNote').hidden = !notes.length;
    $('skippedNote').textContent = notes.join(' ');
  }

  // ------------------------------------------------------------------ editing
  function ensureStep() {
    // Editing on an empty canvas creates what's needed instead of refusing.
    if (!currentSeq()) {
      var q = { id: state.nextId++, name: uniqueName('Sequence'), steps: [[]] };
      state.sequences.push(q);
      state.seqId = q.id;
      state.step = 0;
    }
    var cur = currentSeq();
    if (!cur.steps.length) { cur.steps.push([]); state.step = 0; }
  }

  function setSlices(keys, on, record) {
    var apply = function () {
      ensureStep();
      var step = currentSeq().steps[state.step];
      keys.forEach(function (k) {
        var i = step.indexOf(k);
        if (on && i < 0) step.push(k);
        if (!on && i >= 0) step.splice(i, 1);
      });
    };
    if (record) mutate(apply);
    else { apply(); renderStage(); }
  }

  function addStep() {
    mutate(function () {
      ensureStepSeqOnly();
      var q = currentSeq();
      var at = q.steps.length ? state.step + 1 : 0;
      q.steps.splice(at, 0, []);
      state.step = at;
    });
  }
  function ensureStepSeqOnly() {
    if (!currentSeq()) {
      var q = { id: state.nextId++, name: uniqueName('Sequence'), steps: [] };
      state.sequences.push(q);
      state.seqId = q.id;
    }
  }

  function generate(replace) {
    var id = $('patternSelect').value;
    var pattern = Patterns.PATTERNS.find(function (p) { return p.id === id; });
    var pool = state.slices.filter(function (s) { return !$('enabledOnly').checked || s.enabled !== false; });
    var input = pool.map(function (s) { return { key: s.key, center: s.geom.center }; });
    var steps = Patterns.generate(id, input, { merge: $('mergeAligned').checked, seed: Math.floor(Math.random() * 1e9) });
    if (!steps.length) { setSaveStatus('error', 'No slices to build a sequence from'); return; }
    mutate(function () {
      if (replace && currentSeq()) {
        currentSeq().steps = steps;
      } else {
        var q = { id: state.nextId++, name: uniqueName(pattern.name), steps: steps };
        state.sequences.push(q);
        state.seqId = q.id;
      }
      state.step = 0;
    });
  }

  // ------------------------------------------------------------------ stage input
  function hitTest(evt) {
    var rect = $('stage').getBoundingClientRect();
    var p = [(evt.clientX - rect.left) / rect.width, (evt.clientY - rect.top) / rect.height];
    var best = null;
    state.slices.forEach(function (s) {
      if (Geom.pointInPolygon(p, s.geom.outline) && (!best || s.geom.area < best.geom.area)) best = s;
    });
    return best;
  }

  var paint = null; // { on, touched }
  function onPointerDown(evt) {
    if (evt.button !== 0) return;
    if (state.preview.playing) stopPreview();
    var s = hitTest(evt);
    if (!s) return;
    var keys = currentStepKeys();
    var on = !(keys && keys.indexOf(s.key) >= 0);
    beginChange();
    paint = { on: on, touched: {} };
    paint.touched[s.key] = true;
    setSlices([s.key], on, false);
    $('stage').setPointerCapture(evt.pointerId);
  }
  function onPointerMove(evt) {
    var s = hitTest(evt);
    var key = s ? s.key : null;
    if (key !== state.hoverKey) {
      state.hoverKey = key;
      $('hoverName').hidden = !s;
      if (s) $('hoverName').textContent = s.name + (s.screen ? '  (' + s.screen + ')' : '');
      if (!paint) { renderStage(); highlightListHover(); }
    }
    if (paint && s && !paint.touched[s.key]) {
      paint.touched[s.key] = true;
      setSlices([s.key], paint.on, false);
    }
  }
  function onPointerUp() {
    if (!paint) return;
    paint = null;
    clampStep();
    renderAll();
    scheduleSave();
  }
  function highlightListHover() {
    var labels = $('sliceList').querySelectorAll('label');
    var i = 0;
    state.slices.forEach(function (s) {
      if (labels[i]) labels[i].classList.toggle('hover', s.key === state.hoverKey);
      i++;
    });
  }

  // ------------------------------------------------------------------ preview
  var rafId = 0;
  function startPreview() {
    var q = currentSeq();
    if (!q || !q.steps.length) return;
    state.preview.playing = true;
    state.preview.start = performance.now();
    $('playBtn').setAttribute('aria-pressed', 'true');
    $('playBtn').textContent = 'Stop';
    tick();
  }
  function stopPreview() {
    state.preview.playing = false;
    cancelAnimationFrame(rafId);
    previewOpacity = null;
    $('playBtn').setAttribute('aria-pressed', 'false');
    $('playBtn').textContent = 'Play';
    var lis = $('steps').children;
    for (var i = 0; i < lis.length; i++) lis[i].classList.remove('playing');
    renderStage();
  }
  function tick() {
    var q = currentSeq();
    if (!state.preview.playing || !q || !q.steps.length) { stopPreview(); return; }
    var p = state.preview;
    var beats = ((performance.now() - p.start) / 60000) * Math.max(p.bpm, 1);
    var loop = Math.max(p.beats, 0.25);
    var step01 = (beats % loop) / loop;
    previewOpacity = Chase.chaserOpacities(q.steps, step01, p.echoes, p.sustain, p.release);
    renderStage();
    var playing = Math.min(Math.floor(step01 * q.steps.length), q.steps.length - 1);
    var lis = $('steps').children;
    for (var i = 0; i < lis.length; i++) lis[i].classList.toggle('playing', i === playing);
    rafId = requestAnimationFrame(tick);
  }
  function syncPreviewInputs() {
    $('bpm').value = state.preview.bpm;
    $('beats').value = state.preview.beats;
    $('echoes').value = state.preview.echoes;
    $('sustain').value = state.preview.sustain;
    $('release').value = state.preview.release;
  }
  function readPreviewInputs() {
    var num = function (id, def) { var v = parseFloat($(id).value); return isFinite(v) ? v : def; };
    state.preview.bpm = Math.min(Math.max(num('bpm', 128), 20), 300);
    state.preview.beats = Math.min(Math.max(num('beats', 4), 0.25), 64);
    state.preview.echoes = Math.round(Math.min(Math.max(num('echoes', 1), 1), 16));
    state.preview.sustain = num('sustain', 0.2);
    state.preview.release = num('release', 0.8);
  }

  // ------------------------------------------------------------------ wiring
  function moveSeq(delta) {
    var q = currentSeq();
    var i = state.sequences.indexOf(q), j = i + delta;
    if (!q || j < 0 || j >= state.sequences.length) return;
    mutate(function () { state.sequences.splice(i, 1); state.sequences.splice(j, 0, q); });
  }
  function moveStep(delta) {
    var q = currentSeq();
    if (!q) return;
    var i = state.step, j = i + delta;
    if (j < 0 || j >= q.steps.length) return;
    mutate(function () { var s = q.steps.splice(i, 1)[0]; q.steps.splice(j, 0, s); state.step = j; });
  }
  function duplicateStep() {
    var q = currentSeq();
    if (!q || !q.steps.length) return;
    mutate(function () { q.steps.splice(state.step + 1, 0, q.steps[state.step].slice()); state.step++; });
  }
  function deleteStep() {
    var q = currentSeq();
    if (!q || !q.steps.length) return;
    mutate(function () { q.steps.splice(state.step, 1); if (state.step >= q.steps.length) state.step = q.steps.length - 1; });
  }

  function wire() {
    Patterns.PATTERNS.forEach(function (p) {
      var o = el('option', null, p.name);
      o.value = p.id;
      $('patternSelect').appendChild(o);
    });

    $('sourceSelect').addEventListener('change', function (e) {
      if (e.target.value) loadSource(e.target.value).catch(function () {});
    });
    var open = function () {
      api.chooseSource().then(function (p) { if (p) loadSource(p).catch(function () {}); });
    };
    $('openSource').addEventListener('click', open);
    $('emptyOpen').addEventListener('click', open);
    $('reloadSource').addEventListener('click', function () {
      refreshSources().then(function () {
        var target = state.sourcePath || (state.sources[0] && state.sources[0].path);
        if (target) loadSource(target).catch(function () {});
        else renderAll();
      });
    });
    $('revealFile').addEventListener('click', function () { if (state.dirty) save(); api.revealChase(); });

    $('newSeq').addEventListener('click', function () {
      mutate(function () {
        var q = { id: state.nextId++, name: uniqueName('Sequence'), steps: [[]] };
        state.sequences.push(q);
        state.seqId = q.id;
        state.step = 0;
        state.renaming = q.id;
      });
    });
    $('dupSeq').addEventListener('click', function () {
      var src = currentSeq();
      if (!src) return;
      mutate(function () {
        var q = { id: state.nextId++, name: uniqueName(src.name + ' copy'), steps: src.steps.map(function (s) { return s.slice(); }) };
        state.sequences.splice(state.sequences.indexOf(src) + 1, 0, q);
        state.seqId = q.id;
      });
    });
    $('renameSeq').addEventListener('click', function () {
      if (currentSeq()) { state.renaming = state.seqId; renderSequences(); }
    });
    $('delSeq').addEventListener('click', function () {
      var q = currentSeq();
      if (!q) return;
      mutate(function () {
        var i = state.sequences.indexOf(q);
        state.sequences.splice(i, 1);
        var next = state.sequences[Math.min(i, state.sequences.length - 1)];
        state.seqId = next ? next.id : null;
        state.step = 0;
      });
      setSaveStatus('ok', 'Deleted "' + q.name + '". Ctrl+Z brings it back.');
    });
    $('upSeq').addEventListener('click', function () { moveSeq(-1); });
    $('downSeq').addEventListener('click', function () { moveSeq(1); });

    $('genNew').addEventListener('click', function () { generate(false); });
    $('genReplace').addEventListener('click', function () { generate(true); });

    $('addStep').addEventListener('click', addStep);
    $('dupStep').addEventListener('click', duplicateStep);
    $('clearStep').addEventListener('click', function () {
      var q = currentSeq();
      if (q && q.steps[state.step]) mutate(function () { q.steps[state.step] = []; });
    });
    $('delStep').addEventListener('click', deleteStep);
    $('leftStep').addEventListener('click', function () { moveStep(-1); });
    $('rightStep').addEventListener('click', function () { moveStep(1); });
    $('allOn').addEventListener('click', function () {
      setSlices(state.slices.map(function (s) { return s.key; }), true, true);
    });
    $('allOff').addEventListener('click', function () {
      var q = currentSeq();
      if (q && q.steps[state.step]) mutate(function () { q.steps[state.step] = []; });
    });

    $('playBtn').addEventListener('click', function () {
      if (state.preview.playing) stopPreview(); else startPreview();
    });
    ['bpm', 'beats', 'echoes', 'sustain', 'release'].forEach(function (id) {
      $(id).addEventListener('input', function () { readPreviewInputs(); scheduleSave(); });
    });

    var canvas = $('stage');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', function () {
      if (paint) return;
      state.hoverKey = null;
      $('hoverName').hidden = true;
      renderStage();
      highlightListHover();
    });

    window.addEventListener('resize', function () { renderStage(); });
    window.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      var typing = tag === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range' || tag === 'SELECT' || tag === 'TEXTAREA';
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if (typing) return;
      if (e.key === ' ' && tag === 'BUTTON') return; // the button's own click handles it
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateStep(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); selectStep(state.step + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); selectStep(state.step - 1); }
      else if (e.key === ' ') { e.preventDefault(); if (state.preview.playing) stopPreview(); else startPreview(); }
      else if (e.key.toLowerCase() === 'n' && !mod) { e.preventDefault(); addStep(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteStep(); }
    });
  }

  wire();
  init();

  // exposed for automated tests only
  window.__sliceChaserState = state;
})();
