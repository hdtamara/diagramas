/* Pruebas del nucleo (expr.js + flow.js + geometry.js) con Node puro:
     node tests/core.test.js                                          */
'use strict';

require('../js/expr.js');
require('../js/flow.js');
require('../js/geometry.js');
require('../js/examples.js');

const Expr = globalThis.FlowExpr;
const Flow = globalThis.Flow;
const Geo = globalThis.FlowGeo;
const Examples = globalThis.FlowExamples;

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name + '\n      ' + (err && err.message ? err.message : String(err)));
  }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((what ? what + ': ' : '') + 'esperaba ' + b + ' y obtuve ' + a);
}
function near(actual, expected, what) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-9) {
    throw new Error((what || '') + ' esperaba ~' + expected + ' y obtuve ' + actual);
  }
}
function throwsWith(fn, fragment) {
  let message = null;
  try { fn(); } catch (err) { message = err.message; }
  if (message === null) throw new Error('esperaba un error que contuviera "' + fragment + '" y no hubo error');
  if (message.toLowerCase().indexOf(fragment.toLowerCase()) < 0) {
    throw new Error('esperaba un error con "' + fragment + '" y obtuve "' + message + '"');
  }
}
const ev = function (src, vars) { return Expr.evalExpression(src, vars || {}); };

/* ---------------- expresiones ---------------- */
check('aritmética y precedencia', function () {
  eq(ev('2 + 3 * 4'), 14);
  eq(ev('(2 + 3) * 4'), 20);
  eq(ev('10 / 4'), 2.5);
  eq(ev('7 mod 3'), 1);
  eq(ev('7 div 2'), 3);
  eq(ev('7 % 3'), 1);
  eq(ev('2 ^ 10'), 1024);
  eq(ev('-2 ^ 2'), -4, 'la potencia liga más que el signo');
  eq(ev('2 ^ 3 ^ 2'), 512, 'la potencia es asociativa a derecha');
  eq(ev('-3 + 1'), -2);
  eq(ev('1 + 2 - 3 + 4'), 4);
  near(ev('1.5 * 2'), 3);
});

check('numeros con notación científica y decimales', function () {
  eq(ev('1e3'), 1000);
  eq(ev('0.5 + 0.25'), 0.75);
  eq(ev('.5 + 1'), 1.5);
});

check('comparaciones', function () {
  eq(ev('3 > 2'), true);
  eq(ev('3 == 3'), true);
  eq(ev('3 <> 4'), true);
  eq(ev('3 != 3'), false);
  eq(ev('2 <= 2'), true);
  eq(ev('"a" < "b"'), true);
  eq(ev('"abc" == "abc"'), true);
  eq(ev('1 == "1"'), false, 'tipos distintos no son iguales');
});

check('el = no compara: avisa de que se usa ==', function () {
  throwsWith(function () { ev('3 = 3'); }, 'se escribe ==');
  throwsWith(function () { Expr.parseExpression('n mod 2 = 0'); }, 'se escribe ==');
  throwsWith(function () { Expr.parseExpression('a > 1 y b = 2'); }, 'se escribe ==');
  throwsWith(function () { Expr.parseExprList('"vale: ", a = 1', Flow.WRITE_WORDS); }, 'se escribe ==');
  eq(ev('3 == 3'), true, 'con dos iguales si compara:');
});

check('el == no asigna: avisa de que se usa un solo =', function () {
  throwsWith(function () { Expr.parseAssignments('x == 5'); }, 'un solo =');
  throwsWith(function () { Expr.parseAssignments('contador != 5'); }, 'un solo =');
  eq(Expr.parseAssignments('x = 5')[0].name, 'x', 'con un igual si asigna:');
  eq(Expr.parseAssignments('x <- 5')[0].name, 'x');
});

check('una condicion con = queda marcada en el bloque', function () {
  const g = graphFrom({
    nodes: [
      { id: 's', type: 'start', x: 0, y: 0 },
      { id: 'd', type: 'decision', x: 0, y: 100, text: 'n = 3' },
      { id: 'f1', type: 'end', x: 0, y: 400 },
      { id: 'f2', type: 'end', x: 300, y: 400 }
    ],
    edges: [
      { from: 's', port: 'out', to: 'd' },
      { from: 'd', port: 'true', to: 'f1' },
      { from: 'd', port: 'false', to: 'f2' }
    ]
  });
  const report = Flow.validate(g);
  eq(!!report.byNode.d, true, 'el bloque deberia quedar marcado');
  eq(/se escribe ==/.test(report.byNode.d[0].message), true, report.byNode.d[0].message);
});

