/* ------------------------------------------------------------------
   pycode.js  ·  Traduce el diagrama a código Python
   Trabaja sobre el AST de expr.js, no sobre el texto.
   Sin dependencias del DOM: se puede probar con Node.
   Expone globalThis.FlowPy  (necesita expr.js y flow.js)
------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const Expr = root.FlowExpr;
  const Flow = root.Flow;
  if (!Expr || !Flow) throw new Error('pycode.js necesita expr.js y flow.js');
  const FlowError = Expr.FlowError;

  const INDENT = '    ';

  /* ================================================================
     1 · Nombres
     Python 3 acepta acentos y eñes en los nombres, así que «año» vale.
     Solo hay que esquivar sus palabras reservadas y los nombres que
     usamos nosotros (print, len, leer, math...).
  ================================================================ */
  const PY_KEYWORDS = ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
    'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
    'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case'];

  const PY_TAKEN = ['print', 'input', 'len', 'str', 'int', 'float', 'bool', 'abs', 'round',
    'min', 'max', 'pow', 'sum', 'list', 'dict', 'tuple', 'set', 'range', 'type', 'id',
    'map', 'filter', 'sorted', 'reversed', 'open', 'next', 'iter', 'format', 'all', 'any',
    'hash', 'vars', 'help', 'eval', 'exec', 'math', 'random', 'isinstance',
    'leer', 'texto', 'numero', 'entero', 'es_numero', 'main'];

  function isTakenName(name) {
    return PY_KEYWORDS.indexOf(name) >= 0 || PY_TAKEN.indexOf(name) >= 0;
  }

  /* ================================================================
     2 · Expresiones:  AST  ->  texto Python
     Cada nodo devuelve {s, p}: el texto y su precedencia, para poner
     paréntesis solo donde hacen falta.
  ================================================================ */
  const P = { or: 1, and: 2, not: 3, cmp: 4, add: 5, mul: 6, unary: 7, pow: 8, atom: 9 };

  const CMP_PY = { '=': '==', '<>': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
  const CMP_FLIP = { '=': '<>', '<>': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };

  /** Niega una condición sin apilar «not»: a == b  ->  a != b */
  function negate(ast) {
    if (ast.t === 'not') return ast.e;
    if (ast.t === 'cmp') return { t: 'cmp', op: CMP_FLIP[ast.op], l: ast.l, r: ast.r };
    return { t: 'not', e: ast };
  }

  function pyNumber(v) {
    if (Number.isInteger(v)) return String(v);
    if (!isFinite(v)) return v > 0 ? 'float("inf")' : 'float("-inf")';
    return String(v);
  }

  function pyString(s) {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') out += '\\\\';
      else if (c === '"') out += '\\"';
      else if (c === '\n') out += '\\n';
      else if (c === '\t') out += '\\t';
      else if (c === '\r') out += '\\r';
      else out += c;
    }
    return out + '"';
  }

  /* -- ¿el valor es seguro un texto? ¿es seguro un número? -------- */
  const TEXT_FUNCS = ['mayusculas', 'mayuscula', 'mayus', 'minusculas', 'minuscula',
    'minus', 'subcadena', 'subcad', 'concatenar', 'unir', 'cadena', 'texto'];

  function isText(ast) {
    if (!ast) return false;
    if (ast.t === 'lit') return typeof ast.v === 'string';
    if (ast.t === 'call') return TEXT_FUNCS.indexOf(ast.name) >= 0;
    if (ast.t === 'bin' && ast.op === '+') return isText(ast.l) || isText(ast.r);
    return false;
  }

  function isNumber(ast) {
    if (!ast) return false;
    if (ast.t === 'lit') return typeof ast.v === 'number';
    if (ast.t === 'neg') return true;
    if (ast.t === 'bin') return ast.op !== '+' || (isNumber(ast.l) && isNumber(ast.r));
    if (ast.t === 'call') return TEXT_FUNCS.indexOf(ast.name) < 0 && ast.name !== 'esnumero' && ast.name !== 'esnum';
    return false;
  }

  /**
   * Traductor de expresiones. Guarda los nombres usados, las notas
   * («mod» y los negativos...) y los ayudantes que habrá que escribir.
   */
  class ExprWriter {
    constructor(ctx) { this.ctx = ctx; }

    name(raw) { return this.ctx.pyName(raw); }
    note(key) { this.ctx.note(key); }
    need(helper) { this.ctx.need(helper); }
    use(mod) { this.ctx.imports[mod] = true; }

    /** Texto de la expresión, con paréntesis si su precedencia baja de min */
    at(ast, min) {
      const r = this.write(ast);
      return r.p < min ? '(' + r.s + ')' : r.s;
    }

    /** Convierte a texto como lo hace el diagrama (verdadero, 5 y no 5.0) */
    asText(ast) {
      if (isText(ast)) return this.at(ast, P.atom);
      this.need('texto');
      return 'texto(' + this.at(ast, P.or) + ')';
    }

    write(ast) {
      switch (ast.t) {
        case 'lit':
          if (typeof ast.v === 'boolean') return { s: ast.v ? 'True' : 'False', p: P.atom };
          if (typeof ast.v === 'number') {
            const s = pyNumber(ast.v);
            return { s: s, p: s[0] === '-' ? P.unary : P.atom };
          }
          return { s: pyString(ast.v), p: P.atom };

        case 'var':
          return { s: this.name(ast.name), p: P.atom };

        case 'neg':
          return { s: ast.sign + this.at(ast.e, P.unary), p: P.unary };

        case 'not':
          return { s: 'not ' + this.at(ast.e, P.unary), p: P.not };

        case 'and':
          return { s: this.at(ast.l, P.and) + ' and ' + this.at(ast.r, P.not), p: P.and };

        case 'or':
          return { s: this.at(ast.l, P.or) + ' or ' + this.at(ast.r, P.and), p: P.or };

        case 'cmp':
          return {
            s: this.at(ast.l, P.add) + ' ' + CMP_PY[ast.op] + ' ' + this.at(ast.r, P.add),
            p: P.cmp
          };

        case 'bin':
          return this.binary(ast);

        case 'call':
          return this.call(ast);
      }
      throw new FlowError('No se traducir esta expresión a Python');
    }

    binary(ast) {
      const op = ast.op;

      if (op === '+') {
        // en el diagrama «+» tambien junta textos; en Python hay que convertir
        if (isText(ast.l) || isText(ast.r)) {
          return { s: this.asTextSide(ast.l, P.add) + ' + ' + this.asTextSide(ast.r, P.mul), p: P.add };
        }
        return { s: this.at(ast.l, P.add) + ' + ' + this.at(ast.r, P.mul), p: P.add };
      }
      if (op === '-') return { s: this.at(ast.l, P.add) + ' - ' + this.at(ast.r, P.mul), p: P.add };
      if (op === '*') return { s: this.at(ast.l, P.mul) + ' * ' + this.at(ast.r, P.unary), p: P.mul };
      if (op === '/') {
        this.note('decimales');
        return { s: this.at(ast.l, P.mul) + ' / ' + this.at(ast.r, P.unary), p: P.mul };
      }

      if (op === 'mod') {
        this.note('mod');
        if (this.ctx.exactMod) {
          this.use('math');
          return { s: 'math.fmod(' + this.at(ast.l, P.or) + ', ' + this.at(ast.r, P.or) + ')', p: P.atom };
        }
        return { s: this.at(ast.l, P.mul) + ' % ' + this.at(ast.r, P.unary), p: P.mul };
      }
      if (op === 'div') {
        this.note('div');
        if (this.ctx.exactMod) {
          return { s: 'int(' + this.at(ast.l, P.mul) + ' / ' + this.at(ast.r, P.unary) + ')', p: P.atom };
        }
        return { s: this.at(ast.l, P.mul) + ' // ' + this.at(ast.r, P.unary), p: P.mul };
      }
      if (op === '^') {
        // ** liga a derecha: la base necesita paréntesis si no es atómica
        return { s: this.at(ast.l, P.atom) + ' ** ' + this.at(ast.r, P.unary), p: P.pow };
      }
      throw new FlowError('No se traducir el operador «' + op + '» a Python');
    }

    asTextSide(ast, min) {
      if (isText(ast)) return this.at(ast, min);
      this.need('texto');
      return 'texto(' + this.at(ast, P.or) + ')';
    }

    args(list) {
      const self = this;
      return list.map(function (a) { return self.at(a, P.or); });
    }

    call(ast) {
      const a = ast.args;
      const n = a.length;
      const self = this;
      const plain = function (fn) { return { s: fn + '(' + self.args(a).join(', ') + ')', p: P.atom }; };
      const math1 = function (fn) { self.use('math'); return plain('math.' + fn); };

      switch (ast.name) {
        case 'raiz': case 'sqrt': return math1('sqrt');
        case 'abs': case 'absoluto': return plain('abs');
        case 'redondear': case 'round':
          this.note('redondear');
          return plain('round');
        case 'truncar': case 'trunc': return math1('trunc');
        case 'piso': case 'floor': return math1('floor');
        case 'techo': case 'ceil': return math1('ceil');

        case 'min': case 'minimo':
          if (n === 1) return { s: this.at(a[0], P.or), p: P.atom };
          return plain('min');
        case 'max': case 'maximo':
          if (n === 1) return { s: this.at(a[0], P.or), p: P.atom };
          return plain('max');

        case 'pot': case 'potencia': case 'pow':
          return { s: this.at(a[0], P.atom) + ' ** ' + this.at(a[1], P.unary), p: P.pow };

        case 'aleatorio': case 'azar': case 'random':
          this.use('random');
          if (n === 0) return { s: 'random.random()', p: P.atom };
          if (n === 1) return { s: 'random.randint(1, ' + this.at(a[0], P.or) + ')', p: P.atom };
          return { s: 'random.randint(' + this.randomRange(a) + ')', p: P.atom };

        case 'sen': case 'sin': return math1('sin');
        case 'cos': return math1('cos');
        case 'tan': return math1('tan');
        case 'ln': return math1('log');
        case 'log': return math1('log10');
        case 'exp': return math1('exp');

        case 'longitud': case 'largo': case 'len':
          return { s: 'len(' + this.asText(a[0]) + ')', p: P.atom };

        case 'mayusculas': case 'mayuscula': case 'mayus':
          return { s: this.textSubject(a[0]) + '.upper()', p: P.atom };
        case 'minusculas': case 'minuscula': case 'minus':
          return { s: this.textSubject(a[0]) + '.lower()', p: P.atom };

        case 'subcadena': case 'subcad':
          return { s: this.textSubject(a[0]) + '[' + this.sliceFrom(a[1]) + ':' + this.sliceTo(a[2]) + ']', p: P.atom };

        case 'concatenar': case 'unir': {
          if (n === 1) return { s: this.asText(a[0]), p: P.atom };
          const parts = a.map(function (x, i) { return self.asTextSide(x, i === 0 ? P.add : P.mul); });
          return { s: parts.join(' + '), p: P.add };
        }

        case 'esnumero': case 'esnum':
          this.need('es_numero');
          return plain('es_numero');

        case 'numero': case 'anumero': case 'real':
          this.need('numero');
          return plain('numero');

        case 'entero':
          if (isNumber(a[0])) return { s: 'int(' + this.at(a[0], P.or) + ')', p: P.atom };
          this.need('entero');
          return plain('entero');

        case 'cadena': case 'texto':
          return { s: this.asText(a[0]), p: P.atom };
      }
      throw new FlowError('No se traducir la función «' + ast.raw + '» a Python');
    }

    /** Sujeto de .upper() / [i:j]: tiene que ser texto y atómico */
    textSubject(ast) {
      if (isText(ast)) return this.at(ast, P.atom);
      this.need('texto');
      return 'texto(' + this.at(ast, P.or) + ')';
    }

    // subcadena empieza en 1 y Python en 0
    sliceFrom(ast) {
      if (ast.t === 'lit' && typeof ast.v === 'number') return String(Math.max(0, Math.trunc(ast.v) - 1));
      return this.at(ast, P.add) + ' - 1';
    }
    sliceTo(ast) {
      if (ast.t === 'lit' && typeof ast.v === 'number') return String(Math.max(0, Math.trunc(ast.v)));
      return this.at(ast, P.add);
    }

    /** randint quiere el menor primero; si son números lo ordenamos */
    randomRange(a) {
      if (a[0].t === 'lit' && a[1].t === 'lit' &&
        typeof a[0].v === 'number' && typeof a[1].v === 'number' && a[0].v > a[1].v) {
        return pyNumber(Math.trunc(a[1].v)) + ', ' + pyNumber(Math.trunc(a[0].v));
      }
      return this.at(a[0], P.or) + ', ' + this.at(a[1], P.or);
    }
  }

  /* ================================================================
     3 · print
     El diagrama separa los trozos con un espacio salvo que ya haya
     uno. print() pone un espacio siempre, así que hay que ajustar:
     "Total: ", x   ->   print("Total:", x)
  ================================================================ */
  function buildPrint(list, writer) {
    const pieces = list.map(function (ast) {
      return {
        ast: ast,
        text: ast.t === 'lit' && typeof ast.v === 'string' ? ast.v : null
      };
    });

    // 1) qué separador pondría el diagrama entre cada par
    const seps = [''];
    let endsWs = false;
    for (let i = 0; i < pieces.length; i++) {
      const shown = pieces[i].text !== null ? pieces[i].text : 'X';
      if (i > 0) {
        const startsWs = /^\s/.test(shown);
        seps[i] = (!endsWs && !startsWs) ? ' ' : '';
      }
      if (shown === '') { if (seps[i] === ' ') endsWs = true; }
      else endsWs = /\s$/.test(shown);
    }

    // 2) el espacio que ya trae un texto pasa a ser el separador de print
    for (let i = 1; i < pieces.length; i++) {
      if (seps[i] !== '') continue;
      const prev = pieces[i - 1], cur = pieces[i];
      if (prev.text !== null && /[^\s] $/.test(prev.text)) {
        prev.text = prev.text.slice(0, -1);
        seps[i] = ' ';
      } else if (prev.text === ' ' && i === 1) {
        prev.text = '';
        seps[i] = ' ';
      } else if (cur.text !== null && /^ [^\s]/.test(cur.text)) {
        cur.text = cur.text.slice(1);
        seps[i] = ' ';
      } else if (cur.text === ' ') {
        cur.text = '';
        seps[i] = seps[i] + ' ';
      }
    }

    // 3) fuera los textos que quedaron vacíos (no imprimen nada)
    const kept = [];
    let pending = '';
    for (let i = 0; i < pieces.length; i++) {
      const sep = i > 0 ? seps[i] : '';
      if (pieces[i].text === '') { pending += sep; continue; }
      kept.push({ piece: pieces[i], sep: kept.length ? pending + sep : '' });
      pending = '';
    }
    if (!kept.length) return 'print("")';

    const simple = kept.every(function (k, i) { return i === 0 || k.sep === ' '; });
    const items = [];
    kept.forEach(function (k, i) {
      if (!simple && i > 0 && k.sep !== '') items.push(pyString(k.sep));
      items.push(k.piece.text !== null ? pyString(k.piece.text) : writer.at(k.piece.ast, P.or));
    });
    return 'print(' + items.join(', ') + (simple ? '' : ', sep=""') + ')';
  }

  /* ================================================================
     4 · El grafo como diagrama de flujo: dominadores y bucles
  ================================================================ */
  function buildCfg(graph) {
    const nodes = {};
    graph.nodes.forEach(function (n) { nodes[n.id] = n; });

    const succ = {};
    const preds = {};
    graph.nodes.forEach(function (n) { succ[n.id] = []; preds[n.id] = []; });
    graph.edges.forEach(function (e) {
      if (!nodes[e.from] || !nodes[e.to]) return;
      succ[e.from].push({ port: e.port, to: e.to, id: e.id });
      preds[e.to].push(e.from);
    });

    const starts = graph.nodes.filter(function (n) { return n.type === 'start'; });
    return { nodes: nodes, succ: succ, preds: preds, start: starts[0] ? starts[0].id : null };
  }

  function edgeTo(cfg, id, port) {
    const list = cfg.succ[id] || [];
    for (let i = 0; i < list.length; i++) if (list[i].port === port) return list[i];
    return null;
  }

  /** Recorrido en postorden inverso desde el Inicio */
  function reverseOrder(cfg) {
    const seen = {}, post = [];
    (function walk(id) {
      if (!id || seen[id]) return;
      seen[id] = true;
      (cfg.succ[id] || []).forEach(function (e) { walk(e.to); });
      post.push(id);
    })(cfg.start);
    return post.reverse();
  }

  function computeIdom(cfg, order) {
    const rpo = {};
    order.forEach(function (id, i) { rpo[id] = i; });
    const idom = {};
    idom[cfg.start] = cfg.start;

    function intersect(a, b) {
      while (a !== b) {
        while (rpo[a] > rpo[b]) a = idom[a];
        while (rpo[b] > rpo[a]) b = idom[b];
      }
      return a;
    }

    let changed = true;
    let guard = 0;
    while (changed && guard++ < 1000) {
      changed = false;
      for (let i = 1; i < order.length; i++) {
        const b = order[i];
        let nuevo = null;
        (cfg.preds[b] || []).forEach(function (p) {
          if (rpo[p] === undefined || idom[p] === undefined) return;
          nuevo = nuevo === null ? p : intersect(p, nuevo);
        });
        if (nuevo !== null && idom[b] !== nuevo) { idom[b] = nuevo; changed = true; }
      }
    }
    return { idom: idom, rpo: rpo };
  }

  function dominates(idom, a, b) {
    let cur = b;
    for (;;) {
      if (cur === a) return true;
      const up = idom[cur];
      if (!up || up === cur) return false;
      cur = up;
    }
  }

  /** Encuentra los bucles: una flecha que vuelve a un bloque que la domina */
  function findLoops(cfg, order, idom) {
    const byHeader = {};
    order.forEach(function (u) {
      (cfg.succ[u] || []).forEach(function (e) {
        if (idom[e.to] === undefined) return;
        if (dominates(idom, e.to, u)) {
          if (!byHeader[e.to]) byHeader[e.to] = [];
          byHeader[e.to].push({ from: u, edge: e });
        }
      });
    });

    const loops = {};
    Object.keys(byHeader).forEach(function (header) {
      const backs = byHeader[header];
      const body = {};
      body[header] = true;
      const stack = backs.map(function (b) { return b.from; });
      while (stack.length) {
        const n = stack.pop();
        if (body[n]) continue;
        body[n] = true;
        (cfg.preds[n] || []).forEach(function (p) { if (!body[p]) stack.push(p); });
      }
      loops[header] = { header: header, backs: backs, body: body };
    });
    return loops;
  }

  /* ================================================================
     5 · Del grafo al árbol de instrucciones
  ================================================================ */
  function stop(message, nodeId, edgeId) {
    const err = new FlowError(message);
    err.nodeId = nodeId || null;
    err.edgeId = edgeId || null;
    return err;
  }

  class Builder {
    constructor(graph, opts) {
      this.graph = graph;
      this.opts = opts;
      this.cfg = buildCfg(graph);
      if (!this.cfg.start) throw stop('Falta el bloque Inicio: sin él no se de dónde arranca el programa');

      this.order = reverseOrder(this.cfg);
      const dom = computeIdom(this.cfg, this.order);
      this.idom = dom.idom;
      this.rpo = dom.rpo;
      this.loops = findLoops(this.cfg, this.order, this.idom);

      this.emitted = {};
      this.names = {};      // nombre del diagrama -> nombre en Python
      this.usedNames = {};
      this.notes = {};
      this.helpers = {};
      this.imports = {};
      this.exactMod = !!opts.exactMod;
      this.writer = new ExprWriter(this);
      this.ends = 0;
    }

    /* -- servicios para el traductor de expresiones -- */
    pyName(raw) {
      if (this.names[raw]) return this.names[raw];
      let name = raw;
      while (isTakenName(name) || (this.usedNames[name] && this.usedNames[name] !== raw)) name += '_';
      this.names[raw] = name;
      this.usedNames[name] = raw;
      if (name !== raw) this.note('renombrado');
      return name;
    }
    note(key) { this.notes[key] = true; }
    need(helper) { this.helpers[helper] = true; }

    node(id) { return this.cfg.nodes[id]; }
    text(id) { return Flow.nodeText(this.node(id)).trim(); }

    /** Ejecuta fn y, si falla, deja claro de qué bloque es la culpa */
    at(nodeId, fn) {
      try {
        return fn.call(this);
      } catch (err) {
        if (err instanceof FlowError && !err.nodeId) err.nodeId = nodeId;
        throw err;
      }
    }

    loopAt(id) { return this.loops[id] || null; }

    /* -- el bloque siguiente, con un error claro si falta la flecha -- */
    nextOf(id, port) {
      const e = edgeTo(this.cfg, id, port);
      if (!e) {
        const via = port === 'out' ? '' : ' por la rama ' + Flow.PORT_LABEL[port];
        throw stop('El bloque ' + Flow.nodeLabel(this.node(id)) + ' no tiene flecha de salida' + via +
          ', así que no se por dónde sigue el programa', id);
      }
      if (!this.node(e.to)) throw stop('Una flecha apunta a un bloque que ya no existe', id, e.id);
      return e;
    }

    /* -- hasta dónde llega una rama (para saber dónde se juntan) -- */
    reachFrom(id, ctx) {
      const seen = {};
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen[cur]) continue;
        seen[cur] = true;
        if (cur === ctx.stop) continue;
        if (ctx.loop && (cur === ctx.loop.header || cur === ctx.loop.exit)) continue;
        const node = this.node(cur);
        if (!node || node.type === 'end') continue;
        (this.cfg.succ[cur] || []).forEach(function (e) { stack.push(e.to); });
      }
      return seen;
    }

    /** Donde vuelven a juntarse las dos ramas de una decisión */
    joinOf(a, b, ctx) {
      const ra = this.reachFrom(a, ctx);
      const rb = this.reachFrom(b, ctx);
      const common = Object.keys(ra).filter(function (id) { return rb[id]; });
      if (!common.length) return null;
      const self = this;
      common.sort(function (x, y) { return (self.rpo[x] || 0) - (self.rpo[y] || 0); });
      for (let i = 0; i < common.length; i++) {
        const cand = common[i];
        const reach = this.reachFrom(cand, ctx);
        const cubre = common.every(function (id) { return id === cand || reach[id]; });
        if (cubre) return cand;
      }
      return common[0];
    }

    /* -- el recorrido principal -- */
    seq(startId, ctx) {
      const list = [];
      let id = startId;
      let first = true;
      let fromId = ctx.fromId || null;
      let fromEdge = ctx.fromEdge || null;

      for (;;) {
        if (!id) break;
        const isFirst = first;
        first = false;

        if (ctx.loop && id === ctx.loop.header && !(isFirst && ctx.atHeader)) {
          list.push({ k: 'continue', node: fromId });
          break;
        }
        if (ctx.loop && id === ctx.loop.exit) {
          list.push({ k: 'break', node: fromId });
          break;
        }
        if (id === ctx.stop) break;

        const node = this.node(id);
        if (!node) throw stop('Una flecha apunta a un bloque que ya no existe', fromId, fromEdge);

        if (node.type === 'end') {
          this.ends++;
          list.push({ k: 'end', node: id });
          break;
        }

        const loop = this.loopAt(id);
        if (loop && !(ctx.loop && ctx.loop.header === id)) {
          const st = this.at(id, function () { return this.buildLoop(loop, ctx); });
          list.push(st);
          if (!loop.exit) break;
          fromId = id;
          fromEdge = null;
          id = loop.exit;
          continue;
        }

        if (this.emitted[id]) {
          throw stop('La flecha que llega a este bloque ' + Flow.nodeLabel(node) +
            ' vuelve a un sitio por el que el programa ya pasó, y eso no se puede escribir en Python ' +
            'sin saltos. Conviértelo en un bucle: que la flecha vuelva a la decisión que lo controla.',
            fromId || id, fromEdge);
        }
        this.emitted[id] = true;

        if (node.type === 'decision') {
          const res = this.at(id, function () { return this.buildIf(node, ctx); });
          list.push(res.stmt);
          if (!res.join) break;
          fromId = id;
          fromEdge = null;
          id = res.join;
          continue;
        }

        const st = this.at(id, function () { return this.buildSimple(node); });
        if (st) list.push(st);
        const e = this.nextOf(id, 'out');
        fromId = id;
        fromEdge = e.id;
        id = e.to;
      }

      return list;
    }

    buildSimple(node) {
      const text = this.text(node.id);
      switch (node.type) {
        case 'start':
          return null;

        case 'input': {
          const names = Expr.parseNames(text);
          const self = this;
          this.need('leer');
          return {
            k: 'read', node: node.id,
            names: names.map(function (n) { return { py: self.pyName(n), label: n }; })
          };
        }

        case 'process': {
          const stmts = Expr.parseAssignments(text);
          const self = this;
          return {
            k: 'block', node: node.id,
            parts: stmts.map(function (st) {
              // primero la expresión, por si usa la variable con su nombre viejo
              const value = self.writer.at(st.ast, P.or);
              return { name: self.pyName(st.name), value: value };
            })
          };
        }

        case 'output': {
          const list = Expr.parseExprList(text, Flow.WRITE_WORDS);
          if (!list.length) throw stop('El bloque Salida no dice qué mostrar', node.id);
          return { k: 'print', node: node.id, code: buildPrint(list, this.writer) };
        }
      }
      throw stop('No se traducir un bloque de tipo ' + node.type + ' a Python', node.id);
    }

    buildIf(node, ctx) {
      const cond = Expr.parseExpression(this.text(node.id));
      const yes = this.nextOf(node.id, 'true').to;
      const no = this.nextOf(node.id, 'false').to;

      if (yes === no) {
        // las dos ramas van al mismo sitio: la pregunta no cambia nada
        return {
          stmt: { k: 'note', node: node.id, text: 'la decisión «' + this.text(node.id) + '» lleva al mismo bloque por las dos ramas' },
          join: yes
        };
      }

      const join = this.joinOf(yes, no, ctx);
      const thenList = this.seq(yes, { stop: join, loop: ctx.loop, fromId: node.id });
      const elseList = this.seq(no, { stop: join, loop: ctx.loop, fromId: node.id });

      let stmt;
      if (!thenList.length && elseList.length) {
        stmt = { k: 'if', node: node.id, cond: negate(cond), then: elseList, other: [] };
      } else {
        stmt = { k: 'if', node: node.id, cond: cond, then: thenList, other: elseList };
      }
      return { stmt: stmt, join: join };
    }

    buildLoop(loop, ctx) {
      const header = loop.header;
      const node = this.node(header);
      const body = loop.body;
      const self = this;

      // por dónde se sale del bucle (el Fin no cuenta: ese es un return)
      const salidas = [];
      const destinos = [];
      Object.keys(body).forEach(function (id) {
        (self.cfg.succ[id] || []).forEach(function (e) {
          if (body[e.to]) return;
          const dest = self.node(e.to);
          if (!dest || dest.type === 'end') return;
          salidas.push({ to: e.to, from: id, edge: e.id });
          if (destinos.indexOf(e.to) < 0) destinos.push(e.to);
        });
      });

      let cond = null;
      let bodyStart = header;
      let atHeader = true;
      let exit = null;

      if (node.type === 'decision') {
        const yes = this.nextOf(header, 'true').to;
        const no = this.nextOf(header, 'false').to;
        const yesIn = !!body[yes], noIn = !!body[no];
        if (yesIn !== noIn) {
          // la condición del rombo es la del while y la otra rama es la salida
          const raw = Expr.parseExpression(this.text(header));
          cond = yesIn ? raw : negate(raw);
          bodyStart = yesIn ? yes : no;
          exit = yesIn ? no : yes;
          atHeader = false;
          this.emitted[header] = true;
        }
      }

      const otros = destinos.filter(function (d) { return d !== exit; });
      if ((cond && otros.length) || (!cond && destinos.length > 1)) {
        const target = cond ? otros[0] : destinos[1];
        const culpable = salidas.filter(function (s) { return s.to === target; })[0] || salidas[0];
        throw stop('Este bucle se sale por dos sitios distintos y en Python solo se puede salir a uno. ' +
          'Haz que las dos salidas lleguen al mismo bloque.',
          culpable ? culpable.from : header, culpable ? culpable.edge : null);
      }
      if (!exit) exit = destinos[0] || null;

      loop.exit = exit;
      const bodyList = this.seq(bodyStart, { loop: loop, stop: null, atHeader: atHeader, fromId: header });
      stripTailContinue(bodyList);
      const clean = tidyLoopBody(bodyList);

      return { k: 'while', node: header, cond: cond, body: clean, exit: exit };
    }
  }

  /* ================================================================
     6 · Limpieza del árbol
     El recorrido deja «continue» de más y ramas anidadas donde Python
     escribiría algo más corto.
  ================================================================ */
  function terminates(list) {
    if (!list || !list.length) return false;
    const last = list[list.length - 1];
    if (last.k === 'break' || last.k === 'continue' || last.k === 'end') return true;
    if (last.k === 'if') return terminates(last.then) && terminates(last.other);
    return false;
  }

  /** El «continue» final de un bucle no hace falta */
  function stripTailContinue(list) {
    while (list && list.length) {
      const last = list[list.length - 1];
      // al quitar uno queda otro al final, así que hay que volver a mirar
      if (last.k === 'continue') { list.pop(); continue; }
      if (last.k === 'if') {
        stripTailContinue(last.then);
        stripTailContinue(last.other);
      }
      return;
    }
  }

  /** Saca de la rama lo que no necesita estar dentro */
  function tidyLoopBody(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      if (st.k === 'if') {
        st.then = tidyLoopBody(st.then);
        st.other = tidyLoopBody(st.other);

        // si (cond) { continue } sino { resto }   ->   si (no cond) { resto }
        if (st.then.length === 1 && st.then[0].k === 'continue' && st.other.length) {
          out.push({ k: 'if', node: st.node, cond: negate(st.cond), then: st.other, other: [] });
          continue;
        }
        // si (cond) { ... } sino { continue }   ->   si (cond) { ... }
        if (st.other.length === 1 && st.other[0].k === 'continue') {
          out.push({ k: 'if', node: st.node, cond: st.cond, then: st.then, other: [] });
          continue;
        }
        // si la primera rama corta el paso, la otra no necesita estar dentro
        if (st.other.length && terminates(st.then)) {
          out.push({ k: 'if', node: st.node, cond: st.cond, then: st.then, other: [] });
          const resto = tidyLoopBody(st.other);
          for (let j = 0; j < resto.length; j++) out.push(resto[j]);
          continue;
        }
        out.push(st);
        continue;
      }
      out.push(st);
      if (st.k === 'break' || st.k === 'continue' || st.k === 'end') break;
    }
    return out;
  }

  /* ================================================================
     7 · Del árbol al texto
  ================================================================ */
  const HELPERS = {
    leer: [
      'def leer(mensaje=""):',
      '    """Convierte el dato como el diagrama: número, lógico o texto."""',
      '    dato = input(mensaje).strip()',
      '    if dato.lower() in ("verdadero", "true"):',
      '        return True',
      '    if dato.lower() in ("falso", "false"):',
      '        return False',
      '    try:',
      '        valor = float(dato.replace(",", "."))',
      '        return int(valor) if valor == int(valor) else valor',
      '    except (ValueError, OverflowError):',
      '        return dato'
    ],
    texto: [
      'def texto(valor):',
      '    """Pasa un valor a texto como lo muestra el diagrama."""',
      '    if isinstance(valor, bool):',
      '        return "verdadero" if valor else "falso"',
      '    if isinstance(valor, float) and valor == int(valor):',
      '        return str(int(valor))',
      '    return str(valor)'
    ],
    numero: [
      'def numero(valor):',
      '    """Convierte un texto en número (acepta la coma decimal)."""',
      '    if isinstance(valor, bool):',
      '        raise ValueError("no puedo convertir un valor lógico en número")',
      '    if isinstance(valor, (int, float)):',
      '        return valor',
      '    valor = float(str(valor).strip().replace(",", "."))',
      '    return int(valor) if valor == int(valor) else valor'
    ],
    entero: [
      'def entero(valor):',
      '    """Convierte a número entero quitando los decimales."""',
      '    return int(numero(valor))'
    ],
    es_numero: [
      'def es_numero(valor):',
      '    """Dice si el valor se puede usar como número."""',
      '    if isinstance(valor, bool):',
      '        return False',
      '    if isinstance(valor, (int, float)):',
      '        return True',
      '    try:',
      '        float(str(valor).strip().replace(",", "."))',
      '        return True',
      '    except ValueError:',
      '        return False'
    ]
  };
  const HELPER_ORDER = ['leer', 'texto', 'numero', 'entero', 'es_numero'];

  const NOTES = {
    mod: '«mod» se traduce como «%». Solo cambia con negativos: -7 mod 3 da -1 en el diagrama y 2 en Python.',
    div: '«div» se traduce como «//». Solo cambia con negativos: -7 div 2 da -3 en el diagrama y -4 en Python.',
    redondear: '«redondear» se traduce como «round», que en Python redondea 2.5 a 2 (al par más cercano) y no a 3.',
    decimales: 'Python muestra las divisiones con decimales: 4 / 2 sale como 2.0 donde el diagrama escribe 2.',
    renombrado: 'Alguna variable cambió de nombre porque en Python ya significa otra cosa.'
  };

  class Printer {
    constructor(opts) {
      this.opts = opts;
      this.lines = [];
    }
    push(text, node) { this.lines.push({ text: text, node: node || null }); }
    blank() { if (this.lines.length) this.push('', null); }

    body(list, depth) {
      if (!list.length) { this.push(pad(depth) + 'pass', null); return; }
      for (let i = 0; i < list.length; i++) this.stmt(list[i], depth);
    }

    stmt(st, depth) {
      const tab = pad(depth);
      switch (st.k) {
        case 'block':
          st.parts.forEach(function (p) { this.push(tab + p.name + ' = ' + p.value, st.node); }, this);
          return;

        case 'read':
          st.names.forEach(function (n) {
            const arg = this.opts.prompts ? pyString(n.label + ' = ') : '';
            this.push(tab + n.py + ' = leer(' + arg + ')', st.node);
          }, this);
          return;

        case 'print':
          this.push(tab + st.code, st.node);
          return;

        case 'note':
          this.push(tab + '# ' + st.text, st.node);
          return;

        case 'if':
          this.ifChain(st, depth, 'if');
          return;

        case 'while':
          // «while True» no sale de ningun bloque; «while cond» es el rombo
          this.push(tab + 'while ' + (st.cond ? this.cond(st.cond) : 'True') + ':',
            st.cond ? st.node : null);
          this.body(st.body, depth + 1);
          return;

        case 'break':
          this.push(tab + 'break', st.node);
          return;
        case 'continue':
          this.push(tab + 'continue', st.node);
          return;
        case 'end':
          this.push(tab + 'return', st.node);
          return;
      }
    }

    ifChain(st, depth, keyword) {
      const tab = pad(depth);
      this.push(tab + keyword + ' ' + this.cond(st.cond) + ':', st.node);
      this.body(st.then, depth + 1);
      if (!st.other || !st.other.length) return;
      if (st.other.length === 1 && st.other[0].k === 'if') {
        this.ifChain(st.other[0], depth, 'elif');
        return;
      }
      this.push(tab + 'else:', st.node);
      this.body(st.other, depth + 1);
    }

    cond(ast) { return this.opts.writer.at(ast, P.or); }
  }

  function pad(depth) {
    let s = '';
    for (let i = 0; i < depth; i++) s += INDENT;
    return s;
  }

  /* ================================================================
     8 · La puerta de entrada
  ================================================================ */
  /**
   * Traduce el diagrama a Python.
   * opts: {prompts: true, exactMod: false}
   * Devuelve {ok, code, lines, notes, problem}
   *   lines: [{text, node}] para poder resaltar el bloque en curso
   */
  function generate(graph, opts) {
    opts = opts || {};
    const options = {
      prompts: opts.prompts !== false,
      exactMod: !!opts.exactMod
    };

    let builder = null;
    try {
      builder = new Builder(graph, options);
      const tree = builder.seq(builder.cfg.start, { stop: null, loop: null });
      return assemble(graph, builder, tree, options);
    } catch (err) {
      if (!(err instanceof FlowError)) throw err;
      const lines = [
        { text: '# No puedo traducir este diagrama a Python todavía:', node: null },
        { text: '#', node: null }
      ];
      wrap(err.message, 68).forEach(function (t) { lines.push({ text: '# ' + t, node: err.nodeId || null }); });
      return {
        ok: false,
        code: lines.map(function (l) { return l.text; }).join('\n') + '\n',
        lines: lines,
        notes: [],
        problem: { message: err.message, nodeId: err.nodeId || null, edgeId: err.edgeId || null }
      };
    }
  }

  function assemble(graph, builder, tree, options) {
    // un solo Fin al final del todo -> programa plano; si no, hace falta main()
    let needsMain = builder.ends > 0;
    if (builder.ends === 1 && tree.length && tree[tree.length - 1].k === 'end') {
      tree.pop();
      needsMain = false;
    }
    if (needsMain) {
      while (tree.length && tree[tree.length - 1].k === 'end') tree.pop();
    }

    const printer = new Printer({ prompts: options.prompts, writer: builder.writer });
    printer.body(tree, needsMain ? 1 : 0);
    const bodyLines = printer.lines.length ? printer.lines : [{ text: 'pass', node: null }];

    const out = [];
    const title = (graph.title || 'Diagrama sin título').replace(/\s+/g, ' ').trim();
    out.push({ text: '# ' + title, node: null });
    out.push({ text: '# Traducido del diagrama de flujo', node: null });

    const mods = Object.keys(builder.imports).sort();
    if (mods.length) {
      out.push({ text: '', node: null });
      mods.forEach(function (m) { out.push({ text: 'import ' + m, node: null }); });
    }

    HELPER_ORDER.forEach(function (name) {
      if (!builder.helpers[name]) return;
      out.push({ text: '', node: null });
      out.push({ text: '', node: null });
      HELPERS[name].forEach(function (t) { out.push({ text: t, node: null }); });
    });

    out.push({ text: '', node: null });
    out.push({ text: '', node: null });
    if (needsMain) {
      out.push({ text: 'def main():', node: null });
      bodyLines.forEach(function (l) { out.push(l); });
      out.push({ text: '', node: null });
      out.push({ text: '', node: null });
      out.push({ text: 'main()', node: null });
    } else {
      bodyLines.forEach(function (l) { out.push(l); });
    }

    const notes = Object.keys(builder.notes).map(function (k) { return NOTES[k]; })
      .filter(function (t) { return !!t; });

    return {
      ok: true,
      code: out.map(function (l) { return l.text; }).join('\n') + '\n',
      lines: out,
      notes: notes,
      problem: null
    };
  }

  function wrap(text, width) {
    const words = String(text).split(/\s+/);
    const out = [];
    let line = '';
    words.forEach(function (w) {
      if (!line) line = w;
      else if ((line + ' ' + w).length <= width) line += ' ' + w;
      else { out.push(line); line = w; }
    });
    if (line) out.push(line);
    return out;
  }

  /** Número de línea (1) del primer renglón que salió de ese bloque */
  function lineOf(result, nodeId) {
    if (!result || !nodeId) return 0;
    for (let i = 0; i < result.lines.length; i++) {
      if (result.lines[i].node === nodeId) return i + 1;
    }
    return 0;
  }

  function fileName(title) {
    let base = String(title || 'diagrama');
    if (base.normalize) base = base.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return (clean || 'diagrama') + '.py';
  }

  root.FlowPy = {
    generate: generate,
    lineOf: lineOf,
    fileName: fileName,
    negate: negate,
    NOTES: NOTES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
