/* ------------------------------------------------------------------
   store.js  ·  Biblioteca de diagramas guardados en el navegador
   Usa localStorage (no sessionStorage: eso se borra al cerrar la pestana).
   Expone globalThis.FlowStore  (necesita flow.js)
------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const Flow = root.Flow;
  if (!Flow) throw new Error('store.js necesita flow.js');

  const KEY = 'diagramador.biblioteca.v1';
  const MAX_ITEMS = 200;

  let storage = null;
  let checked = false;

  /** Permite enchufar un almacen falso en las pruebas. */
  function useStorage(fake) {
    storage = fake;
    checked = true;
  }

  function getStorage() {
    if (checked) return storage;
    checked = true;
    try {
      const probe = '__prueba__';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      storage = root.localStorage;
    } catch (err) {
      storage = null;            // modo privado, sin espacio o bloqueado
    }
    return storage;
  }

  function available() {
    return !!getStorage();
  }

  function readAll() {
    const store = getStorage();
    if (!store) return [];
    let raw = null;
    try { raw = store.getItem(KEY); } catch (err) { return []; }
    if (!raw) return [];
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (err) { return []; }
    const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter(function (item) {
      return item && typeof item.id === 'string' && item.graph && Array.isArray(item.graph.nodes);
    });
  }

  function writeAll(items) {
    const store = getStorage();
    if (!store) throw new Error('Este navegador no deja guardar nada (modo privado?)');
    const payload = JSON.stringify({ version: 1, items: items.slice(0, MAX_ITEMS) });
    try {
      store.setItem(KEY, payload);
    } catch (err) {
      throw new Error('No queda espacio para guardar. Borra algun diagrama de la lista.');
    }
  }

  function newId() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function byNewest(a, b) {
    return (b.updated || 0) - (a.updated || 0);
  }

  /** Lista para el menu: sin los datos del diagrama. */
  function list() {
    return readAll().sort(byNewest).map(function (item) {
      return {
        id: item.id,
        title: item.title || 'Sin titulo',
        updated: item.updated || 0,
        nodes: item.graph.nodes.length
      };
    });
  }

  function get(id) {
    const found = readAll().filter(function (item) { return item.id === id; })[0];
    return found ? found.graph : null;
  }

  function titleOf(id) {
    const found = readAll().filter(function (item) { return item.id === id; })[0];
    return found ? found.title : null;
  }

  function exists(id) {
    return readAll().some(function (item) { return item.id === id; });
  }

  /**
   * Guarda el diagrama. Si llega un id que ya existe, lo actualiza;
   * si no, crea una entrada nueva. Devuelve el id usado.
   */
  function save(id, graph, title) {
    const items = readAll();
    const data = Flow.serialize(graph);
    const name = (title || data.title || 'Sin titulo').trim() || 'Sin titulo';
    data.title = name;
    const now = Date.now();
    const index = id ? items.findIndex(function (item) { return item.id === id; }) : -1;
    let usedId = id;
    if (index >= 0) {
      items[index] = { id: id, title: name, updated: now, graph: data };
    } else {
      usedId = id || newId();
      items.unshift({ id: usedId, title: name, updated: now, graph: data });
    }
    writeAll(items);
    return usedId;
  }

  /** Guarda siempre como entrada nueva. */
  function saveAsNew(graph, title) {
    return save(null, graph, title);
  }

  function rename(id, title) {
    const items = readAll();
    const index = items.findIndex(function (item) { return item.id === id; });
    if (index < 0) return false;
    const name = String(title || '').trim() || 'Sin titulo';
    items[index].title = name;
    items[index].graph.title = name;
    items[index].updated = Date.now();
    writeAll(items);
    return true;
  }

  function remove(id) {
    const items = readAll();
    const rest = items.filter(function (item) { return item.id !== id; });
    if (rest.length === items.length) return false;
    writeAll(rest);
    return true;
  }

  function duplicate(id) {
    const items = readAll();
    const found = items.filter(function (item) { return item.id === id; })[0];
    if (!found) return null;
    const copy = JSON.parse(JSON.stringify(found.graph));
    const name = (found.title || 'Sin titulo') + ' (copia)';
    copy.title = name;
    const newer = { id: newId(), title: name, updated: Date.now(), graph: copy };
    items.unshift(newer);
    writeAll(items);
    return newer.id;
  }

  function clear() {
    const store = getStorage();
    if (!store) return;
    try { store.removeItem(KEY); } catch (err) { /* nada */ }
  }

  /** Tamano aproximado en bytes de lo guardado. */
  function usage() {
    const store = getStorage();
    if (!store) return 0;
    try { return (store.getItem(KEY) || '').length; } catch (err) { return 0; }
  }

  /** "hace 5 min", "ayer", "12 mar" ... para la lista. */
  function timeAgo(stamp, now) {
    const from = Number(stamp) || 0;
    if (!from) return '';
    const ms = (now === undefined ? Date.now() : now) - from;
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'ahora mismo';
    if (min < 60) return 'hace ' + min + (min === 1 ? ' minuto' : ' minutos');
    const hours = Math.floor(min / 60);
    if (hours < 24) return 'hace ' + hours + (hours === 1 ? ' hora' : ' horas');
    const days = Math.floor(hours / 24);
    if (days === 1) return 'ayer';
    if (days < 30) return 'hace ' + days + ' dias';
    const date = new Date(from);
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
      'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return date.getDate() + ' ' + MESES[date.getMonth()] + ' ' + date.getFullYear();
  }

  root.FlowStore = {
    KEY: KEY,
    useStorage: useStorage,
    available: available,
    list: list,
    get: get,
    titleOf: titleOf,
    exists: exists,
    save: save,
    saveAsNew: saveAsNew,
    rename: rename,
    remove: remove,
    duplicate: duplicate,
    clear: clear,
    usage: usage,
    timeAgo: timeAgo
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