check('lógica con palabras en espanol', function () {
  eq(ev('verdadero y falso'), false);
  eq(ev('verdadero o falso'), true);
  eq(ev('no verdadero'), false);
  eq(ev('3 > 2 y 5 > 4'), true);
  eq(ev('3 > 2 o 1 > 4'), true);
  eq(ev('no (3 > 2)'), false);
  eq(ev('true && false'), false);
  eq(ev('verdadero || falso'), true);
});

check('la variable y no choca con el operador y', function () {
  eq(ev('y + 1', { y: 4 }), 5);
  eq(ev('2 * y', { y: 4 }), 8);
  eq(ev('y > 0 y y < 10', { y: 4 }), true, 'y como variable y como operador en la misma línea');
  eq(Expr.parseAssignments('y = 2 * x')[0].name, 'y');
  eq(ev('o * 2', { o: 3 }), 6);
});

check('cortocircuito de y / o', function () {
  eq(ev('falso y noExiste > 1', {}), false, 'no debería evaluar el lado derecho');
  eq(ev('verdadero o noExiste > 1', {}), true);
});

check('textos', function () {
  eq(ev('"hola"'), 'hola');
  eq(ev('"hola" + " " + "mundo"'), 'hola mundo');
  eq(ev('"total: " + 5'), 'total: 5');
  eq(ev('longitud("hola")'), 4);
  eq(ev('mayusculas("hola")'), 'HOLA');
  eq(ev('subcadena("pseudocódigo", 1, 6)'), 'pseudo');
});

check('funciones matemáticas', function () {
  eq(ev('raiz(16)'), 4);
  eq(ev('abs(-7)'), 7);
  eq(ev('redondear(3.14159, 2)'), 3.14);
  eq(ev('redondear(2.5)'), 3);
  eq(ev('truncar(3.9)'), 3);
  eq(ev('piso(-1.2)'), -2);
  eq(ev('techo(1.2)'), 2);
  eq(ev('min(4, 2, 9)'), 2);
  eq(ev('max(4, 2, 9)'), 9);
  eq(ev('pot(2, 8)'), 256);
  eq(ev('entero("42")'), 42);
  eq(ev('esnumero("42")'), true);
  eq(ev('esnumero("hola")'), false);
  near(ev('pi'), Math.PI);
});

check('aleatorio dentro del rango', function () {
  for (let i = 0; i < 200; i++) {
    const v = ev('aleatorio(1, 6)');
    if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error('fuera de rango: ' + v);
  }
});

check('mensajes de error útiles', function () {
  throwsWith(function () { ev('1 / 0'); }, 'dividir entre cero');
  throwsWith(function () { ev('5 mod 0'); }, 'resto entre cero');
  throwsWith(function () { ev('x + 1', {}); }, 'no tiene ningún valor');
  throwsWith(function () { ev('contador + 1', { contadro: 1 }); }, 'contadro');
  throwsWith(function () { ev('"a" - 1'); }, 'necesita un número');
  throwsWith(function () { ev('raiz(-1)'); }, 'raíz de un número negativo');
  throwsWith(function () { ev('raiz()'); }, 'espera 1 dato');
  throwsWith(function () { ev('noexiste(2)'); }, 'no conozco la función');
  throwsWith(function () { ev('2 +'); }, 'incompleta');
  throwsWith(function () { ev('(2 + 3'); }, 'falta');
  throwsWith(function () { ev('2 3'); }, 'sobra');
  throwsWith(function () { ev('"sin cerrar'); }, 'comilla');
  throwsWith(function () { ev('3 > "a"'); }, 'no puedo comparar');
  throwsWith(function () { ev('1 y 2'); }, 'verdadero/falso');
});

/* ---------------- asignaciones / entradas / salidas ---------------- */
check('asignaciones en varias formas', function () {
  eq(Expr.parseAssignments('x = 1').map(function (s) { return s.name; }), ['x']);
  eq(Expr.parseAssignments('x <- 1')[0].name, 'x');
  eq(Expr.parseAssignments('x := 1')[0].name, 'x');
  eq(Expr.parseAssignments('a = 1; b = 2').length, 2);
  eq(Expr.parseAssignments('a = 1\nb = 2').length, 2);
  eq(Expr.parseAssignments('mensaje = "hola; adios"').length, 1, 'el ; dentro del texto no separa');
  const vars = { contador: 1 };
  const st = Expr.parseAssignments('contador = contador + 1')[0];
  vars[st.name] = Expr.evaluate(st.ast, vars);
  eq(vars.contador, 2);
});

