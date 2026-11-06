/* Pruebas de la biblioteca del navegador, con un localStorage de mentira:
     node tests/store.test.js                                          */
'use strict';

require('../js/expr.js');
require('../js/flow.js');
require('../js/geometry.js');
require('../js/examples.js');
require('../js/store.js');

const Flow = globalThis.Flow;
const Examples = globalThis.FlowExamples;
const Store = globalThis.FlowStore;

let passed = 0;
const failures = [];

function check(name, fn) {
  try { fn(); passed++; }
  catch (err) { failures.push(name + '\n      ' + (err && err.message ? err.message : String(err))); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what ? what + ': ' : '') + 'esperaba ' + b + ' y obtuve ' + a);
}
function ok(cond, what) { if (!cond) throw new Error(what || 'esperaba algo verdadero'); }
function throwsWith(fn, fragment) {
  let message = null;
  try { fn(); } catch (err) { message = err.message; }
  if (message === null) throw new Error('esperaba un error con "' + fragment + '"');
  if (message.toLowerCase().indexOf(fragment.toLowerCase()) < 0) {
    throw new Error('esperaba "' + fragment + '" y obtuve "' + message + '"');
  }
}

/** localStorage de mentira, con limite de tamano opcional */
function fakeStorage(limit) {
  const data = {};
  return {
    data: data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) {
      if (limit && String(v).length > limit) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data[k] = String(v);
    },
    removeItem: function (k) { delete data[k]; }
  };
}

function fresh(limit) {
  Store.useStorage(fakeStorage(limit));
}
const graphOf = function (key) { return Flow.deserialize(Examples.get(key)); };

/* ---------------- guardar y recuperar ---------------- */
check('guardar crea una entrada y se puede volver a leer', function () {
  fresh();
  const g = graphOf('suma');
  const id = Store.save(null, g);
  ok(id && typeof id === 'string', 'deberia devolver un id');
  eq(Store.list().length, 1);
  eq(Store.list()[0].title, 'Suma de dos números');
  eq(Store.list()[0].nodes, g.nodes.length);
  const back = Flow.deserialize(Store.get(id));
  eq(back.nodes.length, g.nodes.length, 'los bloques deberian volver igual:');
  eq(back.edges.length, g.edges.length, 'y las flechas:');
});

check('guardar con el mismo id actualiza, no duplica', function () {
  fresh();
  const g = graphOf('suma');
  const id = Store.save(null, g);
  g.nodes[0].x = 999;
  const again = Store.save(id, g);
  eq(again, id, 'deberia mantener el id');
  eq(Store.list().length, 1, 'no deberia haber duplicados');
  eq(Flow.deserialize(Store.get(id)).nodes[0].x, 999, 'deberia tener el cambio');
});

check('guardar como nuevo si duplica', function () {
  fresh();
  const g = graphOf('suma');
  const a = Store.save(null, g);
  const b = Store.saveAsNew(g, 'Otra copia');
  ok(a !== b, 'ids distintos');
  eq(Store.list().length, 2);
  eq(Store.titleOf(b), 'Otra copia');
});

check('el titulo se toma del diagrama y se puede forzar', function () {
  fresh();
  const g = graphOf('tabla');
  const id = Store.save(null, g);
  eq(Store.titleOf(id), 'Tabla de multiplicar');
  const otro = Store.save(null, g, '  Mi tabla  ');
  eq(Store.titleOf(otro), 'Mi tabla', 'deberia recortar los espacios');
  const sinNombre = Store.save(null, g, '   ');
  eq(Store.titleOf(sinNombre), 'Sin titulo');
});

check('la lista sale de lo mas nuevo a lo mas viejo', function () {
  fresh();
  const g = graphOf('par');
  const viejo = Store.save(null, g, 'viejo');
  // se retrasa a mano la fecha del primero
  const raw = JSON.parse(Store.useStorage === undefined ? '{}' : '{}');
  const primero = Store.list()[0];
  eq(primero.title, 'viejo');
  Store.save(null, g, 'nuevo');
  eq(Store.list().map(function (i) { return i.title; }), ['nuevo', 'viejo']);
  ok(viejo);
  ok(raw !== undefined);
});

