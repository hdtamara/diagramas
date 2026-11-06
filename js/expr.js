/* ------------------------------------------------------------------
   expr.js  ·  Interprete de expresiones en pseudocódigo
   Sin dependencias del DOM: se puede probar con Node.
   Expone globalThis.FlowExpr
------------------------------------------------------------------ */
(function (root) {
  'use strict';

  /* ---------- errores ---------- */
  class FlowError extends Error {
    constructor(message) {
      super(message);
      this.name = 'FlowError';
    }
  }

  /* ---------- tokenizador ---------- */
  // Letras latinas incluyendo acentos y enie (Latin-1 sin los signos x y división)
  const ID_START = /[A-Za-zÀ-ÖØ-öø-ÿ_]/;
  const ID_PART = /[A-Za-z0-9À-ÖØ-öø-ÿ_]/;
  const DIGIT = /[0-9]/;

  // Los más largos primero para que "<=" gane a "<"
  const PUNCT = ['<=', '>=', '<>', '!=', '==', '**', '<-', ':=', '&&', '||',
    '←', '+', '-', '*', '/', '%', '^', '(', ')', ',', '<', '>', '=', '!'];

  function tokenize(src) {
    const s = src == null ? '' : String(src);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }

      if (DIGIT.test(c) || (c === '.' && DIGIT.test(s[i + 1] || ''))) {
        let j = i;
        while (j < s.length && DIGIT.test(s[j])) j++;
        if (s[j] === '.' && DIGIT.test(s[j + 1] || '')) {
          j++;
          while (j < s.length && DIGIT.test(s[j])) j++;
        }
        if (s[j] === 'e' || s[j] === 'E') {
          let k = j + 1;
          if (s[k] === '+' || s[k] === '-') k++;
          if (DIGIT.test(s[k] || '')) {
            while (k < s.length && DIGIT.test(s[k])) k++;
            j = k;
          }
        }
        out.push({ k: 'num', v: parseFloat(s.slice(i, j)), pos: i });
        i = j;
        continue;
      }

      if (c === '"' || c === "'") {
        let j = i + 1, text = '';
        while (j < s.length && s[j] !== c) {
          if (s[j] === '\\' && j + 1 < s.length) {
            const n = s[j + 1];
            text += n === 'n' ? '\n' : n === 't' ? '\t' : n;
            j += 2;
          } else {
            text += s[j];
            j++;
          }
        }
        if (j >= s.length) throw new FlowError('Falta cerrar la comilla del texto');
        out.push({ k: 'str', v: text, pos: i });
        i = j + 1;
        continue;
      }

      if (ID_START.test(c)) {
        let j = i;
        while (j < s.length && ID_PART.test(s[j])) j++;
        out.push({ k: 'id', v: s.slice(i, j), pos: i });
        i = j;
        continue;
      }

      const p = PUNCT.find(function (op) { return s.startsWith(op, i); });
      if (p) { out.push({ k: 'op', v: p, pos: i }); i += p.length; continue; }

      throw new FlowError('No entiendo el símbolo «' + c + '»');
    }
    out.push({ k: 'eof', v: '', pos: s.length });
    return out;
  }

  /* ---------- parser ----------
     Las palabras  y / o / no / mod / div  solo se leen como operadores
     cuando aparecen en posicion de operador; así "y = 2 * x" sigue
     usando  y  como variable.                                        */
  const ASSIGN_OPS = ['=', '<-', ':=', '←'];

  class Parser {
    constructor(tokens) { this.t = tokens; this.i = 0; }
    peek() { return this.t[this.i]; }
    next() { return this.t[this.i++]; }
    atEnd() { return this.peek().k === 'eof'; }
    atOp() {
      const tk = this.peek();
      if (tk.k !== 'op') return false;
      for (let a = 0; a < arguments.length; a++) if (arguments[a] === tk.v) return true;
      return false;
    }
    atWord() {
      const tk = this.peek();
      if (tk.k !== 'id') return false;
      const low = tk.v.toLowerCase();
      for (let a = 0; a < arguments.length; a++) if (arguments[a] === low) return true;
      return false;
    }
    eat() { return this.atOp.apply(this, arguments) ? this.next().v : null; }
    eatWord() { return this.atWord.apply(this, arguments) ? this.next().v.toLowerCase() : null; }
    near() {
      const tk = this.peek();
      return tk.k === 'eof' ? ' al final de la expresión' : ' cerca de «' + tk.v + '»';
    }
    expectOp(v) {
      if (!this.atOp(v)) throw new FlowError('Falta «' + v + '»' + this.near());
      return this.next();
    }
    expectEnd() {
      if (!this.atEnd()) throw new FlowError('Sobra «' + this.peek().v + '» en la expresión');
    }

    parseExpr() { return this.parseOr(); }

    parseOr() {
      let l = this.parseAnd();
      while (this.eatWord('o', 'or') || this.eat('||')) l = { t: 'or', l: l, r: this.parseAnd() };
      return l;
    }
    parseAnd() {
      let l = this.parseNot();
      while (this.eatWord('y', 'and') || this.eat('&&')) l = { t: 'and', l: l, r: this.parseNot() };
      return l;
    }
    parseNot() {
      if (this.eatWord('no', 'not') || this.eat('!')) return { t: 'not', e: this.parseNot() };
      return this.parseCmp();
    }
    parseCmp() {
      let l = this.parseAdd();
      for (;;) {
        if (this.atOp('=')) {
          // el error mas comun al escribir condiciones
          throw new FlowError('Para comparar se escribe == (dos iguales). ' +
            'Un solo = sirve para dar valor a una variable');
        }
        if (!this.atOp('<=', '>=', '<>', '!=', '==', '<', '>')) return l;
        let op = this.next().v;
        if (op === '==') op = '=';
        if (op === '!=') op = '<>';
        l = { t: 'cmp', op: op, l: l, r: this.parseAdd() };
      }
    }
    parseAdd() {
      let l = this.parseMul();
      for (;;) {
        const op = this.eat('+', '-');
        if (!op) return l;
        l = { t: 'bin', op: op, l: l, r: this.parseMul() };
      }
    }
    parseMul() {
      let l = this.parseUnary();
      for (;;) {
        let op = this.eat('*', '/', '%') || this.eatWord('mod', 'div');
        if (!op) return l;
        if (op === '%') op = 'mod';
        l = { t: 'bin', op: op, l: l, r: this.parseUnary() };
      }
    }
    parseUnary() {
      const op = this.eat('-', '+');
      if (op) return { t: 'neg', sign: op, e: this.parseUnary() };
      return this.parsePow();
    }
    parsePow() {
      const base = this.parsePrimary();
      if (this.eat('^', '**')) return { t: 'bin', op: '^', l: base, r: this.parseUnary() };
      return base;
    }
    parsePrimary() {
      const tk = this.peek();
      if (tk.k === 'num' || tk.k === 'str') { this.next(); return { t: 'lit', v: tk.v }; }
      if (this.atOp('(')) {
        this.next();
        const e = this.parseExpr();
        this.expectOp(')');
        return e;
      }
      if (tk.k === 'id') {
        const low = tk.v.toLowerCase();
        this.next();
        if (low === 'verdadero' || low === 'true') return { t: 'lit', v: true };
        if (low === 'falso' || low === 'false') return { t: 'lit', v: false };
        if (this.atOp('(')) {
          this.next();
          const args = [];
          if (!this.atOp(')')) {
            do { args.push(this.parseExpr()); } while (this.eat(','));
          }
          this.expectOp(')');
          return { t: 'call', name: low, raw: tk.v, args: args };
        }
        if (low === 'pi') return { t: 'lit', v: Math.PI };
        return { t: 'var', name: tk.v };
      }
      if (tk.k === 'eof') throw new FlowError('La expresión está incompleta');
      throw new FlowError('No esperaba «' + tk.v + '» aquí');
    }
  }

  /* ---------- comprobaciones de tipo ---------- */
  function needNum(v, who) {
    if (typeof v !== 'number') {
      throw new FlowError('«' + who + '» necesita un número y recibió ' + describe(v));
    }
    return v;
  }
  function needText(v, who) {
    if (typeof v === 'number' || typeof v === 'boolean') return formatValue(v);
    if (typeof v !== 'string') throw new FlowError('«' + who + '» necesita un texto');
    return v;
  }
  function needBool(v, who) {
    if (typeof v !== 'boolean') {
      throw new FlowError('«' + who + '» necesita una condición verdadero/falso y recibió ' + describe(v));
    }
    return v;
  }
  function finite(v, who) {
    if (typeof v !== 'number' || !isFinite(v)) {
      throw new FlowError('El resultado de «' + who + '» no es un número válido');
    }
    return v;
  }

  /* ---------- funciones disponibles ---------- */
  const FUNCS = {};
  function def(names, min, max, fn) {
    names.forEach(function (n) { FUNCS[n] = { name: names[0], min: min, max: max, fn: fn }; });
  }

  def(['raiz', 'sqrt'], 1, 1, function (a, name) {
    const x = needNum(a[0], name);
    if (x < 0) throw new FlowError('No se puede sacar la raíz de un número negativo');
    return Math.sqrt(x);
  });
  def(['abs', 'absoluto'], 1, 1, function (a, n) { return Math.abs(needNum(a[0], n)); });
  def(['redondear', 'round'], 1, 2, function (a, n) {
    const x = needNum(a[0], n);
    const d = a.length > 1 ? needNum(a[1], n) : 0;
    const f = Math.pow(10, Math.trunc(d));
    return Math.round(x * f) / f;
  });
  def(['truncar', 'trunc'], 1, 1, function (a, n) { return Math.trunc(needNum(a[0], n)); });
  def(['piso', 'floor'], 1, 1, function (a, n) { return Math.floor(needNum(a[0], n)); });
  def(['techo', 'ceil'], 1, 1, function (a, n) { return Math.ceil(needNum(a[0], n)); });
  def(['min', 'minimo'], 1, 99, function (a, n) {
    return Math.min.apply(null, a.map(function (v) { return needNum(v, n); }));
  });
  def(['max', 'maximo'], 1, 99, function (a, n) {
    return Math.max.apply(null, a.map(function (v) { return needNum(v, n); }));
  });
  def(['pot', 'potencia', 'pow'], 2, 2, function (a, n) {
    return finite(Math.pow(needNum(a[0], n), needNum(a[1], n)), n);
  });
  def(['aleatorio', 'azar', 'random'], 0, 2, function (a, n) {
    if (a.length === 0) return Math.random();
    if (a.length === 1) {
      const top = Math.trunc(needNum(a[0], n));
      if (top < 1) throw new FlowError('«aleatorio» necesita un número mayor que 0');
      return 1 + Math.floor(Math.random() * top);
    }
    let lo = Math.trunc(needNum(a[0], n));
    let hi = Math.trunc(needNum(a[1], n));
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  });
  def(['sen', 'sin'], 1, 1, function (a, n) { return Math.sin(needNum(a[0], n)); });
  def(['cos'], 1, 1, function (a, n) { return Math.cos(needNum(a[0], n)); });
  def(['tan'], 1, 1, function (a, n) { return finite(Math.tan(needNum(a[0], n)), n); });
  def(['ln'], 1, 1, function (a, n) {
    const x = needNum(a[0], n);
    if (x <= 0) throw new FlowError('«ln» necesita un número mayor que 0');
    return Math.log(x);
  });
  def(['log'], 1, 1, function (a, n) {
    const x = needNum(a[0], n);
    if (x <= 0) throw new FlowError('«log» necesita un número mayor que 0');
    return Math.log(x) / Math.LN10;
  });
  def(['exp'], 1, 1, function (a, n) { return finite(Math.exp(needNum(a[0], n)), n); });
  def(['longitud', 'largo', 'len'], 1, 1, function (a, n) { return needText(a[0], n).length; });
  def(['mayusculas', 'mayuscula', 'mayus'], 1, 1, function (a, n) { return needText(a[0], n).toUpperCase(); });
  def(['minusculas', 'minuscula', 'minus'], 1, 1, function (a, n) { return needText(a[0], n).toLowerCase(); });
  def(['subcadena', 'subcad'], 3, 3, function (a, n) {
    const s = needText(a[0], n);
    const from = Math.trunc(needNum(a[1], n));
    const to = Math.trunc(needNum(a[2], n));
    return s.slice(Math.max(0, from - 1), Math.max(0, to));
  });
  def(['concatenar', 'unir'], 1, 99, function (a, n) {
    return a.map(function (v) { return needText(v, n); }).join('');
  });
  def(['esnumero', 'esnum'], 1, 1, function (a) {
    if (typeof a[0] === 'number') return true;
    if (typeof a[0] !== 'string') return false;
    return a[0].trim() !== '' && !isNaN(Number(a[0].trim().replace(',', '.')));
  });
  def(['numero', 'anumero', 'real'], 1, 1, function (a) {
    if (typeof a[0] === 'number') return a[0];
    const raw = String(a[0]).trim().replace(',', '.');
    const x = Number(raw);
    if (raw === '' || isNaN(x)) {
      throw new FlowError('No puedo convertir ' + describe(a[0]) + ' en número');
    }
    return x;
  });
  def(['entero'], 1, 1, function (a) {
    if (typeof a[0] === 'number') return Math.trunc(a[0]);
    const raw = String(a[0]).trim().replace(',', '.');
    const x = Number(raw);
    if (raw === '' || isNaN(x)) {
      throw new FlowError('No puedo convertir ' + describe(a[0]) + ' en número');
    }
    return Math.trunc(x);
  });
  def(['cadena', 'texto'], 1, 1, function (a) { return formatValue(a[0]); });

  /* ---------- presentación de valores ---------- */
  function formatValue(v) {
    if (typeof v === 'boolean') return v ? 'verdadero' : 'falso';
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      if (!isFinite(v)) return v > 0 ? 'infinito' : '-infinito';
      const rounded = Math.round(v * 1e10) / 1e10;
      const s = String(rounded);
      return s.length > 17 ? String(Number(v.toPrecision(12))) : s;
    }
    if (v === undefined || v === null) return 'sin valor';
    return String(v);
  }
  function formatLiteral(v) {
    return typeof v === 'string' ? '"' + v + '"' : formatValue(v);
  }
  function describe(v) {
    if (typeof v === 'string') return 'el texto "' + v + '"';
    if (typeof v === 'boolean') return 'el valor lógico ' + formatValue(v);
    if (typeof v === 'number') return 'el número ' + formatValue(v);
    return 'un valor vacío';
  }
  function typeName(v) {
    if (typeof v === 'string') return 'texto';
    if (typeof v === 'boolean') return 'lógico';
    if (typeof v === 'number') return Number.isInteger(v) ? 'entero' : 'real';
    return '?';
  }

  /* ---------- sugerencia de nombre parecido ---------- */
  function editDistance(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  function suggestName(name, vars) {
    const keys = Object.keys(vars);
    let best = null, bestD = 99;
    const low = String(name).toLowerCase();
    keys.forEach(function (k) {
      const d = editDistance(low, k.toLowerCase());
      if (d < bestD) { bestD = d; best = k; }
    });
    if (best !== null && bestD <= Math.max(1, Math.floor(String(name).length / 3))) {
      return '. Quizá querías decir «' + best + '»';
    }
    return '';
  }

  /* ---------- evaluador ---------- */
  function evaluate(node, vars) {
    switch (node.t) {
      case 'lit':
        return node.v;

      case 'var': {
        if (Object.prototype.hasOwnProperty.call(vars, node.name)) {
          const v = vars[node.name];
          if (v === undefined) {
            throw new FlowError('La variable «' + node.name + '» todavía no tiene valor');
          }
          return v;
        }
        throw new FlowError('La variable «' + node.name + '» no tiene ningún valor todavía' +
          suggestName(node.name, vars));
      }

      case 'neg': {
        const v = needNum(evaluate(node.e, vars), 'el signo ' + node.sign);
        return node.sign === '-' ? -v : v;
      }

      case 'not':
        return !needBool(evaluate(node.e, vars), 'no');

      case 'and':
        if (!needBool(evaluate(node.l, vars), 'y')) return false;
        return needBool(evaluate(node.r, vars), 'y');

      case 'or':
        if (needBool(evaluate(node.l, vars), 'o')) return true;
        return needBool(evaluate(node.r, vars), 'o');

      case 'cmp': {
        const a = evaluate(node.l, vars);
        const b = evaluate(node.r, vars);
        if (node.op === '=' || node.op === '<>') {
          const eq = typeof a === typeof b ? a === b : false;
          return node.op === '=' ? eq : !eq;
        }
        if (typeof a !== typeof b || (typeof a !== 'number' && typeof a !== 'string')) {
          throw new FlowError('No puedo comparar ' + describe(a) + ' con ' + describe(b) +
            ' usando «' + node.op + '»');
        }
        if (node.op === '<') return a < b;
        if (node.op === '>') return a > b;
        if (node.op === '<=') return a <= b;
        return a >= b;
      }

      case 'bin': {
        const a = evaluate(node.l, vars);
        const b = evaluate(node.r, vars);
        const op = node.op;
        if (op === '+') {
          if (typeof a === 'number' && typeof b === 'number') return finite(a + b, '+');
          if (typeof a === 'string' || typeof b === 'string') return formatValue(a) + formatValue(b);
          throw new FlowError('No puedo sumar ' + describe(a) + ' con ' + describe(b));
        }
        const x = needNum(a, 'el operador ' + op);
        const y = needNum(b, 'el operador ' + op);
        switch (op) {
          case '-': return finite(x - y, '-');
          case '*': return finite(x * y, '*');
          case '/':
            if (y === 0) throw new FlowError('No se puede dividir entre cero');
            return finite(x / y, '/');
          case 'mod':
            if (y === 0) throw new FlowError('No se puede calcular el resto entre cero');
            return x % y;
          case 'div':
            if (y === 0) throw new FlowError('No se puede dividir entre cero');
            return Math.trunc(x / y);
          case '^': return finite(Math.pow(x, y), '^');
        }
        throw new FlowError('Operador desconocido «' + op + '»');
      }

      case 'call': {
        const f = FUNCS[node.name];
        if (!f) throw new FlowError('No conozco la función «' + node.raw + '»');
        if (node.args.length < f.min || node.args.length > f.max) {
          const esperado = f.min === f.max
            ? f.min + (f.min === 1 ? ' dato' : ' datos')
            : 'entre ' + f.min + ' y ' + f.max + ' datos';
          throw new FlowError('«' + f.name + '» espera ' + esperado + ' y recibió ' + node.args.length);
        }
        const args = node.args.map(function (a) { return evaluate(a, vars); });
        return f.fn(args, node.name);
      }
    }
    throw new FlowError('No se como calcular esta expresión');
  }

  /* ---------- cache de analisis ---------- */
  const cacheExpr = new Map();
  const cacheList = new Map();
  const cacheAssign = new Map();
  const cacheNames = new Map();

  function cached(map, key, build) {
    if (map.has(key)) {
      const hit = map.get(key);
      if (hit.err) throw hit.err;
      return hit.val;
    }
    try {
      const val = build();
      map.set(key, { val: val });
      return val;
    } catch (err) {
      if (err instanceof FlowError) map.set(key, { err: err });
      throw err;
    }
  }

  /** Analiza una expresión suelta (una condición, por ejemplo) */
  function parseExpression(src) {
    return cached(cacheExpr, String(src == null ? '' : src), function () {
      const p = new Parser(tokenize(src));
      if (p.atEnd()) throw new FlowError('Falta escribir la expresión');
      const ast = p.parseExpr();
      p.expectEnd();
      return ast;
    });
  }

  function stripLeadingWord(src, words) {
    const text = String(src == null ? '' : src);
    if (!words) return text;
    const re = new RegExp('^\\s*(?:' + words + ')\\b\\s*:?\\s*', 'i');
    const out = text.replace(re, '');
    return out.trim() === '' ? text : out;
  }

  /** Analiza  a, b, 2*c  -> lista de expresiones */
  function parseExprList(src, stripWords) {
    const key = (stripWords || '') + ' ' + String(src == null ? '' : src);
    return cached(cacheList, key, function () {
      const text = stripLeadingWord(src, stripWords);
      const p = new Parser(tokenize(text));
      const list = [];
      if (!p.atEnd()) {
        do { list.push(p.parseExpr()); } while (p.eat(','));
      }
      p.expectEnd();
      return list;
    });
  }

  /** Separa por ; y saltos de línea respetando las comillas */
  function splitStatements(src) {
    const s = src == null ? '' : String(src);
    const out = [];
    let cur = '', quote = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        cur += c;
        if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i++; }
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === ';' || c === '\n') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 0; });
  }

  /** Analiza  x = 3  /  x <- 3  (una o varias líneas) */
  function parseAssignments(src) {
    return cached(cacheAssign, String(src == null ? '' : src), function () {
      const parts = splitStatements(src);
      if (!parts.length) throw new FlowError('Escribe una asignación, por ejemplo  x = 0');
      return parts.map(function (line) {
        const tokens = tokenize(line);
        if (tokens[0].k !== 'id') {
          throw new FlowError('«' + line + '» debe empezar con el nombre de una variable');
        }
        const opTok = tokens[1];
        if (opTok && opTok.k === 'op' && (opTok.v === '==' || opTok.v === '<>' || opTok.v === '!=')) {
          throw new FlowError('Para dar valor a una variable se escribe un solo = ' +
            '(por ejemplo  ' + tokens[0].v + ' = 5). El == sirve para comparar');
        }
        if (!opTok || opTok.k !== 'op' || ASSIGN_OPS.indexOf(opTok.v) < 0) {
          throw new FlowError('«' + line + '» debe tener la forma  variable = expresión');
        }
        const name = tokens[0].v;
        if (isReservedWord(name)) {
          throw new FlowError('«' + name + '» es una palabra reservada, elige otro nombre');
        }
        const p = new Parser(tokens.slice(2));
        if (p.atEnd()) throw new FlowError('Falta la expresión después de «' + name + ' =»');
        const ast = p.parseExpr();
        p.expectEnd();
        return { name: name, ast: ast, source: line };
      });
    });
  }

  /** Analiza  n  o  a, b  -> nombres de variables */
  function parseNames(src) {
    return cached(cacheNames, String(src == null ? '' : src), function () {
      const text = stripLeadingWord(src, 'leer|lea|leo|read|entrada|pedir|ingresar');
      const names = text.split(',')
        .map(function (x) { return x.trim(); })
        .filter(function (x) { return x.length > 0; });
      if (!names.length) throw new FlowError('Escribe el nombre de la variable que quieres leer');
      names.forEach(function (n) {
        const tokens = tokenize(n);
        if (tokens.length !== 2 || tokens[0].k !== 'id') {
          throw new FlowError('«' + n + '» no es un nombre de variable válido');
        }
        if (isReservedWord(n)) {
          throw new FlowError('«' + n + '» es una palabra reservada, elige otro nombre');
        }
      });
      return names;
    });
  }

  // y / o no entran aquí: se distinguen por la posicion, así que
  // se pueden seguir usando como nombres de variable (y = 2 * x)
  const RESERVED = ['verdadero', 'falso', 'true', 'false', 'pi', 'mod', 'div', 'no', 'not'];
  function isReservedWord(name) {
    return RESERVED.indexOf(String(name).toLowerCase()) >= 0;
  }

  /** Convierte lo que teclea el usuario en número / lógico / texto */
  function coerceInput(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (s === '') return '';
    const low = s.toLowerCase();
    if (low === 'verdadero' || low === 'true') return true;
    if (low === 'falso' || low === 'false') return false;
    const normalized = s.replace(',', '.');
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(normalized)) {
      const n = Number(normalized);
      if (!isNaN(n)) return n;
    }
    return s;
  }

  function functionNames() {
    const seen = [];
    Object.keys(FUNCS).forEach(function (k) {
      if (seen.indexOf(FUNCS[k].name) < 0) seen.push(FUNCS[k].name);
    });
    return seen.sort();
  }

  root.FlowExpr = {
    FlowError: FlowError,
    tokenize: tokenize,
    parseExpression: parseExpression,
    parseExprList: parseExprList,
    parseAssignments: parseAssignments,
    parseNames: parseNames,
    splitStatements: splitStatements,
    evaluate: evaluate,
    evalExpression: function (src, vars) { return evaluate(parseExpression(src), vars || {}); },
    formatValue: formatValue,
    formatLiteral: formatLiteral,
    describe: describe,
    typeName: typeName,
    coerceInput: coerceInput,
    isReservedWord: isReservedWord,
    functionNames: functionNames
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