check('asignaciones mal escritas', function () {
  throwsWith(function () { Expr.parseAssignments('x + 1'); }, 'variable = expresión');
  throwsWith(function () { Expr.parseAssignments('x ='); }, 'falta la expresión');
  throwsWith(function () { Expr.parseAssignments('2 = x'); }, 'nombre de una variable');
  throwsWith(function () { Expr.parseAssignments('verdadero = 1'); }, 'palabra reservada');
});

check('nombres de entrada', function () {
  eq(Expr.parseNames('n'), ['n']);
  eq(Expr.parseNames('a, b , c'), ['a', 'b', 'c']);
  eq(Expr.parseNames('Leer edad'), ['edad']);
  eq(Expr.parseNames('leer'), ['leer'], 'si solo hay una palabra clave, es el nombre');
  throwsWith(function () { Expr.parseNames('2x'); }, 'no es un nombre');
  throwsWith(function () { Expr.parseNames('a + b'); }, 'no es un nombre');
});

check('listas de salida', function () {
  const list = Expr.parseExprList('"total: ", a + b, max(a, b)', Flow.WRITE_WORDS);
  eq(list.length, 3, 'la coma dentro de max() no separa');
  eq(Expr.parseExprList('Escribir "hola"', Flow.WRITE_WORDS).length, 1);
  eq(Expr.parseExprList('mostrar: x', Flow.WRITE_WORDS).length, 1);
});

check('conversión de lo que teclea el usuario', function () {
  eq(Expr.coerceInput('42'), 42);
  eq(Expr.coerceInput(' -3.5 '), -3.5);
  eq(Expr.coerceInput('3,5'), 3.5, 'acepta la coma decimal');
  eq(Expr.coerceInput('verdadero'), true);
  eq(Expr.coerceInput('hola'), 'hola');
  eq(Expr.coerceInput('12abc'), '12abc');
  eq(Expr.coerceInput(''), '');
});

check('formato de valores', function () {
  eq(Expr.formatValue(3), '3');
  eq(Expr.formatValue(0.1 + 0.2), '0.3', 'sin ruido de coma flotante');
  eq(Expr.formatValue(true), 'verdadero');
  eq(Expr.formatValue('hola'), 'hola');
  eq(Expr.formatLiteral('hola'), '"hola"');
});

/* ---------------- ayudas para ejecutar diagramas ---------------- */
function graphFrom(data) {
  return Flow.deserialize(data);
}

/**
 * Ejecuta un diagrama hasta el final dando las entradas de la lista.
 * Devuelve { salidas, errores, estado, vars, pasos }
 */
function run(graph, inputs, limit) {
  const salidas = [];
  const errores = [];
  const todo = [];
  const queue = typeof inputs === 'function' ? [] : (inputs || []).slice();
  let sinDatos = false;
  const answer = typeof inputs === 'function' ? inputs : null;
  const rt = new Flow.Runtime({
    getGraph: function () { return graph; },
    maxSteps: limit || 5000,
    hooks: {
      log: function (text, kind) {
        todo.push(kind + '|' + text);
        if (kind === 'out') salidas.push(text);
        if (kind === 'err') errores.push(text);
      },
      askInput: function (ask) {
        if (answer) { rt.provideInput(answer(ask, rt)); return; }
        if (!queue.length) { sinDatos = true; rt.cancelInput(); return; }
        rt.provideInput(queue.shift());
      },
      delay: function () { return 0; }
    }
  });
  rt.trace = false;
  let guard = 0;
  do {
    rt.step();
    guard++;
  } while (rt.isActive() && !sinDatos && guard < (limit || 5000) + 20);
  return { salidas: salidas, errores: errores, estado: rt.status, vars: rt.vars, pasos: rt.steps, log: todo, rt: rt };
}

/* ---------------- ejecución ---------------- */
check('ejemplo suma: las entradas se guardan en variables', function () {
  const g = graphFrom(Examples.get('suma'));
  const r = run(g, ['3', '4']);
  eq(r.estado, 'finished');
  eq(r.vars.a, 3);
  eq(r.vars.b, 4);
  eq(r.vars.suma, 7);
  eq(r.salidas, ['La suma es: 7']);
  eq(r.errores, []);
});

check('una entrada puede pedir varias variables', function () {
  const g = graphFrom(Examples.get('mayor'));
  const r = run(g, ['5', '9', '2']);
  eq(r.estado, 'finished');
  eq(r.vars.a, 5);
  eq(r.vars.b, 9);
  eq(r.vars.c, 2);
  eq(r.salidas, ['El mayor es 9']);
});

check('decisiones: par o impar por las dos ramas', function () {
  eq(run(graphFrom(Examples.get('par')), ['4']).salidas, ['El número 4 es par']);
  eq(run(graphFrom(Examples.get('par')), ['7']).salidas, ['El número 7 es impar']);
});