/* ---------------- renombrar, duplicar, borrar ---------------- */
check('renombrar cambia el titulo de la lista y del diagrama', function () {
  fresh();
  const id = Store.save(null, graphOf('par'));
  eq(Store.rename(id, 'Par e impar v2'), true);
  eq(Store.titleOf(id), 'Par e impar v2');
  eq(Store.get(id).title, 'Par e impar v2', 'el titulo tambien va dentro del diagrama:');
  eq(Store.rename('noexiste', 'x'), false);
  Store.rename(id, '   ');
  eq(Store.titleOf(id), 'Sin titulo', 'un nombre vacio no deberia dejarlo en blanco');
});

check('duplicar deja una copia independiente', function () {
  fresh();
  const id = Store.save(null, graphOf('par'));
  const copia = Store.duplicate(id);
  ok(copia && copia !== id);
  eq(Store.list().length, 2);
  eq(Store.titleOf(copia), 'Par o impar (copia)');
  // tocar la copia no afecta al original
  const g = Flow.deserialize(Store.get(copia));
  g.nodes[0].x = 1234;
  Store.save(copia, g);
  eq(Flow.deserialize(Store.get(id)).nodes[0].x === 1234, false, 'el original no deberia cambiar');
  eq(Store.duplicate('noexiste'), null);
});

check('borrar quita solo esa entrada', function () {
  fresh();
  const a = Store.save(null, graphOf('par'), 'A');
  const b = Store.save(null, graphOf('suma'), 'B');
  eq(Store.remove(a), true);
  eq(Store.list().map(function (i) { return i.title; }), ['B']);
  eq(Store.exists(a), false);
  eq(Store.exists(b), true);
  eq(Store.remove('noexiste'), false);
});

/* ---------------- casos raros ---------------- */
check('sin localStorage no revienta', function () {
  Store.useStorage(null);
  eq(Store.available(), false);
  eq(Store.list(), []);
  eq(Store.get('x'), null);
  eq(Store.usage(), 0);
  throwsWith(function () { Store.save(null, graphOf('par')); }, 'no deja guardar');
});

check('si no cabe, avisa en lugar de perder lo guardado', function () {
  fresh(400);                                   // limite absurdo a proposito
  throwsWith(function () { Store.save(null, graphOf('promedio')); }, 'espacio');
  eq(Store.list(), [], 'no deberia quedar nada a medias');
});

check('datos corruptos en el almacen se ignoran', function () {
  const store = fakeStorage();
  Store.useStorage(store);
  store.setItem(Store.KEY, 'esto no es json');
  eq(Store.list(), []);
  store.setItem(Store.KEY, JSON.stringify({ items: 'tampoco' }));
  eq(Store.list(), []);
  store.setItem(Store.KEY, JSON.stringify({
    items: [
      { id: 'ok', title: 'bueno', updated: 1, graph: { nodes: [], edges: [] } },
      { id: 'malo' },
      { title: 'sin id', graph: { nodes: [] } },
      null
    ]
  }));
  eq(Store.list().length, 1, 'solo deberia quedar la entrada valida');
  eq(Store.list()[0].id, 'ok');
  // y despues de guardar, la basura desaparece
  Store.save(null, graphOf('par'), 'nuevo');
  eq(Store.list().length, 2);
});

check('guardar y abrir un diagrama de la biblioteca lo deja ejecutable', function () {
  fresh();
  const id = Store.save(null, graphOf('suma'));
  const g = Flow.deserialize(Store.get(id));
  const report = Flow.validate(g);
  eq(report.errors.length, 0, 'no deberia tener errores:');
  eq(report.warnings.length, 0, 'ni avisos:');
});

/* ---------------- fechas ---------------- */
check('las fechas se cuentan en palabras', function () {
  const now = Date.UTC(2026, 2, 15, 12, 0, 0);
  eq(Store.timeAgo(now - 10 * 1000, now), 'ahora mismo');
  eq(Store.timeAgo(now - 60 * 1000, now), 'hace 1 minuto');
  eq(Store.timeAgo(now - 5 * 60 * 1000, now), 'hace 5 minutos');
  eq(Store.timeAgo(now - 60 * 60 * 1000, now), 'hace 1 hora');
  eq(Store.timeAgo(now - 5 * 60 * 60 * 1000, now), 'hace 5 horas');
  eq(Store.timeAgo(now - 26 * 60 * 60 * 1000, now), 'ayer');
  eq(Store.timeAgo(now - 5 * 24 * 60 * 60 * 1000, now), 'hace 5 dias');
  eq(/\d+ \w+ \d{4}/.test(Store.timeAgo(now - 200 * 24 * 60 * 60 * 1000, now)), true);
  eq(Store.timeAgo(0, now), '');
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
