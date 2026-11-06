/* ------------------------------------------------------------------
   ui.js  ·  Dibujo, edicion con el ratón o el dedo, y controles
------------------------------------------------------------------ */
(function () {
  'use strict';

  const Flow = window.Flow;
  const Expr = window.FlowExpr;
  const Geo = window.FlowGeo;
  const Examples = window.FlowExamples;
  const Store = window.FlowStore;
  const Exporter = window.FlowExport;
  const Py = window.FlowPy;

  const STORE_GRAPH = 'diagramador.diagrama.v1';
  const STORE_PREFS = 'diagramador.preferencias.v1';
  const GRID = 10;
  const MIN_W = 2400;
  const MIN_H = 1600;
  const MAX_LOG = 600;

  const $ = function (id) { return document.getElementById(id); };

  const els = {
    title: $('title'),
    palette: $('palette'),
    canvasWrap: $('canvasWrap'),
    canvasInner: $('canvasInner'),
    zoomLayer: $('zoomLayer'),
    edges: $('edges'),
    nodes: $('nodes'),
    editorLayer: $('editorLayer'),
    overlayLayer: $('overlayLayer'),
    emptyHint: $('emptyHint'),
    varsBody: $('varsBody'),
    consoleBody: $('consoleBody'),
    statusChip: $('statusChip'),
    statusText: $('statusText'),
    stepCount: $('stepCount'),
    problemsBtn: $('problemsBtn'),
    zoomValue: $('zoomValue'),
    speed: $('speed'),
    speedLabel: $('speedLabel'),
    trace: $('trace'),
    btnStep: $('btnStep'),
    btnRun: $('btnRun'),
    btnReset: $('btnReset'),
    btnClearConsole: $('btnClearConsole'),
    btnNew: $('btnNew'),
    btnSave: $('btnSave'),
    btnLibrary: $('btnLibrary'),
    menuLibrary: $('menuLibrary'),
    btnFile: $('btnFile'),
    menuFile: $('menuFile'),
    btnExamples: $('btnExamples'),
    menuExamples: $('menuExamples'),
    btnTheme: $('btnTheme'),
    btnPython: $('btnPython'),
    pyPanel: $('pyPanel'),
    pyBody: $('pyBody'),
    pyNotes: $('pyNotes'),
    btnPyCopy: $('btnPyCopy'),
    btnPyDownload: $('btnPyDownload'),
    btnPyClose: $('btnPyClose'),
    btnHelp: $('btnHelp'),
    btnZoomIn: $('btnZoomIn'),
    btnZoomOut: $('btnZoomOut'),
    btnZoomFit: $('btnZoomFit'),
    fileInput: $('fileInput'),
    modalHelp: $('modalHelp'),
    helpFunctions: $('helpFunctions'),
    toast: $('toast')
  };

  /* ---------------- estado ---------------- */
  let graph = Flow.createGraph();
  let selectedNode = null;
  let selectedEdge = null;
  let zoom = 1;
  let problems = { errors: [], warnings: [], byNode: {} };
  const nodeEls = new Map();
  const undoStack = [];
  const redoStack = [];
  let editor = null;
  let saveTimer = null;
  let libraryId = null;      // entrada de la biblioteca que estamos editando
  let dirty = false;         // hay cambios sin guardar
  let theme = 'dark';        // 'dark' | 'light'
  let pyOpen = false;        // panel de Python a la vista
  let pyResult = null;       // ultima traduccion mostrada

  /* ---------------- utilidades ---------------- */
  function toast(message, kind) {
    els.toast.textContent = message;
    els.toast.className = 'toast' + (kind ? ' ' + kind : '');
    els.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { els.toast.hidden = true; }, 3200);
  }

  function toCanvas(clientX, clientY) {
    const r = els.zoomLayer.getBoundingClientRect();
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
  }

  function nodeScreenBox(node) {
    const r = els.zoomLayer.getBoundingClientRect();
    const b = Geo.box(node);
    return {
      left: r.left + b.x * zoom,
      top: r.top + b.y * zoom,
      width: b.w * zoom,
      height: b.h * zoom
    };
  }

  function snap(v, free) {
    return free ? Math.round(v) : Math.round(v / GRID) * GRID;
  }

  /* ---------------- guardar en el navegador ---------------- */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE_GRAPH, JSON.stringify(Flow.serialize(graph)));
      } catch (err) { /* modo privado o sin espacio: se sigue trabajando igual */ }
    }, 400);
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_PREFS, JSON.stringify({
        speed: Number(els.speed.value),
        trace: !!els.trace.checked,
        zoom: zoom,
        libraryId: libraryId,
        python: pyOpen,
        theme: theme
      }));
    } catch (err) { /* nada */ }
  }

  function loadPrefs() {
    let prefs = null;
    try { prefs = JSON.parse(localStorage.getItem(STORE_PREFS) || 'null'); } catch (err) { prefs = null; }
    if (!prefs) return;
    if (typeof prefs.speed === 'number') els.speed.value = prefs.speed;
    if (typeof prefs.trace === 'boolean') els.trace.checked = prefs.trace;
    if (typeof prefs.zoom === 'number') zoom = Math.min(1.6, Math.max(0.4, prefs.zoom));
    if (typeof prefs.python === 'boolean') pyOpen = prefs.python;
    if (prefs.theme === 'light' || prefs.theme === 'dark') theme = prefs.theme;
    if (typeof prefs.libraryId === 'string' && Store.exists(prefs.libraryId)) {
      libraryId = prefs.libraryId;
    }
  }

  /* ---------------- historial ---------------- */
  function pushUndo() {
    undoStack.push(Flow.serialize(graph));
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
  }

  function undo() {
    if (!undoStack.length) { toast('No hay nada que deshacer'); return; }
    redoStack.push(Flow.serialize(graph));
    applyGraph(Flow.deserialize(undoStack.pop()));
  }

  function redo() {
    if (!redoStack.length) { toast('No hay nada que rehacer'); return; }
    undoStack.push(Flow.serialize(graph));
    applyGraph(Flow.deserialize(redoStack.pop()));
  }

  function applyGraph(next) {
    graph = next;
    selectedNode = null;
    selectedEdge = null;
    closeEditor(true);
    els.title.value = graph.title || '';
    afterChange();
  }

  /** Se llama después de cualquier cambio en el diagrama. */
  function afterChange() {
    dirty = true;
    updateSaveButton();
    dropSharedHash();
    if (runtime.status === Flow.STATUS.running) runtime.pause();
    if (runtime.status === Flow.STATUS.waiting && runtime.awaiting &&
        !Flow.findNode(graph, runtime.awaiting.nodeId)) {
      closeAsk();
      runtime.cancelInput();
    }
    refreshProblems();
    render();
    schedulePython();
    scheduleSave();
  }

  /* ---------------- lienzo ---------------- */
  function layoutCanvas() {
    let w = MIN_W, h = MIN_H;
    graph.nodes.forEach(function (n) {
      const b = Geo.box(n);
      w = Math.max(w, b.x + b.w + 360);
      h = Math.max(h, b.y + b.h + 360);
    });
    els.zoomLayer.style.width = w + 'px';
    els.zoomLayer.style.height = h + 'px';
    els.zoomLayer.style.transform = 'scale(' + zoom + ')';
    els.canvasInner.style.width = Math.round(w * zoom) + 'px';
    els.canvasInner.style.height = Math.round(h * zoom) + 'px';
    els.edges.setAttribute('width', w);
    els.edges.setAttribute('height', h);
    els.edges.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    els.zoomValue.textContent = Math.round(zoom * 100) + '%';
  }

  function setZoom(next, clientX, clientY) {
    const value = Math.min(1.6, Math.max(0.4, Math.round(next * 100) / 100));
    if (value === zoom) return;
    const hasFocus = typeof clientX === 'number';
    const before = hasFocus ? toCanvas(clientX, clientY) : null;
    zoom = value;
    layoutCanvas();
    if (before) {
      const r = els.zoomLayer.getBoundingClientRect();
      els.canvasWrap.scrollLeft += (r.left + before.x * zoom) - clientX;
      els.canvasWrap.scrollTop += (r.top + before.y * zoom) - clientY;
    }
    renderEdges();
    savePrefs();
  }

  function zoomToFit() {
    if (!graph.nodes.length) { setZoom(1); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    graph.nodes.forEach(function (n) {
      const b = Geo.box(n);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    });
    const pad = 60;
    const vw = els.canvasWrap.clientWidth - pad * 2;
    const vh = els.canvasWrap.clientHeight - pad * 2;
    const z = Math.min(1.6, Math.max(0.4, Math.min(vw / (maxX - minX), vh / (maxY - minY))));
    zoom = Math.round(z * 100) / 100;
    layoutCanvas();
    renderEdges();
    els.canvasWrap.scrollLeft = Math.max(0, minX * zoom - pad);
    els.canvasWrap.scrollTop = Math.max(0, minY * zoom - pad);
    savePrefs();
  }

  function scrollNodeIntoView(node, always) {
    const wrapRect = els.canvasWrap.getBoundingClientRect();
    const b = nodeScreenBox(node);
    const margin = 70;
    let dx = 0, dy = 0;
    if (b.left < wrapRect.left + margin) dx = b.left - (wrapRect.left + margin);
    else if (b.left + b.width > wrapRect.right - margin) dx = (b.left + b.width) - (wrapRect.right - margin);
    if (b.top < wrapRect.top + margin) dy = b.top - (wrapRect.top + margin);
    else if (b.top + b.height > wrapRect.bottom - margin) dy = (b.top + b.height) - (wrapRect.bottom - margin);
    if (always || dx || dy) {
      els.canvasWrap.scrollLeft += dx;
      els.canvasWrap.scrollTop += dy;
    }
  }

  /* ---------------- dibujar bloques ---------------- */
  function svgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function createNodeEl(node) {
    const info = Flow.typeInfo(node.type);
    const el = document.createElement('div');
    el.className = 'node';
    el.dataset.id = node.id;
    el.dataset.type = node.type;

    const svg = svgEl('svg', { class: 'shape' });
    svg.appendChild(svgEl('path', { class: 'glow' }));
    svg.appendChild(svgEl('path', { class: 'body' }));
    svg.appendChild(svgEl('path', { class: 'ring' }));
    el.appendChild(svg);

    const content = document.createElement('div');
    content.className = 'content';
    const kind = document.createElement('div');
    kind.className = 'kind';
    const text = document.createElement('div');
    text.className = 'text';
    content.appendChild(kind);
    content.appendChild(text);
    el.appendChild(content);

    info.ports.forEach(function (port) {
      const anchor = document.createElement('div');
      anchor.className = 'anchor';
      anchor.dataset.port = port;
      anchor.title = port === 'out' ? 'Arrastra para conectar' :
        'Rama ' + Flow.PORT_LABEL[port] + ': arrastra para conectar';
      el.appendChild(anchor);
      if (Flow.PORT_LABEL[port]) {
        const tag = document.createElement('div');
        tag.className = 'port-tag';
        tag.dataset.port = port;
        tag.textContent = Flow.PORT_LABEL[port];
        el.appendChild(tag);
      }
    });

    if (info.editable) {
      const edit = document.createElement('button');
      edit.className = 'node-edit';
      edit.type = 'button';
      edit.title = 'Escribir el contenido de este bloque';
      edit.textContent = '✎';
      el.appendChild(edit);
    }

    const del = document.createElement('button');
    del.className = 'node-del';
    del.type = 'button';
    del.title = 'Borrar este bloque';
    del.textContent = '×';
    el.appendChild(del);

    const warn = document.createElement('div');
    warn.className = 'node-warn';
    warn.textContent = '!';
    warn.hidden = true;
    el.appendChild(warn);

    el.__parts = { svg: svg, kind: kind, text: text, warn: warn };
    return el;
  }

  function updateNodeEl(el, node) {
    const info = Flow.typeInfo(node.type);
    const parts = el.__parts;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    el.style.width = info.w + 'px';
    el.style.minHeight = info.minH + 'px';

    const label = info.label;
    if (parts.kind.textContent !== label) parts.kind.textContent = label;
    const shown = info.editable ? (node.text || '') : info.fixedText;
    if (parts.text.textContent !== shown) parts.text.textContent = shown;
    parts.kind.hidden = !info.editable;

    const issues = problems.byNode[node.id] || [];
    const hasError = issues.some(function (i) { return i.level === 'error'; });
    el.classList.toggle('is-selected', selectedNode === node.id);
    el.classList.toggle('has-error', hasError);
    el.classList.toggle('is-current', runtime.current === node.id || runtime.errorNodeId === node.id);
    parts.warn.hidden = issues.length === 0;
    parts.warn.classList.toggle('soft', !hasError);
    parts.warn.title = issues.map(function (i) { return i.message; }).join('\n');
  }

  /** Mide la altura real y coloca contorno, puntos y etiquetas. */
  function measureNode(el, node) {
    const info = Flow.typeInfo(node.type);
    const w = info.w;
    const h = Math.max(info.minH, el.offsetHeight);
    node.w = w;
    node.h = h;
    const parts = el.__parts;
    const d = Geo.shapePath(node.type, w, h);
    parts.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    parts.svg.querySelector('.body').setAttribute('d', d);
    parts.svg.querySelector('.ring').setAttribute('d', d);
    parts.svg.querySelector('.glow').setAttribute('d', d);

    info.ports.forEach(function (port) {
      const point = Geo.portPoint(node, port);
      const ax = point.x - node.x;
      const ay = point.y - node.y;
      const anchor = el.querySelector('.anchor[data-port="' + port + '"]');
      if (anchor) {
        anchor.style.left = ax + 'px';
        anchor.style.top = ay + 'px';
      }
      const tag = el.querySelector('.port-tag[data-port="' + port + '"]');
      if (tag) {
        if (point.dir === 'left') {
          tag.style.left = 'auto';
          tag.style.right = (w - ax + 10) + 'px';
          tag.style.top = (ay - 18) + 'px';
        } else if (point.dir === 'right') {
          tag.style.right = 'auto';
          tag.style.left = (ax + 10) + 'px';
          tag.style.top = (ay - 18) + 'px';
        } else {
          tag.style.right = 'auto';
          tag.style.left = (ax + 10) + 'px';
          tag.style.top = (ay + 3) + 'px';
        }
      }
    });
  }

  function syncNodes() {
    const alive = {};
    graph.nodes.forEach(function (node) {
      alive[node.id] = true;
      let el = nodeEls.get(node.id);
      if (el && el.dataset.type !== node.type) {
        el.remove();                 // el mismo id con otro tipo: forma y puntos distintos
        nodeEls.delete(node.id);
        el = null;
      }
      if (!el) {
        el = createNodeEl(node);
        nodeEls.set(node.id, el);
        els.nodes.appendChild(el);
      }
      updateNodeEl(el, node);
    });
    nodeEls.forEach(function (el, id) {
      if (!alive[id]) {
        el.remove();
        nodeEls.delete(id);
      }
    });
    graph.nodes.forEach(function (node) { measureNode(nodeEls.get(node.id), node); });
  }

  /* ---------------- dibujar flechas ---------------- */
  let edgeCutBtn = null;

  function renderEdges() {
    Array.prototype.slice.call(els.edges.querySelectorAll('path.wire, path.hit'))
      .forEach(function (p) { p.remove(); });

    if (edgeCutBtn) { edgeCutBtn.remove(); edgeCutBtn = null; }

    graph.edges.forEach(function (edge) {
      const from = Flow.findNode(graph, edge.from);
      const to = Flow.findNode(graph, edge.to);
      if (!from || !to) return;
      const points = Geo.route(from, edge.port, to);
      const d = Geo.elbowPath(points);

      const hit = svgEl('path', { class: 'hit', d: d });
      hit.dataset.id = edge.id;
      els.edges.appendChild(hit);

      const selected = selectedEdge === edge.id;
      const active = runtime.lastEdgeId === edge.id && runtime.isActive();
      const wire = svgEl('path', {
        class: 'wire p-' + edge.port + (selected ? ' is-selected' : '') + (active ? ' active' : ''),
        d: d,
        'marker-end': 'url(#' + (selected ? 'arrow-sel' : 'arrow-' + edge.port) + ')'
      });
      els.edges.appendChild(wire);

      if (selected) {
        const mid = Geo.midpoint(points);
        edgeCutBtn = document.createElement('button');
        edgeCutBtn.type = 'button';
        edgeCutBtn.className = 'edge-cut';
        edgeCutBtn.title = 'Borrar esta flecha';
        edgeCutBtn.textContent = '×';
        edgeCutBtn.style.left = mid.x + 'px';
        edgeCutBtn.style.top = mid.y + 'px';
        edgeCutBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          pushUndo();
          Flow.removeEdge(graph, edge.id);
          selectedEdge = null;
          afterChange();
        });
        els.nodes.appendChild(edgeCutBtn);
      }
    });
  }

  function render() {
    layoutCanvas();
    syncNodes();
    layoutCanvas();
    renderEdges();
    els.emptyHint.hidden = graph.nodes.length > 0;
    renderStatus();
  }

  /* ---------------- selección ---------------- */
  function select(nodeId, edgeId) {
    selectedNode = nodeId || null;
    selectedEdge = edgeId || null;
    nodeEls.forEach(function (el, id) { el.classList.toggle('is-selected', id === selectedNode); });
    renderEdges();
  }

  /* ---------------- problemas ---------------- */
  function refreshProblems() {
    problems = Flow.validate(graph);
    const errors = problems.errors.length;
    const warnings = problems.warnings.length;
    const btn = els.problemsBtn;
    btn.classList.toggle('bad', errors > 0);
    btn.classList.toggle('warn', errors === 0 && warnings > 0);
    if (!graph.nodes.length) btn.textContent = 'Lienzo vacío';
    else if (!errors && !warnings) btn.textContent = 'Todo en orden';
    else {
      const parts = [];
      if (errors) parts.push(errors === 1 ? '1 error' : errors + ' errores');
      if (warnings) parts.push(warnings === 1 ? '1 aviso' : warnings + ' avisos');
      btn.textContent = parts.join(' y ');
    }
    nodeEls.forEach(function (el, id) {
      const node = Flow.findNode(graph, id);
      if (node) updateNodeEl(el, node);
    });
  }

  function listProblems() {
    const all = problems.errors.concat(problems.warnings);
    if (!all.length) { addLog('El diagrama no tiene problemas', 'ok'); flushLog(); return; }
    addLog('Revision del diagrama:', 'sep');
    all.forEach(function (item) {
      const node = item.nodeId ? Flow.findNode(graph, item.nodeId) : null;
      const where = node ? '[' + Flow.typeInfo(node.type).label + '] ' : '';
      addLog(where + item.message, item.level === 'error' ? 'err' : 'trace');
    });
    flushLog();
    const first = all.find(function (i) { return i.nodeId; });
    if (first) {
      const node = Flow.findNode(graph, first.nodeId);
      select(node.id, null);
      scrollNodeIntoView(node);
    }
  }

  /* ---------------- consola ---------------- */
  let logQueue = [];
  let logCount = 0;
  let logRaf = null;

  function addLog(text, kind) {
    logQueue.push({ text: text, kind: kind || '' });
    if (logQueue.length > MAX_LOG) logQueue = logQueue.slice(-MAX_LOG);
    if (!logRaf) logRaf = requestAnimationFrame(flushLog);
  }

  function flushLog() {
    if (logRaf) { cancelAnimationFrame(logRaf); logRaf = null; }
    if (!logQueue.length) return;
    const body = els.consoleBody;
    const empty = body.querySelector('.empty-msg');
    if (empty) empty.remove();
    const nearBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
    const frag = document.createDocumentFragment();
    logQueue.forEach(function (item) {
      const line = document.createElement('div');
      line.className = 'log-line' + (item.kind ? ' ' + item.kind : '');
      line.textContent = item.text;
      frag.appendChild(line);
      logCount++;
    });
    logQueue = [];
    body.appendChild(frag);
    while (logCount > MAX_LOG && body.firstChild) {
      body.removeChild(body.firstChild);
      logCount--;
    }
    if (nearBottom) body.scrollTop = body.scrollHeight;
  }

  function clearConsole() {
    logQueue = [];
    logCount = 0;
    els.consoleBody.innerHTML = '<div class="empty-msg">Aqui aparece lo que muestra el programa.</div>';
  }

  /* ---------------- variables ---------------- */
  function varsHaveFocus() {
    const active = document.activeElement;
    return !!(active && els.varsBody.contains(active));
  }

  function renderVars() {
    if (varsHaveFocus()) return;
    const names = Object.keys(runtime.vars);
    const body = els.varsBody;
    body.innerHTML = '';
    if (!names.length) {
      const msg = document.createElement('div');
      msg.className = 'empty-msg';
      msg.textContent = 'Todavía no hay variables. Apareceran al ejecutar, y podrás cambiarlas a mano.';
      body.appendChild(msg);
    } else {
      const table = document.createElement('table');
      table.className = 'vars-table';
      names.forEach(function (name) {
        const value = runtime.vars[name];
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        tdName.className = 'vname';
        tdName.textContent = name;
        tdName.title = name;

        const tdValue = document.createElement('td');
        const input = document.createElement('input');
        input.className = 'var-input';
        input.value = Expr.formatLiteral(value);
        input.title = 'Escribe otro valor y pulsa Enter';
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
          if (ev.key === 'Escape') { input.value = Expr.formatLiteral(runtime.vars[name]); input.blur(); }
        });
        input.addEventListener('blur', function () {
          const raw = input.value.trim();
          const quoted = /^".*"$/.test(raw) || /^'.*'$/.test(raw);
          const next = quoted ? raw.slice(1, -1) : Expr.coerceInput(raw);
          if (next === runtime.vars[name]) { renderVars(); return; }
          try {
            runtime.setVar(name, next);
          } catch (err) {
            toast(err.message, 'bad');
          }
          renderVars();
          flushLog();
        });
        tdValue.appendChild(input);

        const tdType = document.createElement('td');
        tdType.className = 'vtype';
        tdType.textContent = Expr.typeName(value);

        const tdDel = document.createElement('td');
        tdDel.style.width = '18px';
        const del = document.createElement('button');
        del.className = 'var-del';
        del.type = 'button';
        del.title = 'Quitar esta variable';
        del.textContent = '×';
        del.addEventListener('click', function () {
          runtime.deleteVar(name);
          renderVars();
        });
        tdDel.appendChild(del);

        tr.appendChild(tdName);
        tr.appendChild(tdValue);
        tr.appendChild(tdType);
        tr.appendChild(tdDel);
        table.appendChild(tr);
      });
      body.appendChild(table);
    }

    // fila para crear una variable a mano
    const form = document.createElement('div');
    form.className = 'new-var';
    const nameInput = document.createElement('input');
    nameInput.className = 'nv-name';
    nameInput.placeholder = 'nombre';
    const valueInput = document.createElement('input');
    valueInput.className = 'nv-value';
    valueInput.placeholder = 'valor';
    const add = document.createElement('button');
    add.className = 'mini-btn';
    add.type = 'button';
    add.textContent = 'Añadir';
    function submit() {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      try {
        runtime.setVar(name, Expr.coerceInput(valueInput.value));
        nameInput.value = '';
        valueInput.value = '';
        renderVars();
        flushLog();
      } catch (err) {
        toast(err.message, 'bad');
      }
    }
    add.addEventListener('click', submit);
    [nameInput, valueInput].forEach(function (input) {
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    });
    form.appendChild(nameInput);
    form.appendChild(valueInput);
    form.appendChild(add);
    body.appendChild(form);
  }

  /* ---------------- estado de la ejecución ---------------- */
  const STATUS_TEXT = {
    idle: 'Detenido',
    paused: 'A medias',
    running: 'Ejecutando',
    waiting: 'Esperando un dato',
    finished: 'Terminado',
    error: 'Se detuvo por un error'
  };

  function renderStatus() {
    els.statusChip.dataset.status = runtime.status;
    els.statusText.textContent = STATUS_TEXT[runtime.status] || runtime.status;
    els.stepCount.textContent = runtime.steps ? runtime.steps + (runtime.steps === 1 ? ' paso' : ' pasos') : '';
    const running = runtime.status === Flow.STATUS.running;
    const waiting = runtime.status === Flow.STATUS.waiting;
    els.btnStep.disabled = running || waiting;
    els.btnRun.disabled = waiting;
    els.btnRun.innerHTML = running
      ? '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor"/></svg> Pausa'
      : '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5 L10 6 L3 10.5 Z" fill="currentColor"/></svg> Ejecutar';
    els.btnRun.title = running ? 'Pausar la ejecución' : 'Ejecutar el diagrama entero (F8)';
  }

  let stateRaf = null;
  function onRuntimeChange() {
    if (stateRaf) return;
    stateRaf = requestAnimationFrame(function () {
      stateRaf = null;
      applyRuntimeState();
    });
  }

  function applyRuntimeState() {
    if (runtime.status !== Flow.STATUS.waiting) closeAsk();
    nodeEls.forEach(function (el, id) {
      el.classList.toggle('is-current', runtime.current === id || runtime.errorNodeId === id);
    });
    renderEdges();
    renderVars();
    renderStatus();
    markPythonLine();
    flushLog();
    const node = runtime.current ? Flow.findNode(graph, runtime.current) : null;
    if (node && runtime.isActive()) scrollNodeIntoView(node);
  }

  /* ---------------- pedir un dato ---------------- */
  let askBox = null;

  function closeAsk() {
    if (askBox) { askBox.remove(); askBox = null; }
  }

  function showAsk(request) {
    closeAsk();
    const node = request.node;
    scrollNodeIntoView(node);

    const stageRect = els.overlayLayer.getBoundingClientRect();
    const box = nodeScreenBox(node);

    askBox = document.createElement('div');
    askBox.className = 'ask';
    const many = request.total > 1 ? ' (dato ' + (request.index + 1) + ' de ' + request.total + ')' : '';
    askBox.innerHTML =
      '<h4>Escribe el valor de ' + escapeHtml(request.name) + '</h4>' +
      '<p>Puede ser un número, un texto o verdadero/falso' + many + '</p>' +
      '<input type="text" id="askField" autocomplete="off">' +
      '<div class="ask-actions">' +
      '<button class="btn ghost" type="button" id="askCancel">Cancelar</button>' +
      '<button class="btn primary" type="button" id="askOk">Aceptar</button>' +
      '</div>';
    els.overlayLayer.appendChild(askBox);

    // pegado al bloque, pero siempre dentro de la vista
    let left = box.left - stageRect.left + box.width + 16;
    let top = box.top - stageRect.top - 8;
    if (left + askBox.offsetWidth > stageRect.width - 10) {
      left = box.left - stageRect.left - askBox.offsetWidth - 16;
    }
    left = Math.max(10, Math.min(left, stageRect.width - askBox.offsetWidth - 10));
    top = Math.max(10, Math.min(top, stageRect.height - askBox.offsetHeight - 10));
    askBox.style.left = Math.round(left) + 'px';
    askBox.style.top = Math.round(top) + 'px';

    const field = askBox.querySelector('#askField');
    field.focus();
    function accept() {
      const value = field.value;
      closeAsk();
      runtime.provideInput(value);
      flushLog();
    }
    field.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); accept(); }
      if (ev.key === 'Escape') { ev.preventDefault(); closeAsk(); runtime.cancelInput(); flushLog(); }
    });
    askBox.querySelector('#askOk').addEventListener('click', accept);
    askBox.querySelector('#askCancel').addEventListener('click', function () {
      closeAsk();
      runtime.cancelInput();
      flushLog();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- la máquina de ejecución ---------------- */
  const runtime = new Flow.Runtime({
    getGraph: function () { return graph; },
    hooks: {
      log: addLog,
      change: onRuntimeChange,
      askInput: showAsk,
      delay: function () { return Number(els.speed.value); }
    }
  });

  /* ---------------- crear bloques ---------------- */
  function addNodeAt(type, x, y, centered) {
    const info = Flow.typeInfo(type);
    let nx = x, ny = y;
    if (centered) {
      nx = x - info.w / 2;
      ny = y - info.minH / 2;
    }
    pushUndo();
    const node = Flow.addNode(graph, type, snap(Math.max(0, nx)), snap(Math.max(0, ny)));
    afterChange();
    select(node.id, null);
    if (info.editable) openEditor(node.id);
    return node;
  }

  function addNodeAtViewCenter(type) {
    const wrap = els.canvasWrap;
    const center = toCanvas(
      wrap.getBoundingClientRect().left + wrap.clientWidth / 2,
      wrap.getBoundingClientRect().top + wrap.clientHeight / 2
    );
    // busca un hueco libre bajando un poco si hay algo justo ahí
    let y = center.y;
    for (let i = 0; i < 40; i++) {
      const taken = graph.nodes.some(function (n) {
        return Math.abs(n.x + Geo.box(n).w / 2 - center.x) < 60 && Math.abs(n.y - (y - 30)) < 50;
      });
      if (!taken) break;
      y += 70;
    }
    return addNodeAt(type, center.x, y, true);
  }

  /* ---------------- editor de texto del bloque ---------------- */
  function openEditor(nodeId) {
    const node = Flow.findNode(graph, nodeId);
    if (!node) return;
    const info = Flow.typeInfo(node.type);
    if (!info.editable) { toast('El bloque ' + info.label + ' no lleva texto'); return; }
    closeEditor(true);

    const box = Geo.box(node);
    const area = document.createElement('textarea');
    area.className = 'node-editor';
    area.value = node.text || '';
    area.spellcheck = false;
    area.rows = 1;
    const width = Math.max(190, box.w + 40);
    area.style.left = Math.round(box.x + box.w / 2 - width / 2) + 'px';
    area.style.top = Math.round(box.y + box.h / 2 - 20) + 'px';
    area.style.width = width + 'px';
    els.editorLayer.appendChild(area);
    editor = { nodeId: nodeId, area: area, done: false };

    function grow() {
      area.style.height = 'auto';
      area.style.height = Math.min(160, area.scrollHeight) + 'px';
    }
    grow();
    area.addEventListener('input', grow);
    area.focus();
    area.select();

    area.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); closeEditor(false); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(true); }
      else if (ev.key === 'Tab') { ev.preventDefault(); closeEditor(false); }
      ev.stopPropagation();
    });
    area.addEventListener('blur', function () { closeEditor(false); });
  }

  function closeEditor(cancel) {
    if (!editor || editor.done) return;
    editor.done = true;
    const current = editor;
    const node = Flow.findNode(graph, current.nodeId);
    const value = current.area.value.replace(/\s+$/, '');
    current.area.remove();
    editor = null;
    if (!cancel && node && value !== (node.text || '')) {
      pushUndo();
      node.text = value;
      afterChange();
    }
  }

  /* ---------------- mover bloques y conectar ---------------- */
  let drag = null;
  let connecting = null;

  els.nodes.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    const el = e.target.closest('.node');
    if (!el) return;
    const id = el.dataset.id;
    const node = Flow.findNode(graph, id);
    if (!node) return;

    if (e.target.closest('.node-del')) {
      e.stopPropagation();
      pushUndo();
      Flow.removeNode(graph, id);
      if (selectedNode === id) selectedNode = null;
      closeEditor(true);
      afterChange();
      return;
    }

    if (e.target.closest('.node-edit')) {
      e.preventDefault();
      e.stopPropagation();
      select(id, null);
      openEditor(id);
      return;
    }

    const anchor = e.target.closest('.anchor');
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
      closeEditor(false);
      const port = anchor.dataset.port;
      const from = Geo.portPoint(node, port);
      connecting = {
        fromId: id,
        port: port,
        pointerId: e.pointerId,
        path: svgEl('path', { class: 'temp' }),
        target: null
      };
      els.edges.appendChild(connecting.path);
      connecting.from = { x: from.x, y: from.y };
      updateTempEdge(e.clientX, e.clientY);
      return;
    }

    if (editor && editor.nodeId === id) return;   // se esta escribiendo en este bloque

    e.preventDefault();
    closeEditor(false);
    select(id, null);
    const point = toCanvas(e.clientX, e.clientY);
    drag = {
      id: id,
      pointerId: e.pointerId,
      offX: point.x - node.x,
      offY: point.y - node.y,
      startX: node.x,
      startY: node.y,
      moved: false
    };
    el.classList.add('dragging');
  });

  function updateTempEdge(clientX, clientY) {
    const point = toCanvas(clientX, clientY);
    connecting.path.setAttribute('d',
      'M ' + connecting.from.x + ' ' + connecting.from.y + ' L ' + point.x + ' ' + point.y);
  }

  function nodeElAt(clientX, clientY) {
    const hits = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < hits.length; i++) {
      const el = hits[i].closest ? hits[i].closest('.node') : null;
      if (el) return el;
    }
    return null;
  }

  window.addEventListener('pointermove', function (e) {
    if (drag && e.pointerId === drag.pointerId) {
      const node = Flow.findNode(graph, drag.id);
      if (!node) { drag = null; return; }
      const point = toCanvas(e.clientX, e.clientY);
      const free = e.altKey;
      const nx = Math.max(0, snap(point.x - drag.offX, free));
      const ny = Math.max(0, snap(point.y - drag.offY, free));
      if (nx !== node.x || ny !== node.y) {
        if (Math.abs(nx - drag.startX) > 2 || Math.abs(ny - drag.startY) > 2) drag.moved = true;
        node.x = nx;
        node.y = ny;
        const el = nodeEls.get(node.id);
        if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }
        renderEdges();
      }
      return;
    }
    if (connecting && e.pointerId === connecting.pointerId) {
      updateTempEdge(e.clientX, e.clientY);
      const el = nodeElAt(e.clientX, e.clientY);
      const id = el ? el.dataset.id : null;
      const target = Flow.findNode(graph, id);
      const valid = target && id !== connecting.fromId && target.type !== 'start';
      if (connecting.target && connecting.target !== id) {
        const old = nodeEls.get(connecting.target);
        if (old) old.classList.remove('drop-target');
      }
      connecting.target = valid ? id : null;
      if (valid && el) el.classList.add('drop-target');
    }
  });

  window.addEventListener('pointerup', function (e) {
    if (drag && e.pointerId === drag.pointerId) {
      const el = nodeEls.get(drag.id);
      if (el) el.classList.remove('dragging');
      if (drag.moved) {
        const node = Flow.findNode(graph, drag.id);
        const from = { x: drag.startX, y: drag.startY };
        // el undo guarda la posicion anterior
        const after = { x: node.x, y: node.y };
        node.x = from.x;
        node.y = from.y;
        pushUndo();
        node.x = after.x;
        node.y = after.y;
        layoutCanvas();
        renderEdges();
        scheduleSave();
      }
      drag = null;
    }
    if (connecting && e.pointerId === connecting.pointerId) {
      connecting.path.remove();
      if (connecting.target) {
        const el = nodeEls.get(connecting.target);
        if (el) el.classList.remove('drop-target');
        pushUndo();
        const edge = Flow.connect(graph, connecting.fromId, connecting.port, connecting.target);
        if (edge) {
          afterChange();
          select(null, edge.id);
        } else {
          undoStack.pop();
          toast('No se puede hacer esa conexion', 'bad');
        }
      }
      connecting = null;
    }
  });

  window.addEventListener('pointercancel', function () {
    if (connecting) { connecting.path.remove(); connecting = null; }
    if (drag) {
      const el = nodeEls.get(drag.id);
      if (el) el.classList.remove('dragging');
      drag = null;
    }
  });

  els.nodes.addEventListener('dblclick', function (e) {
    const el = e.target.closest('.node');
    if (!el) return;
    e.preventDefault();
    openEditor(el.dataset.id);
  });

  els.edges.addEventListener('pointerdown', function (e) {
    const hit = e.target.closest('path.hit');
    if (!hit) return;
    e.stopPropagation();
    select(null, hit.dataset.id);
  });

  els.canvasWrap.addEventListener('pointerdown', function (e) {
    if (e.target === els.canvasWrap || e.target === els.canvasInner ||
      e.target === els.zoomLayer || e.target === els.nodes || e.target === els.edges) {
      closeEditor(false);
      select(null, null);
    }
  });

  els.canvasWrap.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
  }, { passive: false });

  /* ---------------- paleta ---------------- */
  let paletteDrag = null;

  function shapePreview(type, w, h) {
    const info = Flow.typeInfo(type);
    const fill = {
      start: '#dff0e4', end: '#fbe2df', process: '#f4f1e7',
      input: '#e4eefb', output: '#e4eefb', decision: '#fdf0d8'
    }[type] || '#f4f1e7';
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<path d="' + Geo.shapePath(type, w, h) + '" fill="' + fill + '" stroke="#223047" stroke-width="2"/>' +
      '</svg>' + (info ? '' : '');
  }

  function buildPalette() {
    const order = ['start', 'input', 'process', 'output', 'decision', 'end'];
    order.forEach(function (type) {
      const info = Flow.typeInfo(type);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pal-item';
      item.dataset.type = type;
      item.title = info.help;
      item.innerHTML = shapePreview(type, 56, 34) + '<span>' + info.label + '</span>';
      els.palette.appendChild(item);
    });

    const hint = document.createElement('p');
    hint.className = 'pal-hint';
    hint.textContent = 'Arrastra un bloque al lienzo, o púlsalo para ponerlo en el centro.';
    els.palette.appendChild(hint);
  }

  els.palette.addEventListener('pointerdown', function (e) {
    const item = e.target.closest('.pal-item');
    if (!item) return;
    paletteDrag = {
      type: item.dataset.type,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      dropped: false
    };
  });

  window.addEventListener('pointermove', function (e) {
    if (!paletteDrag || e.pointerId !== paletteDrag.pointerId) return;
    const far = Math.abs(e.clientX - paletteDrag.startX) + Math.abs(e.clientY - paletteDrag.startY) > 6;
    if (!paletteDrag.ghost && far) {
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      const info = Flow.typeInfo(paletteDrag.type);
      ghost.innerHTML = shapePreview(paletteDrag.type, Math.round(info.w * 0.8), Math.round(info.minH * 0.8));
      document.body.appendChild(ghost);
      paletteDrag.ghost = ghost;
    }
    if (paletteDrag.ghost) {
      paletteDrag.ghost.style.left = e.clientX + 'px';
      paletteDrag.ghost.style.top = e.clientY + 'px';
    }
  });

  window.addEventListener('pointerup', function (e) {
    if (!paletteDrag || e.pointerId !== paletteDrag.pointerId) return;
    const state = paletteDrag;
    paletteDrag = null;
    if (state.ghost) state.ghost.remove();
    if (!state.ghost) return;                       // fue un toque: lo trata el click
    const r = els.canvasWrap.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (inside) {
      const point = toCanvas(e.clientX, e.clientY);
      addNodeAt(state.type, point.x, point.y, true);
    }
  });

  els.palette.addEventListener('click', function (e) {
    const item = e.target.closest('.pal-item');
    if (!item) return;
    addNodeAtViewCenter(item.dataset.type);
  });

  /* ---------------- teclado ---------------- */
  document.addEventListener('keydown', function (e) {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (e.key === 'Escape') {
      if (!els.modalHelp.hidden) { els.modalHelp.hidden = true; return; }
      if (anyMenuOpen()) { closeMenus(); return; }
    }

    if (e.key === 'F8') { e.preventDefault(); toggleRun(); return; }
    if (e.key === 'F9') { e.preventDefault(); doStep(); return; }
    if (typing) return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveToLibrary(e.shiftKey);            // Ctrl+Shift+S guarda como copia nueva
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); exportPNG(); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedNode) {
        e.preventDefault();
        pushUndo();
        Flow.removeNode(graph, selectedNode);
        selectedNode = null;
        afterChange();
      } else if (selectedEdge) {
        e.preventDefault();
        pushUndo();
        Flow.removeEdge(graph, selectedEdge);
        selectedEdge = null;
        afterChange();
      }
      return;
    }

    if ((e.key === 'Enter' || e.key === 'F2') && selectedNode) {
      e.preventDefault();
      openEditor(selectedNode);
      return;
    }

    if (selectedNode && e.key.indexOf('Arrow') === 0) {
      e.preventDefault();
      const node = Flow.findNode(graph, selectedNode);
      if (!node) return;
      const stepSize = e.shiftKey ? 1 : GRID;
      if (e.key === 'ArrowLeft') node.x = Math.max(0, node.x - stepSize);
      if (e.key === 'ArrowRight') node.x = node.x + stepSize;
      if (e.key === 'ArrowUp') node.y = Math.max(0, node.y - stepSize);
      if (e.key === 'ArrowDown') node.y = node.y + stepSize;
      const el = nodeEls.get(node.id);
      if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
      layoutCanvas();
      renderEdges();
      scheduleSave();
      return;
    }

    if (e.key === '?') { els.modalHelp.hidden = false; }
  });

  function duplicateSelected() {
    if (!selectedNode) { toast('Selecciona primero un bloque'); return; }
    const node = Flow.findNode(graph, selectedNode);
    if (!node) return;
    pushUndo();
    const copy = Flow.addNode(graph, node.type, node.x + 30, node.y + 40, node.text);
    afterChange();
    select(copy.id, null);
  }

  /* ---------------- botones de ejecución ---------------- */
  function doStep() {
    closeEditor(false);
    runtime.trace = !!els.trace.checked;
    runtime.step();
    flushLog();
  }

  function toggleRun() {
    closeEditor(false);
    runtime.trace = !!els.trace.checked;
    if (runtime.status === Flow.STATUS.running) runtime.pause();
    else runtime.play();
    flushLog();
  }

  function resetRun() {
    closeAsk();
    runtime.reset();
    clearConsole();
    render();
    renderVars();
  }

  els.btnStep.addEventListener('click', doStep);
  els.btnRun.addEventListener('click', toggleRun);
  els.btnReset.addEventListener('click', resetRun);
  els.btnClearConsole.addEventListener('click', clearConsole);
  els.problemsBtn.addEventListener('click', listProblems);
  els.trace.addEventListener('change', function () {
    runtime.trace = !!els.trace.checked;
    savePrefs();
  });

  const SPEED_WORDS = [
    [1, 'Instantáneo'], [180, 'Muy rápido'], [400, 'Rapido'],
    [700, 'Normal'], [1100, 'Lento'], [99999, 'Muy lento']
  ];
  function updateSpeedLabel() {
    const value = Number(els.speed.value);
    const found = SPEED_WORDS.find(function (pair) { return value <= pair[0]; });
    els.speedLabel.textContent = found ? found[1] : 'Normal';
  }
  els.speed.addEventListener('input', function () {
    updateSpeedLabel();
    savePrefs();
  });

  els.btnZoomIn.addEventListener('click', function () { setZoom(zoom + 0.1); });
  els.btnZoomOut.addEventListener('click', function () { setZoom(zoom - 0.1); });
  els.btnZoomFit.addEventListener('click', zoomToFit);

  /* ---------------- archivo ---------------- */
  function newDiagram() {
    if (graph.nodes.length && !confirm('Se borrara el diagrama actual. \u00bfSeguir?')) return;
    pushUndo();
    graph = Flow.createGraph();
    selectedNode = null;
    selectedEdge = null;
    libraryId = null;
    els.title.value = graph.title;
    runtime.reset();
    clearConsole();
    afterChange();
    markClean();
    renderVars();
    toast('Lienzo vacio: arrastra un bloque Inicio para empezar');
  }

  /* ---------------- guardar en el navegador ---------------- */
  function markClean() {
    dirty = false;
    updateSaveButton();
  }

  function updateSaveButton() {
    if (!els.btnSave) return;
    const saved = libraryId && Store.exists(libraryId);
    els.btnSave.textContent = dirty ? 'Guardar \u2022' : 'Guardar';
    els.btnSave.classList.toggle('primary-soft', dirty);
    els.btnSave.title = !Store.available()
      ? 'Este navegador no deja guardar (modo privado?). Usa Archivo > Descargar .json'
      : (saved
        ? (dirty ? 'Guardar los cambios en \u00ab' + Store.titleOf(libraryId) + '\u00bb (Ctrl+S)'
          : 'Ya esta guardado en este navegador')
        : 'Guardar este diagrama en el navegador (Ctrl+S)');
  }

  function saveToLibrary(asNew) {
    if (!graph.nodes.length) { toast('No hay nada que guardar todavia'); return; }
    if (!Store.available()) {
      toast('Este navegador no deja guardar. Usa Archivo > Descargar .json', 'bad');
      return;
    }
    let title = (els.title.value || '').trim();
    if (asNew || !title) {
      const suggested = title || 'Mi diagrama';
      const answer = prompt('Nombre del diagrama:', suggested);
      if (answer === null) return;
      title = answer.trim() || suggested;
      els.title.value = title;
      graph.title = title;
    }
    graph.title = title;
    try {
      libraryId = Store.save(asNew ? null : libraryId, graph, title);
      markClean();
      savePrefs();
      toast('Guardado en este navegador: ' + title, 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function openFromLibrary(id) {
    const data = Store.get(id);
    if (!data) { toast('Ese diagrama ya no esta', 'bad'); return; }
    if (dirty && graph.nodes.length &&
      !confirm('El diagrama actual tiene cambios sin guardar. \u00bfAbrir otro igualmente?')) return;
    pushUndo();
    applyGraph(Flow.deserialize(data));
    libraryId = id;
    runtime.reset();
    clearConsole();
    renderVars();
    zoomToFit();
    markClean();
    savePrefs();
    toast('Abierto: ' + (Store.titleOf(id) || ''), 'good');
  }

  /* ---------------- menu de Mis diagramas ---------------- */
  function buildLibraryMenu() {
    const menu = els.menuLibrary;
    menu.innerHTML = '';

    if (!Store.available()) {
      const msg = document.createElement('div');
      msg.className = 'menu-empty';
      msg.textContent = 'Este navegador no deja guardar nada (puede estar en modo privado). ' +
        'Usa Archivo > Descargar .json';
      menu.appendChild(msg);
      return;
    }

    const items = Store.list();
    if (!items.length) {
      const msg = document.createElement('div');
      msg.className = 'menu-empty';
      msg.textContent = 'Todavia no has guardado ningun diagrama. Pulsa Guardar y aparecera aqui.';
      menu.appendChild(msg);
      return;
    }

    const head = document.createElement('div');
    head.className = 'menu-head';
    head.textContent = items.length === 1 ? '1 diagrama guardado' : items.length + ' diagramas guardados';
    menu.appendChild(head);

    items.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'lib-row' + (item.id === libraryId ? ' is-current' : '');
      row.dataset.id = item.id;

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'lib-open';
      open.innerHTML = escapeHtml(item.title) +
        '<small>' + escapeHtml(Store.timeAgo(item.updated)) + ' \u00b7 ' +
        item.nodes + (item.nodes === 1 ? ' bloque' : ' bloques') +
        (item.id === libraryId ? ' \u00b7 abierto ahora' : '') + '</small>';
      open.addEventListener('click', function () {
        closeMenus();
        openFromLibrary(item.id);
      });
      row.appendChild(open);

      const actions = document.createElement('div');
      actions.className = 'lib-actions';

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'lib-btn';
      rename.title = 'Cambiar el nombre';
      rename.textContent = '\u270e';
      rename.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const answer = prompt('Nuevo nombre:', item.title);
        if (answer === null) return;
        Store.rename(item.id, answer);
        if (item.id === libraryId) {
          els.title.value = Store.titleOf(item.id);
          graph.title = els.title.value;
          scheduleSave();
        }
        buildLibraryMenu();
        updateSaveButton();
      });
      actions.appendChild(rename);

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'lib-btn';
      copy.title = 'Duplicar';
      copy.textContent = '\u29c9';
      copy.addEventListener('click', function (ev) {
        ev.stopPropagation();
        try {
          Store.duplicate(item.id);
          buildLibraryMenu();
          toast('Copia creada', 'good');
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
      actions.appendChild(copy);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'lib-btn danger';
      del.title = 'Borrar de este navegador';
      del.textContent = '\u00d7';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!confirm('\u00bfBorrar \u00ab' + item.title + '\u00bb de este navegador?')) return;
        Store.remove(item.id);
        if (item.id === libraryId) { libraryId = null; savePrefs(); }
        buildLibraryMenu();
        updateSaveButton();
        toast('Borrado: ' + item.title);
      });
      actions.appendChild(del);

      row.appendChild(actions);
      menu.appendChild(row);
    });

    const foot = document.createElement('div');
    foot.className = 'menu-foot';
    foot.textContent = 'Se guardan solo en este navegador y en este equipo.';
    menu.appendChild(foot);
  }

  /* ---------------- menu Archivo ---------------- */
  function buildFileMenu() {
    const menu = els.menuFile;
    menu.innerHTML = '';

    function section(text) {
      const head = document.createElement('div');
      head.className = 'menu-head';
      head.textContent = text;
      menu.appendChild(head);
    }
    function entry(label, note, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = escapeHtml(label) + (note ? '<small>' + escapeHtml(note) + '</small>' : '');
      button.addEventListener('click', function () {
        closeMenus();
        handler();
      });
      menu.appendChild(button);
      return button;
    }

    section('Exportar el dibujo');
    entry('Imagen PNG', 'para pegar en un documento', exportPNG);
    entry('Imagen SVG', 'vectorial, se puede reescalar', exportSVG);
    entry('PDF', 'listo para imprimir', exportPDF);
    section('Archivo del diagrama');
    entry('Descargar .json', 'para guardarlo o pasarlo a otro equipo', downloadJSON);
    entry('Abrir .json...', 'cargar un diagrama de un archivo', function () { els.fileInput.click(); });
    section('Compartir');
    entry('Copiar enlace', 'el diagrama viaja dentro del enlace', shareLink);
  }

  /* ---------------- exportar ---------------- */
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function currentScene() {
    return Exporter.buildScene(graph, { title: (els.title.value || '').trim() });
  }

  function canExport() {
    if (!graph.nodes.length) { toast('Primero dibuja algo'); return false; }
    return true;
  }

  function downloadJSON() {
    if (!canExport()) return;
    const data = Flow.serialize(graph);
    const name = Exporter.fileName(els.title.value, 'json');
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
    toast('Descargado ' + name, 'good');
  }

  function exportSVG() {
    if (!canExport()) return;
    const name = Exporter.fileName(els.title.value, 'svg');
    downloadBlob(new Blob([Exporter.toSVG(currentScene())], { type: 'image/svg+xml' }), name);
    toast('Descargado ' + name, 'good');
  }

  function exportPDF() {
    if (!canExport()) return;
    const name = Exporter.fileName(els.title.value, 'pdf');
    downloadBlob(new Blob([Exporter.toPDF(currentScene())], { type: 'application/pdf' }), name);
    toast('Descargado ' + name, 'good');
  }

  /** El PNG se saca dibujando el SVG en un lienzo, al doble de resolucion. */
  function exportPNG(scale) {
    if (!canExport()) return Promise.resolve(false);
    const factor = scale || 2;
    const scene = currentScene();
    const svg = Exporter.toSVG(scene);
    const name = Exporter.fileName(els.title.value, 'png');
    return new Promise(function (resolve) {
      const image = new Image();
      const source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      image.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(scene.width * factor);
        canvas.height = Math.round(scene.height * factor);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = Exporter.PALETTE.page;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const finish = function (blob) {
          if (!blob) { toast('No pude crear la imagen', 'bad'); resolve(false); return; }
          downloadBlob(blob, name);
          toast('Descargado ' + name + ' (' + canvas.width + 'x' + canvas.height + ')', 'good');
          resolve(true);
        };
        if (canvas.toBlob) canvas.toBlob(finish, 'image/png');
        else finish(null);
      };
      image.onerror = function () {
        toast('No pude crear la imagen; prueba con SVG', 'bad');
        resolve(false);
      };
      image.src = source;
    });
  }

  function openFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const next = Flow.deserialize(JSON.parse(String(reader.result)));
        pushUndo();
        applyGraph(next);
        libraryId = null;
        runtime.reset();
        clearConsole();
        renderVars();
        zoomToFit();
        markClean();
        toast('Diagrama abierto', 'good');
      } catch (err) {
        toast('No pude leer el archivo: ' + err.message, 'bad');
      }
    };
    reader.onerror = function () { toast('No pude leer el archivo', 'bad'); };
    reader.readAsText(file);
  }

  els.btnNew.addEventListener('click', newDiagram);
  els.btnSave.addEventListener('click', function () { saveToLibrary(false); });
  els.fileInput.addEventListener('change', function () {
    if (els.fileInput.files && els.fileInput.files[0]) openFile(els.fileInput.files[0]);
    els.fileInput.value = '';
  });

  /* ---------------- compartir por enlace ---------------- */
  function encodeGraph() {
    const json = JSON.stringify(Flow.serialize(graph));
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeGraph(code) {
    const base = code.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** Carga un diagrama que venia dentro de un enlace. */
  function openFromCode(code) {
    const data = decodeGraph(code);
    applyGraph(Flow.deserialize(data));
    libraryId = null;          // es el diagrama de otro: no es tu entrada guardada
    dirty = true;              // todavia no esta guardado en este navegador
    updateSaveButton();
    return true;
  }

  /** El enlace de la barra deja de mandar en cuanto tocas el diagrama. */
  function dropSharedHash() {
    if (location.hash.indexOf('#d=') !== 0) return;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (err) { /* da igual si el navegador no deja */ }
  }

  function shareLink() {
    if (!canExport()) return;
    const code = encodeGraph();
    const link = location.origin + location.pathname + '#d=' + code;
    if (link.length > 8000) {
      toast('El diagrama es muy grande para un enlace, usa Archivo > Descargar .json', 'bad');
      return;
    }
    // el enlace solo se pone en la barra si no se pudo copiar al portapapeles,
    // porque un #d= pegado ahi tapa tus propios cambios al recargar
    const showInBar = function () {
      try { history.replaceState(null, '', '#d=' + code); } catch (err) { /* nada */ }
      toast('Copia el enlace de la barra de direcciones', 'bad');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () {
        toast('Enlace copiado (' + link.length + ' caracteres): el diagrama va dentro', 'good');
      }, showInBar);
    } else {
      showInBar();
    }
  }

  /* ---------------- ejemplos ---------------- */
  function buildExamplesMenu() {
    Examples.list.forEach(function (item) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = escapeHtml(item.name) + '<small>' + escapeHtml(item.note) + '</small>';
      button.addEventListener('click', function () {
        els.menuExamples.hidden = true;
        if (dirty && graph.nodes.length &&
          !confirm('Se reemplazar\u00e1 el diagrama actual, que tiene cambios sin guardar. \u00bfSeguir?')) return;
        pushUndo();
        applyGraph(Flow.deserialize(Examples.get(item.key)));
        libraryId = null;
        runtime.reset();
        clearConsole();
        renderVars();
        zoomToFit();
        markClean();
        toast('Ejemplo cargado: ' + item.name, 'good');
      });
      els.menuExamples.appendChild(button);
    });
  }

  /* ---------------- los tres menus desplegables ---------------- */
  const MENUS = [
    { button: 'btnExamples', menu: 'menuExamples', build: null },
    { button: 'btnLibrary', menu: 'menuLibrary', build: buildLibraryMenu },
    { button: 'btnFile', menu: 'menuFile', build: buildFileMenu }
  ];

  function closeMenus() {
    MENUS.forEach(function (m) { els[m.menu].hidden = true; });
  }

  function anyMenuOpen() {
    return MENUS.some(function (m) { return !els[m.menu].hidden; });
  }

  MENUS.forEach(function (m) {
    els[m.button].addEventListener('click', function (e) {
      e.stopPropagation();
      const wasHidden = els[m.menu].hidden;
      closeMenus();
      if (wasHidden) {
        if (m.build) m.build();
        els[m.menu].hidden = false;
      }
    });
  });

  document.addEventListener('click', function (e) {
    if (anyMenuOpen() && !e.target.closest('.menu-wrap')) closeMenus();
  });

  /* ---------------- ayuda ---------------- */
  els.btnHelp.addEventListener('click', function () { els.modalHelp.hidden = false; });
  els.modalHelp.addEventListener('click', function (e) {
    if (e.target === els.modalHelp || e.target.closest('[data-close]')) els.modalHelp.hidden = true;
  });

  /* ---------------- título ---------------- */
  els.title.addEventListener('input', function () {
    graph.title = els.title.value;
    schedulePython();
    scheduleSave();
  });

  /* ---------------- modo claro / oscuro ---------------- */
  const SUN = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="3.3" fill="currentColor"/>' +
    '<g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">' +
    '<path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7 13 13M13 3l-1.3 1.3M4.3 11.7 3 13"/>' +
    '</g></svg>';
  const MOON = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M13.4 9.8A5.8 5.8 0 0 1 6.2 2.6a5.9 5.9 0 1 0 7.2 7.2z" fill="currentColor"/>' +
    '</svg>';

  /** Pinta el tema elegido. El icono muestra a donde lleva el botón. */
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    const aClaro = theme !== 'light';
    const texto = aClaro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    els.btnTheme.innerHTML = aClaro ? SUN : MOON;
    els.btnTheme.title = texto;
    els.btnTheme.setAttribute('aria-label', texto);
  }

  function setTheme(next) {
    theme = next === 'light' ? 'light' : 'dark';
    applyTheme();
    savePrefs();
  }

  function toggleTheme() {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }

  els.btnTheme.addEventListener('click', function () { toggleTheme(); });

  /* ---------------- panel de Python ---------------- */
  // el orden importa: primero textos y comentarios, para que una # dentro
  // de un texto no se coma el resto de la linea
  const PY_RE = new RegExp(
    '("(?:[^"\\\\]|\\\\.)*")' +
    '|(#.*)' +
    '|\\b(def|return|if|elif|else|while|break|continue|not|and|or|in|is|' +
    'import|try|except|raise|pass|None|True|False)\\b' +
    '|\\b(print|input|len|int|float|str|bool|round|abs|min|max|pow|isinstance|' +
    'leer|texto|numero|entero|es_numero|main|math|random)\\b' +
    '|\\b(\\d+\\.?\\d*)', 'g');

  function pyHighlight(text) {
    let out = '';
    let last = 0;
    let m;
    PY_RE.lastIndex = 0;
    while ((m = PY_RE.exec(text))) {
      if (!m[0]) { PY_RE.lastIndex++; continue; }
      out += escapeHtml(text.slice(last, m.index));
      const cls = m[1] ? 'py-str' : m[2] ? 'py-com' : m[3] ? 'py-kw' : m[4] ? 'py-fn' : 'py-lit';
      out += '<span class="' + cls + '">' + escapeHtml(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
  }

  function buildPython() {
    try {
      return Py.generate(graph, { prompts: true });
    } catch (err) {
      const text = '# Error inesperado al traducir: ' + (err && err.message ? err.message : err);
      return {
        ok: false, code: text + '\n', notes: [],
        lines: [{ text: text, node: null }],
        problem: { message: text, nodeId: null, edgeId: null }
      };
    }
  }

  let pyRaf = null;
  let pyMarked = 0;

  function schedulePython() {
    if (!pyOpen || pyRaf) return;
    pyRaf = requestAnimationFrame(function () {
      pyRaf = null;
      renderPython();
    });
  }

  function renderPython() {
    if (!pyOpen) return;
    const res = buildPython();
    pyResult = res;

    const frag = document.createDocumentFragment();
    res.lines.forEach(function (line, i) {
      const row = document.createElement('div');
      row.className = 'py-line';
      const owner = line.node ? Flow.findNode(graph, line.node) : null;
      if (owner) {
        row.dataset.node = owner.id;
        row.title = 'Ir al bloque ' + Flow.nodeLabel(owner);
      }
      const num = document.createElement('span');
      num.className = 'py-num';
      num.textContent = String(i + 1);
      const code = document.createElement('code');
      code.innerHTML = line.text ? pyHighlight(line.text) : '&nbsp;';
      row.appendChild(num);
      row.appendChild(code);
      frag.appendChild(row);
    });
    els.pyBody.innerHTML = '';
    els.pyBody.appendChild(frag);

    els.btnPyCopy.disabled = !res.ok;
    els.btnPyDownload.disabled = !res.ok;
    renderPyNotes(res);
    pyMarked = 0;
    markPythonLine();
  }

  function renderPyNotes(res) {
    const box = els.pyNotes;
    box.innerHTML = '';
    box.classList.toggle('bad', !res.ok);

    if (!res.ok) {
      const head = document.createElement('h4');
      head.textContent = 'Todavía no se puede traducir';
      const body = document.createElement('div');
      body.textContent = res.problem.message;
      box.appendChild(head);
      box.appendChild(body);
      const target = res.problem.nodeId ? Flow.findNode(graph, res.problem.nodeId) : null;
      if (target) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mini-btn';
        button.textContent = 'Ver el bloque';
        button.addEventListener('click', function () {
          select(target.id, null);
          scrollNodeIntoView(target, true);
        });
        box.appendChild(button);
      }
      box.hidden = false;
      return;
    }

    if (!res.notes.length) { box.hidden = true; return; }
    const head = document.createElement('h4');
    head.textContent = res.notes.length === 1 ? 'Ojo con esto' : 'Ojo con estas cosas';
    const list = document.createElement('ul');
    res.notes.forEach(function (note) {
      const item = document.createElement('li');
      item.textContent = note;
      list.appendChild(item);
    });
    box.appendChild(head);
    box.appendChild(list);
    box.hidden = false;
  }

  /** Marca la linea del bloque en curso mientras se ejecuta */
  function markPythonLine() {
    if (!pyOpen || !pyResult) return;
    const bad = !!runtime.errorNodeId;
    const id = runtime.errorNodeId || (runtime.isActive() ? runtime.current : null);
    const rows = els.pyBody.children;
    let first = 0;
    for (let i = 0; i < rows.length; i++) {
      const on = !!id && rows[i].dataset.node === id;
      rows[i].classList.toggle('now', on);
      rows[i].classList.toggle('bad', on && bad);
      if (on && !first) first = i + 1;
    }
    if (first && first !== pyMarked && rows[first - 1].scrollIntoView) {
      rows[first - 1].scrollIntoView({ block: 'nearest' });
    }
    pyMarked = first;
  }

  function togglePython(open) {
    pyOpen = open === undefined ? !pyOpen : !!open;
    els.pyPanel.hidden = !pyOpen;
    els.btnPython.classList.toggle('primary-soft', pyOpen);
    els.btnPython.setAttribute('aria-pressed', pyOpen ? 'true' : 'false');
    if (pyOpen) {
      renderPython();
    } else {
      els.pyBody.innerHTML = '';
      els.pyNotes.hidden = true;
      pyResult = null;
    }
    savePrefs();
    renderEdges();            // el lienzo cambio de ancho
  }

  function pythonReady() {
    const res = pyResult || buildPython();
    if (!res.ok) {
      toast('Ese diagrama todavía no se puede traducir a Python', 'bad');
      if (!pyOpen) togglePython(true);
      return null;
    }
    return res;
  }

  function copyPython() {
    const res = pythonReady();
    if (!res) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(res.code).then(function () {
        toast('Código Python copiado', 'good');
      }, function () {
        toast('No pude copiar solo: selecciona el código con el ratón', 'bad');
      });
    } else {
      toast('Este navegador no deja copiar solo: selecciona el código con el ratón', 'bad');
    }
  }

  function downloadPython() {
    const res = pythonReady();
    if (!res) return;
    const name = Py.fileName(els.title.value || graph.title);
    downloadBlob(new Blob([res.code], { type: 'text/x-python' }), name);
    toast('Descargado ' + name, 'good');
  }

  els.btnPython.addEventListener('click', function () { togglePython(); });
  els.btnPyClose.addEventListener('click', function () { togglePython(false); });
  els.btnPyCopy.addEventListener('click', copyPython);
  els.btnPyDownload.addEventListener('click', downloadPython);
  els.pyBody.addEventListener('click', function (e) {
    const row = e.target.closest ? e.target.closest('.py-line[data-node]') : null;
    if (!row) return;
    const node = Flow.findNode(graph, row.dataset.node);
    if (!node) return;
    select(node.id, null);
    scrollNodeIntoView(node, true);
  });

  /* ---------------- arranque ---------------- */
  function loadInitial() {
    if (location.hash.indexOf('#d=') === 0) {
      try {
        graph = Flow.deserialize(decodeGraph(location.hash.slice(3)));
        return 'enlace';
      } catch (err) { /* si el enlace esta roto, se sigue con lo demas */ }
    }
    try {
      const saved = localStorage.getItem(STORE_GRAPH);
      if (saved) {
        graph = Flow.deserialize(JSON.parse(saved));
        if (graph.nodes.length) return 'guardado';
      }
    } catch (err) { /* nada */ }
    graph = Flow.deserialize(Examples.starter());
    return 'ejemplo';
  }

  function init() {
    applyTheme();
    buildPalette();
    buildExamplesMenu();
    loadPrefs();
    updateSpeedLabel();
    els.helpFunctions.textContent = Expr.functionNames().join(', ');
    const origin = loadInitial();
    els.title.value = graph.title || '';
    if (origin !== 'guardado') {
      // lo que hay en el lienzo no es la entrada guardada que recordaban las
      // preferencias: si no se olvida, Guardar machacaria el diagrama de la lista
      libraryId = null;
      savePrefs();
    }
    dirty = origin === 'enlace';
    updateSaveButton();
    runtime.trace = !!els.trace.checked;
    clearConsole();
    refreshProblems();
    render();
    renderVars();
    togglePython(pyOpen);
    if (origin === 'ejemplo') {
      addLog('Diagrama de ejemplo cargado. Pulsa Paso a paso para verlo funcionar.', 'sep');
      flushLog();
    }
    window.addEventListener('resize', function () { renderEdges(); });
    window.addEventListener('beforeunload', function () {
      try { localStorage.setItem(STORE_GRAPH, JSON.stringify(Flow.serialize(graph))); } catch (err) { /* nada */ }
    });
  }

  init();

  // para las pruebas automáticas del navegador
  window.__app = {
    getGraph: function () { return graph; },
    setZoom: setZoom,
    zoomToFit: zoomToFit,
    encodeGraph: encodeGraph,
    decodeGraph: decodeGraph,
    openFromCode: openFromCode,
    shareLink: shareLink,
    loadGraph: function (next) {
      applyGraph(next);
      libraryId = null;
      runtime.reset();
      clearConsole();
      renderVars();
      markClean();
    },
    store: Store,
    exporter: Exporter,
    saveToLibrary: saveToLibrary,
    openFromLibrary: openFromLibrary,
    libraryId: function () { return libraryId; },
    isDirty: function () { return dirty; },
    exportPNG: exportPNG,
    exportSVG: exportSVG,
    exportPDF: exportPDF,
    currentScene: currentScene,
    buildLibraryMenu: buildLibraryMenu,
    buildFileMenu: buildFileMenu,
    togglePython: togglePython,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    theme: function () { return theme; },
    pythonOpen: function () { return pyOpen; },
    python: buildPython,
    pythonPanel: function () {
      return Array.prototype.map.call(els.pyBody.children, function (row) {
        const code = row.querySelector('code');
        return {
          text: code ? code.textContent : '',
          node: row.dataset.node || null,
          now: row.classList.contains('now')
        };
      });
    },
    pythonNotes: function () { return els.pyNotes.hidden ? '' : els.pyNotes.textContent; },
    closeMenus: closeMenus,
    loadExample: function (key) {
      applyGraph(Flow.deserialize(Examples.get(key)));
      libraryId = null;
      runtime.reset();
      clearConsole();
      renderVars();
      markClean();
    },
    runtime: runtime,
    addNodeAt: addNodeAt,
    openEditor: openEditor,
    closeEditor: closeEditor,
    select: select,
    render: render,
    afterChange: afterChange,
    toCanvas: toCanvas,
    nodeEls: nodeEls,
    doStep: doStep,
    toggleRun: toggleRun,
    resetRun: resetRun,
    undo: undo,
    redo: redo,
    problems: function () { return problems; },
    logLines: function () {
      return Array.prototype.slice.call(els.consoleBody.querySelectorAll('.log-line'))
        .map(function (l) { return l.className.replace('log-line', '').trim() + '|' + l.textContent; });
    }
  };
})();