check('bucle: la tabla imprime 10 líneas', function () {
  const r = run(graphFrom(Examples.get('tabla')), ['3']);
  eq(r.estado, 'finished');
  eq(r.salidas.length, 10);
  eq(r.salidas[0], '3 x 1 = 3');
  eq(r.salidas[9], '3 x 10 = 30');
});

check('bucle con acumulador: factorial', function () {
  const r = run(graphFrom(Examples.get('factorial')), ['5']);
  eq(r.estado, 'finished');
  eq(r.salidas, ['El factorial de 5 es 120']);
});

check('entrada dentro del bucle: promedio', function () {
  const r = run(graphFrom(Examples.get('promedio')), ['3', '7', '8', '9']);
  eq(r.estado, 'finished');
  eq(r.vars.suma, 24);
  eq(r.salidas, ['El promedio es 8']);
});

check('todos los ejemplos están bien formados', function () {
  Examples.list.forEach(function (item) {
    const g = graphFrom(Examples.get(item.key));
    const report = Flow.validate(g);
    if (report.errors.length) {
      throw new Error(item.key + ' tiene errores: ' + report.errors[0].message);
    }
    if (report.warnings.length) {
      throw new Error(item.key + ' tiene avisos: ' + report.warnings[0].message);
    }
  });
});

check('todos los ejemplos terminan bien', function () {
  // contesta a cada pregunta algo razonable segun la variable que pide
  const respuesta = function (ask, rt) {
    if (ask.name === 'intento') return rt.vars.secreto;      // adivina el numero
    if (ask.name === 'cantidad') return 3;
    return 4;
  };
  Examples.list.forEach(function (item) {
    const g = graphFrom(Examples.get(item.key));
    const r = run(g, respuesta, 4000);
    if (r.estado !== 'finished') {
      throw new Error(item.key + ' no terminó: ' + r.estado + ' ' + r.errores.join(' / '));
    }
    if (!r.salidas.length) throw new Error(item.key + ' no mostró nada');
  });
});

check('adivina el numero: bucle interactivo hasta acertar', function () {
  const g = graphFrom(Examples.get('adivina'));
  const salidas = [];
  let bajo = 1, alto = 100, intento = 50;
  const rt = new Flow.Runtime({
    getGraph: function () { return g; },
    maxSteps: 4000,
    hooks: {
      log: function (text, kind) { if (kind === 'out') salidas.push(text); },
      askInput: function () {
        // juega de verdad: solo mira las pistas que imprime el programa
        const última = salidas[salidas.length - 1] || '';
        if (/^Muy bajo/.test(última)) bajo = intento + 1;
        else if (/^Muy alto/.test(última)) alto = intento - 1;
        intento = Math.floor((bajo + alto) / 2);
        rt.provideInput(intento);
      },
      delay: function () { return 0; }
    }
  });
  rt.trace = false;
  let guard = 0;
  do { rt.step(); guard++; } while (rt.isActive() && guard < 4000);
  eq(rt.status, 'finished');
  eq(/Correcto/.test(salidas[salidas.length - 1]), true, salidas.join(' | '));
  eq(rt.vars.intento, rt.vars.secreto);
  eq(rt.vars.intentos <= 8, true, 'la busqueda binaria debería acertar en pocos intentos');
});

/* ---------------- errores y volver a ejecutar ---------------- */
function brokenGraph() {
  return graphFrom({
    title: 'roto',
    nodes: [
      { id: 's', type: 'start', x: 100, y: 40 },
      { id: 'p', type: 'process', x: 100, y: 150, text: 'x = y + 1' },
      { id: 'o', type: 'output', x: 100, y: 260, text: 'x' },
      { id: 'f', type: 'end', x: 100, y: 370 }
    ],
    edges: [
      { from: 's', port: 'out', to: 'p' },
      { from: 'p', port: 'out', to: 'o' },
      { from: 'o', port: 'out', to: 'f' }
    ]
  });
}

check('un error detiene la ejecución y la senala', function () {
  const g = brokenGraph();
  const r = run(g, []);
  eq(r.estado, 'error');
  eq(r.errores.length, 1);
  eq(r.rt.errorNodeId, 'p');
  eq(r.salidas, [], 'no debería seguir ejecutando después del error');
});

