/* Convierte las hojas del departamento (matrices) en datos listos para el tablero.
   No depende del navegador: también se prueba con Node. */
(function (raiz) {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var SEDES = ['Barranquilla', 'Baranoa'];

  function texto(v) { return v == null ? '' : String(v).trim(); }

  /** Acepta número, "$ 1.234.567", "85,5", "-" o vacío. */
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = texto(v).replace(/[$\s%]/g, '');
    if (!s || s === '-') return 0;
    if (/,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  /** ISO, Date o "dd/mm/aaaa" → Date (o null). */
  function fecha(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = texto(v), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    var d = m ? new Date(+m[3], +m[2] - 1, +m[1], 12) : new Date(s);
    return isNaN(d) ? null : d;
  }

  function sede(v) {
    var s = texto(v).toLowerCase();
    if (s.indexOf('baranoa') >= 0) return 'Baranoa';
    if (s.indexOf('quilla') >= 0) return 'Barranquilla';
    return '';
  }

  function mesDe(nombre) {
    var s = texto(nombre).toLowerCase().slice(0, 3);
    for (var i = 0; i < 12; i++) if (MESES[i].toLowerCase().slice(0, 3) === s) return i + 1;
    return 0;
  }

  function gas(v) {
    var s = texto(v).toLowerCase();
    if (s.indexOf('ox') === 0) return 'Oxígeno';
    if (s.indexOf('nitr') === 0) return 'Nitrógeno';
    if (s.indexOf('aire') === 0) return 'Aire medicinal';
    if (s.indexOf('c02') === 0 || s.indexOf('co2') === 0 || s.indexOf('diox') === 0) return 'CO2';
    return texto(v);
  }

  function cilindros(m) {
    var filas = [], anio = 0;
    (m || []).slice(1).forEach(function (f) {
      var d = fecha(f[0]); if (d && !anio) anio = d.getFullYear();
    });
    (m || []).slice(1).forEach(function (f) {
      var s = sede(f[2]); if (!s || !texto(f[4])) return;
      var d = fecha(f[0]);
      filas.push({ sede: s, anio: d ? d.getFullYear() : anio, mes: d ? d.getMonth() + 1 : mesDe(f[1]), fecha: d,
        remision: texto(f[3]), gas: gas(f[4]), cantidad: num(f[5]), estado: texto(f[8]) || 'Pendiente', valor: num(f[10]) });
    });
    return filas;
  }

  /** "Hoja 4": bloques por sede con gas, autorizados, pedidos y disponibles. */
  function autorizados(m) {
    var filas = [], actual = '';
    (m || []).forEach(function (f) {
      var a = texto(f[0]);
      if (/sede/i.test(a)) { actual = sede(a); return; }
      if (!actual || !a || typeof f[1] !== 'number') return;
      filas.push({ sede: actual, gas: gas(a), autorizados: num(f[1]), pedidos: num(f[2]), disponibles: num(f[5]), pedido: fecha(f[3]), entrega: fecha(f[4]) });
    });
    return filas;
  }

  /** Une el año completo con el detalle facturado del trimestre 3 (este manda cuando la remisión coincide). */
  function tanque(anual, t3) {
    var porRemision = {}, filas = [];
    (t3 || []).slice(1).forEach(function (f) {
      var s = sede(f[2]), d = fecha(f[0]); if (!s || !d) return;
      var r = { sede: s, anio: d.getFullYear(), mes: d.getMonth() + 1, fecha: d, remision: texto(f[3]), m3: num(f[9]), valor: num(f[10]), factura: texto(f[8]), estimado: false };
      porRemision[r.remision + '|' + s] = true; filas.push(r);
    });
    (anual || []).slice(1).forEach(function (f) {
      var s = sede(f[2]), d = fecha(f[0]); if (!s || !d || porRemision[texto(f[3]) + '|' + s]) return;
      var facturado = num(f[10]);
      filas.push({ sede: s, anio: d.getFullYear(), mes: d.getMonth() + 1, fecha: d, remision: texto(f[3]), m3: num(f[6]),
        valor: facturado || num(f[8]), factura: '', estimado: !facturado });
    });
    return filas;
  }

  function niveles(m) {
    return (m || []).slice(1).filter(function (f) { return sede(f[0]); }).map(function (f) {
      return { sede: sede(f[0]), nivel: num(f[1]), lleno: num(f[2]), lectura: fecha(f[3]) || texto(f[3]), baja7: num(f[4]), recarga: fecha(f[6]) || texto(f[6]) };
    });
  }

  function presupuesto(m) {
    return (m || []).slice(1).filter(function (f) { return sede(f[2]) && texto(f[3]); }).map(function (f) {
      return { anio: num(f[0]), sede: sede(f[2]), sistema: texto(f[3]), item: texto(f[4]), valor: num(f[6]) };
    });
  }

  /** "Resumen general" del cronograma: una fila por mes (clave aaaa-mm). */
  function cronograma(m, nombreSede) {
    return (m || []).filter(function (f) { return /^\d{4}-\d{2}$/.test(texto(f[1])); }).map(function (f) {
      var clave = texto(f[1]);
      return { sede: nombreSede, anio: +clave.slice(0, 4), mes: +clave.slice(5),
        plantasProg: num(f[3]), plantasHechas: num(f[4]), inspProg: num(f[6]), inspHechas: num(f[7]),
        redesProg: num(f[9]), redesHechas: num(f[10]), tickets: num(f[12]), ticketsCerrados: num(f[13]),
        materiales: num(f[16]), cumplimiento: texto(f[17]) === '-' || texto(f[17]) === '' ? null : num(f[17]) * (typeof f[17] === 'number' && f[17] <= 1 ? 100 : 1) };
    });
  }

  function almacen(m, nombreSede) {
    var enc = -1;
    (m || []).forEach(function (f, i) { if (enc < 0 && /^material$/i.test(texto(f[0]))) enc = i; });
    if (enc < 0) return [];
    var anios = m[enc].slice(2, 6).map(num);
    return m.slice(enc + 1).filter(function (f) { return texto(f[0]); }).map(function (f) {
      var porAnio = {}; anios.forEach(function (a, i) { if (a) porAnio[a] = num(f[2 + i]); });
      return { sede: nombreSede, material: texto(f[0]), unidad: texto(f[1]), porAnio: porAnio, total: num(f[6]), existencia: num(f[7]), faltante: num(f[8]) };
    });
  }

  /** La hoja de energía no trae año: se toma el que se le indique. */
  function energia(m, anio) {
    return (m || []).slice(1).filter(function (f) { return sede(f[1]) && mesDe(f[0]); }).map(function (f) {
      return { sede: sede(f[1]), anio: anio, mes: mesDe(f[0]), sistema: texto(f[2]).replace(/de\s*aire/i, 'de aire'), valor: num(f[5]) };
    });
  }

  function hidrostatica(m) {
    return (m || []).filter(function (f) { return mesDe(f[0]) && num(f[1]) > 0 && /\d{4}/.test(texto(f[0])); }).map(function (f) {
      var t = texto(f[0]);
      return { anio: +t.match(/\d{4}/)[0], mes: mesDe(t), cilindros: num(f[1]), seriales: texto(f[2]), nota: texto(f[4]) };
    });
  }

  function kpi(m) {
    var filas = [], dentro = false;
    (m || []).forEach(function (f) {
      if (!dentro && /^indicador/i.test(texto(f[2]))) { dentro = true; return; }
      if (!dentro) return;
      if (/^perspectiva$/i.test(texto(f[0])) || !texto(f[2])) { dentro = dentro && !!texto(f[2]); return; }
      filas.push({ perspectiva: texto(f[1]), indicador: texto(f[2]), meta: texto(f[3]), frecuencia: texto(f[4]) });
    });
    return filas;
  }

  function planta(m) {
    var r = {};
    (m || []).forEach(function (f) {
      var k = texto(f[0]).toLowerCase();
      if (k === 'total actividades') r.total = num(f[1]);
      if (k === 'terminadas') r.terminadas = num(f[1]);
      if (k.indexOf('en espera') === 0) r.espera = num(f[1]);
      if (k === 'avance global') r.avance = typeof f[1] === 'number' && f[1] <= 1 ? Math.round(f[1] * 100) : num(f[1]);
    });
    return r;
  }

  function preparar(paquete) {
    var f = (paquete && paquete.fuentes) || {};
    var cil = cilindros(f.cilindros);
    var anioBase = cil.length ? cil[0].anio : new Date().getFullYear();
    return {
      leido: paquete && paquete.leido, errores: (paquete && paquete.errores) || {},
      cilindros: cil, autorizados: autorizados(f.autorizados), tanque: tanque(f.tanqueAnual, f.tanqueT3), niveles: niveles(f.tanqueNivel),
      presupuesto: presupuesto(f.presupuesto),
      cronograma: cronograma(f.cronoBquilla, 'Barranquilla').concat(cronograma(f.cronoBaranoa, 'Baranoa')),
      almacen: almacen(f.almacenBquilla, 'Barranquilla').concat(almacen(f.almacenBaranoa, 'Baranoa')),
      energia: energia(f.energia, anioBase), anioEnergia: anioBase,
      hidrostatica: hidrostatica(f.hidrostatica), kpi: kpi(f.kpi), planta: planta(f.planta)
    };
  }

  /** filtro: { sede: 'Ambas'|'Barranquilla'|'Baranoa', mes: 0–12, anio: 0|aaaa } */
  function pasa(fila, filtro) {
    return (filtro.sede === 'Ambas' || !fila.sede || fila.sede === filtro.sede) &&
      (!filtro.mes || fila.mes === filtro.mes) && (!filtro.anio || fila.anio === filtro.anio);
  }

  function suma(filas, campo) { return filas.reduce(function (t, r) { return t + (r[campo] || 0); }, 0); }

  function aniosDisponibles(d) {
    var s = {};
    [d.cilindros, d.tanque, d.cronograma, d.energia].forEach(function (l) { l.forEach(function (r) { if (r.anio) s[r.anio] = 1; }); });
    return Object.keys(s).map(Number).sort();
  }

  raiz.Datos = { MESES: MESES, SEDES: SEDES, preparar: preparar, pasa: pasa, suma: suma, num: num, fecha: fecha, aniosDisponibles: aniosDisponibles };
})(typeof window !== 'undefined' ? window : globalThis);
