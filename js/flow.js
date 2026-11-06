/* ------------------------------------------------------------------
   flow.js  ·  Modelo del diagrama, validación y máquina de ejecución
   Sin dependencias del DOM: se puede probar con Node.
   Expone globalThis.Flow  (necesita FlowExpr)
------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const Expr = root.FlowExpr;
  if (!Expr) throw new Error('flow.js necesita expr.js');
  const FlowError = Expr.FlowError;

  /* ---------- tipos de bloque ---------- */
  const TYPES = {
    start: {
      label: 'Inicio', shape: 'stadium', w: 168, minH: 54,
      ports: ['out'], editable: false, fixedText: 'Inicio',
      help: 'Por aquí empieza el programa. Solo puede haber uno.'
    },
    input: {
      label: 'Entrada', shape: 'parallelogram', w: 184, minH: 62,
      ports: ['out'], editable: true, defaultText: 'n',
      help: 'Pide un valor al usuario. Escribe el nombre de la variable (o varias separadas por comas).'
    },
    process: {
      label: 'Proceso', shape: 'rect', w: 190, minH: 62,
      ports: ['out'], editable: true, defaultText: 'x = 0',
      help: 'Asigna un valor a una variable: contador = contador + 1'
    },
    output: {
      label: 'Salida', shape: 'parallelogram', w: 184, minH: 62,
      ports: ['out'], editable: true, defaultText: '"Resultado: ", x',
      help: 'Muestra texto y valores en la consola: "Total: ", suma'
    },
    decision: {
      label: 'Decisión', shape: 'diamond', w: 196, minH: 140,
      ports: ['true', 'false'], editable: true, defaultText: 'x > 0',
      help: 'Pregunta si algo es verdadero. Tiene dos salidas: Sí y No.'
    },
    end: {
      label: 'Fin', shape: 'stadium', w: 168, minH: 54,
      ports: [], editable: false, fixedText: 'Fin',
      help: 'Termina el programa.'
    }
  };

  const PORT_LABEL = { out: '', 'true': 'Sí', 'false': 'No' };
  const WRITE_WORDS = 'escribir|escriba|mostrar|imprimir|salida|write|print';

  function typeInfo(type) { return TYPES[type] || TYPES.process; }
  function nodeLabel(node) { return typeInfo(node.type).label; }

  function nodeText(node) {
    const info = typeInfo(node.type);
    return info.editable ? (node.text || '') : info.fixedText;
  }

  /* ---------- grafo ---------- */
  function createGraph() {
    return { version: 1, title: 'Diagrama sin título', seq: 1, nodes: [], edges: [] };
  }

  function newId(graph, prefix) {
    graph.seq = (graph.seq || 1) + 1;
    return prefix + graph.seq;
  }

  function addNode(graph, type, x, y, text) {
    const info = typeInfo(type);
    const node = {
      id: newId(graph, 'n'),
      type: type,
      x: Math.round(x),
      y: Math.round(y),
      text: text !== undefined ? text : (info.editable ? info.defaultText : '')
    };
    graph.nodes.push(node);
    return node;
  }

  function findNode(graph, id) {
    for (let i = 0; i < graph.nodes.length; i++) if (graph.nodes[i].id === id) return graph.nodes[i];
    return null;
  }

  function findEdge(graph, id) {
    for (let i = 0; i < graph.edges.length; i++) if (graph.edges[i].id === id) return graph.edges[i];
    return null;
  }

  function edgeFrom(graph, nodeId, port) {
    for (let i = 0; i < graph.edges.length; i++) {
      const e = graph.edges[i];
      if (e.from === nodeId && e.port === port) return e;
    }
    return null;
  }

  /** Conecta dos bloques. Una salida solo puede tener una flecha. */
  function connect(graph, fromId, port, toId) {
    if (fromId === toId) return null;
    const from = findNode(graph, fromId);
    const to = findNode(graph, toId);
    if (!from || !to) return null;
    if (typeInfo(from.type).ports.indexOf(port) < 0) return null;
    if (to.type === 'start') return null;               // nada entra al Inicio
    graph.edges = graph.edges.filter(function (e) {
      return !(e.from === fromId && e.port === port);
    });
    const edge = { id: newId(graph, 'e'), from: fromId, port: port, to: toId };
    graph.edges.push(edge);
    return edge;
  }

  function removeNode(graph, id) {
    graph.nodes = graph.nodes.filter(function (n) { return n.id !== id; });
    graph.edges = graph.edges.filter(function (e) { return e.from !== id && e.to !== id; });
  }

  function removeEdge(graph, id) {
    graph.edges = graph.edges.filter(function (e) { return e.id !== id; });
  }

  /* ---------- guardar / abrir ---------- */
  function serialize(graph) {
    return {
      version: 1,
      title: graph.title || 'Diagrama sin título',
      seq: graph.seq || 1,
      nodes: graph.nodes.map(function (n) {
        return { id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y), text: n.text || '' };
      }),
      edges: graph.edges.map(function (e) {
        return { id: e.id, from: e.from, port: e.port, to: e.to };
      })
    };
  }

  /** Acepta datos de fuera y devuelve un grafo consistente. */
  function deserialize(data) {
    const graph = createGraph();
    if (!data || typeof data !== 'object') throw new FlowError('El archivo no contiene un diagrama');
    const rawNodes = Array.isArray(data.nodes) ? data.nodes : null;
    if (!rawNodes) throw new FlowError('El archivo no contiene bloques');
    graph.title = typeof data.title === 'string' && data.title.trim() ? data.title : 'Diagrama sin título';

    const seen = {};
    rawNodes.forEach(function (n) {
      if (!n || !TYPES[n.type]) return;
      let id = typeof n.id === 'string' && n.id ? n.id : 'n' + (graph.nodes.length + 1);
      while (seen[id]) id = id + '_';
      seen[id] = true;
      graph.nodes.push({
        id: id,
        type: n.type,
        x: clampNum(n.x, 0, 100000, 40),
        y: clampNum(n.y, 0, 100000, 40),
        text: typeof n.text === 'string' ? n.text : ''
      });
    });

    // seq por encima de cualquier id numerado, para no repetir ninguno
    let maxSeq = 1;
    graph.nodes.forEach(function (n) {
      const m = /(\d+)/.exec(n.id);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    graph.seq = maxSeq;

    const rawEdges = Array.isArray(data.edges) ? data.edges : [];
    const usedPorts = {};
    rawEdges.forEach(function (e) {
      if (!e || !seen[e.from] || !seen[e.to]) return;
      if (e.from === e.to) return;                      // ningún bloque se conecta a si mismo
      const from = findNode(graph, e.from);
      const to = findNode(graph, e.to);
      if (to.type === 'start') return;                  // nada entra al Inicio
      const port = e.port === 'true' || e.port === 'false' ? e.port : 'out';
      if (typeInfo(from.type).ports.indexOf(port) < 0) return;
      const key = e.from + '/' + port;
      if (usedPorts[key]) return;                       // una salida, una flecha
      usedPorts[key] = true;
      graph.edges.push({ id: newId(graph, 'e'), from: e.from, port: port, to: e.to });
    });

    return graph;
  }

  function clampNum(v, lo, hi, fallback) {
    const n = Number(v);
    if (isNaN(n)) return fallback;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  function cloneGraph(graph) {
    return JSON.parse(JSON.stringify(serialize(graph)));
  }

  /* ---------- validación ---------- */
  /**
   * Revisa el diagrama completo.
   * errors  -> impiden o rompen la ejecución (fatal: no se puede arrancar)
   * warnings-> avisos útiles mientras se construye
   */
  function validate(graph) {
    const errors = [];
    const warnings = [];
    const byNode = {};

    function mark(list, nodeId, message, fatal) {
      const item = {
        nodeId: nodeId || null,
        message: message,
        fatal: !!fatal,
        level: list === errors ? 'error' : 'warn'
      };
      list.push(item);
      if (nodeId) {
        if (!byNode[nodeId]) byNode[nodeId] = [];
        byNode[nodeId].push(item);
      }
      return item;
    }

    const starts = graph.nodes.filter(function (n) { return n.type === 'start'; });
    if (graph.nodes.length === 0) {
      mark(errors, null, 'El lienzo está vacío: arrastra bloques desde la izquierda', true);
    } else if (starts.length === 0) {
      mark(errors, null, 'Falta el bloque Inicio', true);
    } else if (starts.length > 1) {
      starts.forEach(function (s) { mark(errors, s.id, 'Hay ' + starts.length + ' bloques Inicio y solo puede haber uno', true); });
    }
    if (graph.nodes.length && !graph.nodes.some(function (n) { return n.type === 'end'; })) {
      mark(warnings, null, 'No hay ningún bloque Fin');
    }

    // texto de cada bloque
    graph.nodes.forEach(function (n) {
      const info = typeInfo(n.type);
      if (!info.editable) return;
      const text = (n.text || '').trim();
      if (!text) {
        mark(errors, n.id, 'El bloque ' + info.label + ' está vacío');
        return;
      }
      try {
        if (n.type === 'process') Expr.parseAssignments(text);
        else if (n.type === 'input') Expr.parseNames(text);
        else if (n.type === 'output') {
          const list = Expr.parseExprList(text, WRITE_WORDS);
          if (!list.length) throw new FlowError('Escribe qué quieres mostrar');
        } else if (n.type === 'decision') Expr.parseExpression(text);
      } catch (err) {
        mark(errors, n.id, err.message);
      }
    });

    // salidas sin conectar
    graph.nodes.forEach(function (n) {
      typeInfo(n.type).ports.forEach(function (port) {
        if (!edgeFrom(graph, n.id, port)) {
          const via = port === 'out' ? '' : ' por la rama ' + PORT_LABEL[port];
          mark(warnings, n.id, 'El bloque ' + typeInfo(n.type).label + ' no tiene flecha de salida' + via);
        }
      });
    });

    // bloques a los que nunca se llega
    if (starts.length === 1) {
      const reachable = {};
      const queue = [starts[0].id];
      while (queue.length) {
        const id = queue.shift();
        if (reachable[id]) continue;
        reachable[id] = true;
        graph.edges.forEach(function (e) {
          if (e.from === id && !reachable[e.to]) queue.push(e.to);
        });
      }
      graph.nodes.forEach(function (n) {
        if (!reachable[n.id]) mark(warnings, n.id, 'Este bloque nunca se ejecuta: no llega ninguna flecha desde Inicio');
      });
    }

    return { errors: errors, warnings: warnings, byNode: byNode, ok: errors.length === 0 };
  }

  /* ---------- ejecución ---------- */
  const STATUS = {
    idle: 'idle',            // sin empezar
    paused: 'paused',        // preparado / a medias
    running: 'running',      // corriendo solo
    waiting: 'waiting',      // esperando un dato del usuario
    finished: 'finished',    // llego al Fin
    error: 'error'           // se detuvo por un error
  };

  class Runtime {
    constructor(opts) {
      opts = opts || {};
      this.getGraph = opts.getGraph;
      this.hooks = opts.hooks || {};
      this.maxSteps = opts.maxSteps || 250000;
      this.trace = true;
      this.timer = null;
      this.inTick = false;
      this.reset(true);
    }

    graph() { return this.getGraph(); }
    node(id) { return id ? findNode(this.graph(), id) : null; }

    emit() { if (this.hooks.change) this.hooks.change(this); }
    log(text, kind) { if (this.hooks.log) this.hooks.log(text, kind || ''); }

    isBusy() { return this.status === STATUS.running; }
    isActive() {
      return this.status === STATUS.paused || this.status === STATUS.running || this.status === STATUS.waiting;
    }

    /* -- estado -- */
    reset(silent) {
      this.clearTimer();
      this.status = STATUS.idle;
      this.vars = {};
      this.current = null;
      this.errorNodeId = null;
      this.lastEdgeId = null;
      this.steps = 0;
      this.awaiting = null;
      this.resumeStatus = null;
      this.outputCount = 0;
      if (!silent) this.emit();
    }

    clearTimer() {
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }

    /** Prepara una ejecución nueva. Devuelve true si se puede arrancar. */
    prepare() {
      const report = validate(this.graph());
      const fatal = report.errors.filter(function (e) { return e.fatal; });
      if (fatal.length) {
        this.status = STATUS.error;
        this.errorNodeId = fatal[0].nodeId;
        fatal.forEach(function (e) { this.log('No puedo ejecutar: ' + e.message, 'err'); }, this);
        this.emit();
        return false;
      }
      const start = this.graph().nodes.filter(function (n) { return n.type === 'start'; })[0];
      this.vars = {};
      this.steps = 0;
      this.errorNodeId = null;
      this.lastEdgeId = null;
      this.awaiting = null;
      this.current = start.id;
      this.status = STATUS.paused;
      this.log('Ejecución iniciada', 'ok');
      this.emit();
      return true;
    }

    /** Deja el runtime listo para dar un paso; reinicia si ya habia terminado. */
    ensureReady() {
      if (this.status === STATUS.finished || this.status === STATUS.error) {
        this.clearTimer();
        this.log('- - - nueva ejecución - - -', 'sep');
        this.reset(true);
      }
      if (this.status === STATUS.idle) return this.prepare();
      return true;
    }

    /* -- un paso -- */
    step() {
      if (this.status === STATUS.waiting) return this.status;
      if (!this.ensureReady()) return this.status;
      const node = this.node(this.current);
      if (!node) {
        this.status = STATUS.error;
        this.log('El bloque en el que estaba ya no existe. Vuelve a empezar.', 'err');
        this.emit();
        return this.status;
      }

      this.steps++;
      if (this.steps > this.maxSteps) {
        this.clearTimer();
        this.status = STATUS.error;
        this.errorNodeId = node.id;
        this.log('Detenido: ya van ' + this.maxSteps + ' pasos. Seguramente hay un bucle que nunca termina.', 'err');
        this.emit();
        return this.status;
      }

      let result;
      try {
        result = this.runNode(node);
      } catch (err) {
        this.fail(err, node);
        return this.status;
      }

      if (result.wait) { this.emit(); return this.status; }

      if (result.end) {
        this.clearTimer();
        this.current = null;
        this.status = STATUS.finished;
        this.log('Fin del programa (' + this.steps + ' pasos)', 'ok');
        this.emit();
        return this.status;
      }

      try {
        this.goto(node, result.port);
      } catch (err) {
        this.fail(err, node);
        return this.status;
      }
      this.emit();
      return this.status;
    }

    runNode(node) {
      const text = nodeText(node).trim();
      switch (node.type) {
        case 'start':
          return { port: 'out' };

        case 'end':
          return { end: true };

        case 'process': {
          const stmts = Expr.parseAssignments(text);
          for (let i = 0; i < stmts.length; i++) {
            const st = stmts[i];
            const value = Expr.evaluate(st.ast, this.vars);
            this.vars[st.name] = value;
            if (this.trace) this.log(st.name + ' = ' + Expr.formatLiteral(value), 'trace');
          }
          return { port: 'out' };
        }

        case 'output': {
          const list = Expr.parseExprList(text, WRITE_WORDS);
          if (!list.length) throw new FlowError('Escribe qué quieres mostrar, por ejemplo  "Total: ", suma');
          let out = '';
          for (let i = 0; i < list.length; i++) {
            const piece = Expr.formatValue(Expr.evaluate(list[i], this.vars));
            if (i > 0 && !/\s$/.test(out) && !/^\s/.test(piece)) out += ' ';
            out += piece;
          }
          this.outputCount++;
          this.log(out, 'out');
          return { port: 'out' };
        }

        case 'input': {
          const names = Expr.parseNames(text);
          this.resumeStatus = this.status === STATUS.running ? STATUS.running : STATUS.paused;
          this.awaiting = { nodeId: node.id, names: names, index: 0 };
          this.status = STATUS.waiting;
          this.clearTimer();
          this.askInput();
          return { wait: true };
        }

        case 'decision': {
          const value = Expr.evaluate(Expr.parseExpression(text), this.vars);
          if (typeof value !== 'boolean') {
            throw new FlowError('La condición debe dar verdadero o falso, y dio ' + Expr.describe(value));
          }
          if (this.trace) this.log(text + '  ->  ' + (value ? 'Sí' : 'No'), 'trace');
          return { port: value ? 'true' : 'false' };
        }
      }
      throw new FlowError('No se que hacer con un bloque de tipo ' + node.type);
    }

    goto(node, port) {
      const edge = edgeFrom(this.graph(), node.id, port);
      if (!edge) {
        const via = port === 'out' ? '' : ' por la rama ' + PORT_LABEL[port];
        throw new FlowError('El bloque ' + nodeLabel(node) + ' no tiene flecha de salida' + via);
      }
      if (!this.node(edge.to)) throw new FlowError('La flecha apunta a un bloque que ya no existe');
      this.lastEdgeId = edge.id;
      this.current = edge.to;
    }

    fail(err, node) {
      this.clearTimer();
      this.status = STATUS.error;
      this.errorNodeId = node ? node.id : null;
      const message = err && err.message ? err.message : String(err);
      const isKnown = err instanceof FlowError;
      this.log((node ? nodeLabel(node) + ': ' : '') + (isKnown ? message : 'Error inesperado: ' + message), 'err');
      if (!isKnown && root.console) root.console.error(err);
      this.emit();
    }

    /* -- entrada de datos -- */
    askInput() {
      if (!this.awaiting) return;
      const node = this.node(this.awaiting.nodeId);
      if (!node) { this.awaiting = null; return; }
      if (this.hooks.askInput) {
        this.hooks.askInput({
          node: node,
          name: this.awaiting.names[this.awaiting.index],
          index: this.awaiting.index,
          total: this.awaiting.names.length
        });
      }
      this.emit();
    }

    provideInput(raw) {
      if (!this.awaiting) return;
      const awaiting = this.awaiting;
      const name = awaiting.names[awaiting.index];
      const value = Expr.coerceInput(raw);
      this.vars[name] = value;
      this.log('Entrada: ' + name + ' = ' + Expr.formatLiteral(value), 'in');
      awaiting.index++;
      if (awaiting.index < awaiting.names.length) { this.askInput(); return; }

      const node = this.node(awaiting.nodeId);
      this.awaiting = null;
      this.status = this.resumeStatus || STATUS.paused;
      if (!node) {
        this.clearTimer();
        this.status = STATUS.error;
        this.log('El bloque de entrada ya no existe. Vuelve a empezar.', 'err');
        this.emit();
        return;
      }
      try {
        this.goto(node, 'out');
      } catch (err) {
        this.fail(err, node);
        return;
      }
      this.emit();
      if (this.status === STATUS.running && !this.inTick) this.schedule();
    }

    cancelInput() {
      if (!this.awaiting) return;
      this.awaiting = null;
      this.status = STATUS.paused;
      this.log('Entrada cancelada. Pulsa Paso o Ejecutar para volver a pedir el dato.', 'sep');
      this.emit();
    }

    /* -- correr solo -- */
    play() {
      if (this.status === STATUS.running) return;
      if (this.status === STATUS.waiting) {
        this.resumeStatus = STATUS.running;
        this.status = STATUS.running;
        this.emit();
        return;
      }
      if (!this.ensureReady()) return;
      this.status = STATUS.running;
      this.emit();
      this.schedule();
    }

    pause() {
      this.clearTimer();
      if (this.status === STATUS.running) {
        this.status = STATUS.paused;
        this.log('En pausa', 'sep');
      }
      this.emit();
    }

    delay() {
      return this.hooks.delay ? Math.max(0, Number(this.hooks.delay()) || 0) : 400;
    }

    schedule() {
      this.clearTimer();
      if (this.status !== STATUS.running) return;
      const wait = this.delay();
      const self = this;
      this.timer = setTimeout(function () {
        self.timer = null;
        self.tick();
      }, wait <= 16 ? 0 : wait);
    }

    tick() {
      if (this.status !== STATUS.running) return;
      const fast = this.delay() <= 16;
      const budget = fast ? 1500 : 1;
      const deadline = Date.now() + 25;
      this.inTick = true;                           // evita agendar dos veces
      try {
        for (let i = 0; i < budget; i++) {
          const status = this.step();
          if (status !== STATUS.running) return;    // pausa, espera, fin o error
          if (fast && Date.now() > deadline) break;
        }
      } finally {
        this.inTick = false;
      }
      this.schedule();
    }

    /* -- variables editadas a mano -- */
    setVar(name, value) {
      if (!/^[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-z0-9À-ÖØ-öø-ÿ_]*$/.test(String(name))) {
        throw new FlowError('«' + name + '» no es un nombre de variable válido');
      }
      if (Expr.isReservedWord(name)) {
        throw new FlowError('«' + name + '» es una palabra reservada, elige otro nombre');
      }
      this.vars[name] = value;
      this.log('Variable cambiada a mano: ' + name + ' = ' + Expr.formatLiteral(value), 'sep');
      this.emit();
    }

    deleteVar(name) {
      delete this.vars[name];
      this.emit();
    }
  }

  root.Flow = {
    TYPES: TYPES,
    STATUS: STATUS,
    PORT_LABEL: PORT_LABEL,
    WRITE_WORDS: WRITE_WORDS,
    typeInfo: typeInfo,
    nodeLabel: nodeLabel,
    nodeText: nodeText,
    createGraph: createGraph,
    addNode: addNode,
    findNode: findNode,
    findEdge: findEdge,
    edgeFrom: edgeFrom,
    connect: connect,
    removeNode: removeNode,
    removeEdge: removeEdge,
    serialize: serialize,
    deserialize: deserialize,
    cloneGraph: cloneGraph,
    validate: validate,
    Runtime: Runtime
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