check('después de un error se puede volver a ejecutar sin reiniciar a mano', function () {
  const g = brokenGraph();
  const first = run(g, []);
  eq(first.estado, 'error');
  const rt = first.rt;

  // el usuario corrige el bloque y vuelve a pulsar Paso
  Flow.findNode(g, 'p').text = 'x = 41 + 1';
  let guard = 0;
  do { rt.step(); guard++; } while (rt.isActive() && guard < 100);
  eq(rt.status, 'finished', 'la segunda ejecución debería terminar bien');
  eq(rt.vars.x, 42);
  eq(rt.steps <= 6, true, 'los pasos se reinician en cada ejecución');
});

check('después de terminar, volver a ejecutar arranca de cero', function () {
  const g = graphFrom(Examples.get('suma'));
  const first = run(g, ['1', '1']);
  eq(first.estado, 'finished');
  eq(first.vars.suma, 2);
  const rt = first.rt;
  eq(Object.keys(rt.vars).length, 3);
  rt.hooks.askInput = function () { rt.provideInput('10'); };
  let guard = 0;
  do { rt.step(); guard++; } while (rt.isActive() && guard < 100);
  eq(rt.status, 'finished');
  eq(rt.vars, { a: 10, b: 10, suma: 20 }, 'las variables viejas no deben sobrevivir');
});

check('bucle infinito: se detiene solo', function () {
  const g = graphFrom({
    nodes: [
      { id: 's', type: 'start', x: 40, y: 40 },
      { id: 'p1', type: 'process', x: 40, y: 150, text: 'x = 1' },
      { id: 'p2', type: 'process', x: 40, y: 260, text: 'x = x + 1' }
    ],
    edges: [
      { from: 's', port: 'out', to: 'p1' },
      { from: 'p1', port: 'out', to: 'p2' },
      { from: 'p2', port: 'out', to: 'p1' }
    ]
  });
  const r = run(g, [], 300);
  eq(r.estado, 'error');
  eq(/bucle que nunca termina/.test(r.errores.join(' ')), true, r.errores.join(' '));
});

check('salida sin flecha: avisa con el nombre del bloque', function () {
  const g = graphFrom({
    nodes: [
      { id: 's', type: 'start', x: 40, y: 40 },
      { id: 'p', type: 'process', x: 40, y: 150, text: 'x = 1' }
    ],
    edges: [{ from: 's', port: 'out', to: 'p' }]
  });
  const r = run(g, []);
  eq(r.estado, 'error');
  eq(/no tiene flecha de salida/.test(r.errores.join(' ')), true);
});

check('una condición que no es lógica avisa claramente', function () {
  const g = graphFrom({
    nodes: [
      { id: 's', type: 'start', x: 40, y: 40 },
      { id: 'd', type: 'decision', x: 40, y: 150, text: '2 + 2' },
      { id: 'f', type: 'end', x: 40, y: 400 },
      { id: 'f2', type: 'end', x: 300, y: 400 }
    ],
    edges: [
      { from: 's', port: 'out', to: 'd' },
      { from: 'd', port: 'true', to: 'f' },
      { from: 'd', port: 'false', to: 'f2' }
    ]
  });
  const r = run(g, []);
  eq(r.estado, 'error');
  eq(/verdadero o falso/.test(r.errores.join(' ')), true, r.errores.join(' '));
});

check('cancelar la entrada deja el programa en pausa y se puede reintentar', function () {
  const g = graphFrom(Examples.get('suma'));
  const r = run(g, []);              // sin datos: la primera entrada se cancela
  eq(r.estado, 'paused');
  const rt = r.rt;
  rt.hooks.askInput = function () { rt.provideInput('2'); };
  let guard = 0;
  do { rt.step(); guard++; } while (rt.isActive() && guard < 100);
  eq(rt.status, 'finished');
  eq(rt.vars.suma, 4);
});

check('borrar el bloque de entrada mientras pide un dato no rompe nada', function () {
  const g = graphFrom(Examples.get('suma'));
  const rt = new Flow.Runtime({
    getGraph: function () { return g; },
    hooks: {
      log: function () {},
      askInput: function (ask) {
        // alguien borra el bloque justo antes de contestar
        Flow.removeNode(g, ask.node.id);
        rt.provideInput('5');
      }
    }
  });
  rt.trace = false;
  let guard = 0;
  do { rt.step(); guard++; } while (rt.isActive() && guard < 50);
  eq(rt.status, 'error', 'deberia avisar en vez de romperse:');
});

check('se pueden cambiar variables a mano', function () {
  const g = graphFrom(Examples.get('suma'));
  const rt = new Flow.Runtime({ getGraph: function () { return g; }, hooks: {} });
  rt.setVar('x', 5);
  eq(rt.vars.x, 5);
  throwsWith(function () { rt.setVar('2x', 1); }, 'no es un nombre');
  throwsWith(function () { rt.setVar('verdadero', 1); }, 'palabra reservada');
});

/* ---------------- validación ---------------- */
check('validación: falta Inicio', function () {
  const g = graphFrom({ nodes: [{ id: 'p', type: 'process', x: 0, y: 0, text: 'x = 1' }], edges: [] });
  const report = Flow.validate(g);
  eq(report.errors.some(function (e) { return e.fatal && /Inicio/.test(e.message); }), true);
});

check('validación: dos Inicio', function () {
  const g = graphFrom({
    nodes: [
      { id: 's1', type: 'start', x: 0, y: 0 },
      { id: 's2', type: 'start', x: 200, y: 0 }
    ], edges: []
  });
  const report = Flow.validate(g);
  eq(report.errors.filter(function (e) { return e.fatal; }).length, 2);
});

check('validación: texto mal escrito y bloque vacío', function () {
  const g = graphFrom({
    nodes: [
      { id: 's', type: 'start', x: 0, y: 0 },
      { id: 'p', type: 'process', x: 0, y: 100, text: 'x +' },
      { id: 'o', type: 'output', x: 0, y: 200, text: '' },
      { id: 'f', type: 'end', x: 0, y: 300 }
    ],
    edges: [
      { from: 's', port: 'out', to: 'p' },
      { from: 'p', port: 'out', to: 'o' },
      { from: 'o', port: 'out', to: 'f' }
    ]
  });
  const report = Flow.validate(g);
  eq(!!report.byNode.p, true, 'el proceso mal escrito debería quedar marcado');
  eq(!!report.byNode.o, true, 'la salida vacía debería quedar marcada');
  eq(report.errors.some(function (e) { return e.fatal; }), false, 'no son fatales: se puede seguir editando');
});

check('validación: bloque al que no llega ninguna flecha', function () {
  const g = graphFrom({
    nodes: [
      { id: 's', type: 'start', x: 0, y: 0 },
      { id: 'f', type: 'end', x: 0, y: 100 },
      { id: 'p', type: 'process', x: 400, y: 100, text: 'x = 1' }
    ],
    edges: [{ from: 's', port: 'out', to: 'f' }]
  });
  const report = Flow.validate(g);
  eq(report.warnings.some(function (w) { return w.nodeId === 'p' && /nunca se ejecuta/.test(w.message); }), true);
});

/* ---------------- modelo ---------------- */
check('conectar: una salida solo admite una flecha', function () {
  const g = Flow.createGraph();
  const a = Flow.addNode(g, 'process', 0, 0);
  const b = Flow.addNode(g, 'process', 0, 200);
  const c = Flow.addNode(g, 'process', 0, 400);
  Flow.connect(g, a.id, 'out', b.id);
  Flow.connect(g, a.id, 'out', c.id);
  eq(g.edges.length, 1);
  eq(g.edges[0].to, c.id);
});

check('conectar: no vale a si mismo, ni entrar al Inicio, ni puertos que no existen', function () {
  const g = Flow.createGraph();
  const s = Flow.addNode(g, 'start', 0, 0);
  const p = Flow.addNode(g, 'process', 0, 200);
  const d = Flow.addNode(g, 'decision', 0, 400);
  eq(Flow.connect(g, p.id, 'out', p.id), null);
  eq(Flow.connect(g, p.id, 'out', s.id), null);
  eq(Flow.connect(g, p.id, 'true', d.id), null, 'un proceso no tiene rama Si');
  eq(Flow.connect(g, d.id, 'true', p.id) !== null, true);
  eq(g.edges.length, 1);
});

check('borrar un bloque borra sus flechas', function () {
  const g = Flow.createGraph();
  const a = Flow.addNode(g, 'process', 0, 0);
  const b = Flow.addNode(g, 'process', 0, 200);
  Flow.connect(g, a.id, 'out', b.id);
  Flow.removeNode(g, b.id);
  eq(g.edges.length, 0);
  eq(g.nodes.length, 1);
});

check('los ids nunca se repiten entre bloques y flechas', function () {
  const g = Flow.createGraph();
  const ids = {};
  for (let i = 0; i < 30; i++) {
    const n = Flow.addNode(g, 'process', i * 10, i * 10);
    if (ids[n.id]) throw new Error('id repetido: ' + n.id);
    ids[n.id] = true;
  }
  for (let i = 1; i < g.nodes.length; i++) {
    const e = Flow.connect(g, g.nodes[i - 1].id, 'out', g.nodes[i].id);
    if (ids[e.id]) throw new Error('id repetido: ' + e.id);
    ids[e.id] = true;
  }
});

check('guardar y abrir mantiene el diagrama', function () {
  const original = graphFrom(Examples.get('promedio'));
  const copy = Flow.deserialize(JSON.parse(JSON.stringify(Flow.serialize(original))));
  eq(copy.nodes.length, original.nodes.length);
  eq(copy.edges.length, original.edges.length);
  eq(run(copy, ['2', '4', '6']).salidas, ['El promedio es 5']);
});

check('abrir un archivo raro no rompe nada', function () {
  throwsWith(function () { Flow.deserialize(null); }, 'no contiene un diagrama');
  throwsWith(function () { Flow.deserialize({}); }, 'no contiene bloques');
  const g = Flow.deserialize({
    nodes: [
      { id: 'a', type: 'process', x: 'no', y: -50, text: 'x = 1' },
      { id: 'a', type: 'process', x: 10, y: 10, text: 'x = 2' },
      { id: 'raro', type: 'inventado', x: 0, y: 0 },
      { id: 's', type: 'start', x: 0, y: 0 }
    ],
    edges: [
      { from: 'a', port: 'out', to: 'nada' },
      { from: 'a', port: 'out', to: 's' },
      { from: 's', port: 'out', to: 'a' },
      { from: 's', port: 'out', to: 'a' },
      { from: 'a', port: 'mentira', to: 'a' }
    ]
  });
  eq(g.nodes.length, 3, 'descarta el tipo inventado y renombra el id repetido');
  eq(g.nodes[0].x, 40, 'x invalida se reemplaza');
  eq(g.nodes[0].y, 0, 'y negativa se recorta');
  eq(g.edges.length, 1, 'descarta destinos inexistentes, entradas al Inicio, bucles sobre si mismo y puertos repetidos');
  eq(g.edges[0].from, 's');
});

/* ---------------- geometría ---------------- */
check('en los ejemplos ninguna flecha da la vuelta de mas', function () {
  // si el destino queda claramente mas abajo, el recorrido no deberia subir
  Examples.list.forEach(function (item) {
    const g = graphFrom(Examples.get(item.key));
    g.edges.forEach(function (edge) {
      const from = Flow.findNode(g, edge.from);
      const to = Flow.findNode(g, edge.to);
      const salida = Geo.portPoint(from, edge.port);
      const entrada = Geo.entryPoint(to);
      if (entrada.y <= salida.y + 8) return;             // es un retorno: puede subir
      const pts = Geo.route(from, edge.port, to);
      pts.forEach(function (pt) {
        if (pt.y < salida.y - 2) {
          throw new Error(item.key + ': la flecha ' + edge.from + ' -> ' + edge.to +
            ' sube hasta ' + Math.round(pt.y) + ' y sale en ' + Math.round(salida.y));
        }
      });
      if (pts.length > 4) {
        throw new Error(item.key + ': la flecha ' + edge.from + ' -> ' + edge.to +
          ' da ' + pts.length + ' vueltas para bajar: ' +
          pts.map(function (p) { return Math.round(p.x) + ',' + Math.round(p.y); }).join(' | '));
      }
    });
  });
});

check('bloques muy juntos: la flecha no da la vuelta', function () {
  // el hueco es menor que el tramo de salida + el de entrada
  const a = { id: 'a', type: 'output', x: 100, y: 100 };
  const b = { id: 'b', type: 'end', x: 108, y: 195 };
  const pts = Geo.route(a, 'out', b);
  eq(pts.length <= 4, true, 'deberia bajar directo: ' +
    pts.map(function (p) { return Math.round(p.x) + ',' + Math.round(p.y); }).join(' | '));
  pts.forEach(function (pt) {
    if (pt.y < 100) throw new Error('la flecha se sale por arriba');
  });

  const alineados = Geo.route(a, 'out', { id: 'c', type: 'output', x: 100, y: 195 });
  eq(alineados.length, 2, 'si estan alineados, recta');
});

check('la rama de una decision con el destino muy cerca tampoco da la vuelta', function () {
  const d = { id: 'd', type: 'decision', x: 300, y: 100 };
  const cerca = { id: 'p', type: 'process', x: 620, y: 185 };
  const pts = Geo.route(d, 'false', cerca);
  eq(pts.length <= 4, true, 'demasiados tramos: ' +
    pts.map(function (p) { return Math.round(p.x) + ',' + Math.round(p.y); }).join(' | '));
  const salida = Geo.portPoint(d, 'false');
  pts.forEach(function (pt) {
    if (pt.y < salida.y - 2) throw new Error('la flecha sube');
  });
});

check('flecha recta hacia abajo', function () {
  const a = { id: 'a', type: 'process', x: 100, y: 100 };
  const b = { id: 'b', type: 'process', x: 100, y: 300 };
  const pts = Geo.route(a, 'out', b);
  eq(pts.length, 2);
  eq(pts[0].x, pts[1].x, 'debería ser vertical');
  eq(/^M /.test(Geo.elbowPath(pts)), true);
});

check('flecha en escalon cuando los bloques no están alineados', function () {
  const a = { id: 'a', type: 'process', x: 100, y: 100 };
  const b = { id: 'b', type: 'process', x: 500, y: 400 };
  const pts = Geo.route(a, 'out', b);
  eq(pts.length, 4);
  eq(pts[1].y, pts[2].y, 'el tramo del medio es horizontal');
});

check('flecha de retorno (bucle) sale por un carril lateral', function () {
  const cond = { id: 'd', type: 'decision', x: 100, y: 100 };
  const body = { id: 'p', type: 'process', x: 100, y: 400 };
  const pts = Geo.route(body, 'out', cond);
  eq(pts.length >= 5, true);
  const lane = pts[2].x;
  eq(lane < 100, true, 'el carril debería quedar a la izquierda de los bloques');
  const last = pts[pts.length - 1];
  eq(Math.round(last.y), 100, 'entra por arriba del bloque de la condición');
  eq(Math.round(last.x), Math.round(cond.x + Flow.typeInfo('decision').w / 2));
});

check('las dos ramas de la decision salen por los lados', function () {
  const d = { id: 'd', type: 'decision', x: 100, y: 100 };
  const w = Flow.typeInfo('decision').w;
  const h = Flow.typeInfo('decision').minH;
  const si = Geo.portPoint(d, 'true');
  const no = Geo.portPoint(d, 'false');
  eq(si.dir, 'left', 'el Si deberia salir por la izquierda:');
  eq(no.dir, 'right', 'el No deberia salir por la derecha:');
  eq(Math.round(si.x), 100, 'el Si sale del vertice izquierdo:');
  eq(Math.round(no.x), 100 + w, 'el No sale del vertice derecho:');
  eq(Math.round(si.y), 100 + h / 2, 'el Si sale a media altura:');
  eq(Math.round(no.y), 100 + h / 2, 'el No sale a media altura:');
  eq(Math.round(Geo.entryPoint(d).y), 100, 'se entra por el vertice de arriba:');
});

check('la rama Si baja hacia la izquierda sin dar la vuelta', function () {
  const d = { id: 'd', type: 'decision', x: 400, y: 100 };
  const cuerpo = { id: 'p', type: 'process', x: 120, y: 400 };
  const pts = Geo.route(d, 'true', cuerpo);
  const salida = Geo.portPoint(d, 'true');
  pts.forEach(function (pt) {
    if (pt.y < salida.y - 2) throw new Error('la flecha sube cuando deberia bajar');
  });
  eq(Math.round(pts[pts.length - 1].y), 400, 'entra por arriba del bloque:');
  eq(pts.some(function (pt) { return pt.x < salida.x; }), true, 'deberia ir hacia la izquierda');
});

check('la rama No sale por la derecha', function () {
  const d = { id: 'd', type: 'decision', x: 100, y: 100 };
  const p = { id: 'p', type: 'process', x: 500, y: 400 };
  const start = Geo.portPoint(d, 'false');
  eq(start.dir, 'right');
  eq(Math.round(start.x), 100 + Flow.typeInfo('decision').w);
  const pts = Geo.route(d, 'false', p);
  eq(pts.length >= 3, true);
});

check('el punto medio de la flecha cae sobre el recorrido', function () {
  const a = { id: 'a', type: 'process', x: 100, y: 100 };
  const b = { id: 'b', type: 'process', x: 500, y: 400 };
  const pts = Geo.route(a, 'out', b);
  const mid = Geo.midpoint(pts);
  eq(mid.x >= 100 && mid.x <= 700, true);
  eq(mid.y >= 100 && mid.y <= 400, true);
});

check('cada tipo de bloque tiene su contorno', function () {
  Object.keys(Flow.TYPES).forEach(function (type) {
    const d = Geo.shapePath(type, 180, 70);
    if (!/^M /.test(d) || d.length < 20) throw new Error('contorno raro para ' + type);
    if (/NaN|undefined/.test(d)) throw new Error('contorno con NaN para ' + type);
  });
});

/* ---------------- resultado ---------------- */
console.log('');
if (failures.length) {
  console.log('  ' + passed + ' pruebas OK, ' + failures.length + ' fallaron:');
  failures.forEach(function (f) { console.log('   x ' + f); });
  process.exit(1);
} else {
  console.log('  ' + passed + ' pruebas OK');
}
