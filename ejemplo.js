/* Datos de ejemplo para la prueba de diseño (botón «Ver con datos de ejemplo»).
   Son inventados: no salen de las hojas del departamento ni del servidor. */
(function (raiz) {
  'use strict';
  var SEDES = ['Barranquilla', 'Baranoa'];

  function azar(semilla) {
    var x = semilla % 2147483647; if (x <= 0) x += 2147483646;
    return function () { x = x * 16807 % 2147483647; return (x - 1) / 2147483646; };
  }
  function entre(r, a, b) { return Math.round(a + r() * (b - a)); }
  function dia(anio, mes, d, h) { return new Date(anio, mes - 1, d, h || 9); }

  function datos(hoy) {
    var r = azar(2026), anio = hoy.getFullYear(), mesHoy = hoy.getMonth() + 1;
    var cil = [], tan = [], cro = [], ene = [], rem = 1400, fac = 880;
    var gases = [['Oxígeno', 48000], ['Aire medicinal', 52000], ['Nitrógeno', 61000], ['CO2', 75000]];
    for (var m = 1; m <= mesHoy; m++) {
      SEDES.forEach(function (s) {
        var peso = s === 'Barranquilla' ? 1 : 0.45;
        gases.forEach(function (g, gi) {
          var veces = gi === 0 ? 3 : 1;
          for (var v = 0; v < veces; v++) {
            var cant = Math.max(1, Math.round(entre(r, 4, gi === 0 ? 16 : 6) * peso)), d = Math.min(entre(r, 1, 28), m === mesHoy ? hoy.getDate() : 28);
            cil.push({ sede: s, anio: anio, mes: m, fecha: dia(anio, m, d, entre(r, 7, 17)), remision: 'R-' + (rem++), gas: g[0], cantidad: cant,
              estado: m === mesHoy && r() < 0.35 ? 'Pendiente' : 'Firmado', valor: cant * g[1] });
          }
        });
        var recargas = s === 'Barranquilla' ? 3 : 2;
        for (var t = 0; t < recargas; t++) {
          var dd = Math.min(4 + t * 9 + entre(r, 0, 3), m === mesHoy ? hoy.getDate() : 28), m3 = entre(r, 900, 1500) * peso;
          var est = m === mesHoy && t === recargas - 1;
          tan.push({ sede: s, anio: anio, mes: m, fecha: dia(anio, m, dd, 6), remision: 'T-' + (rem++), m3: m3, valor: m3 * 2950, factura: est ? '' : 'FE-' + (fac++), estimado: est });
        }
        var pp = s === 'Barranquilla' ? 8 : 4, ip = s === 'Barranquilla' ? 22 : 12, rp = s === 'Barranquilla' ? 18 : 8, tk = entre(r, 2, 6);
        var avance = m < mesHoy ? 1 : Math.min(1, hoy.getDate() / 30 + 0.05);
        var ph = Math.round(pp * avance * (0.85 + r() * 0.15)), ih = Math.round(ip * avance * (0.9 + r() * 0.1)), rh = Math.round(rp * avance * (0.6 + r() * 0.4)), tc = Math.round(tk * avance * (0.5 + r() * 0.5));
        cro.push({ sede: s, anio: anio, mes: m, plantasProg: pp, plantasHechas: ph, inspProg: ip, inspHechas: ih, redesProg: rp, redesHechas: rh, tickets: tk, ticketsCerrados: tc,
          materiales: entre(r, 900000, 2600000) * peso, cumplimiento: Math.round((ph + ih + rh) / (pp + ip + rp) * 1000) / 10 });
        ene.push({ sede: s, anio: anio, mes: m, sistema: 'Planta de aire', valor: entre(r, 2800000, 3600000) * peso });
        ene.push({ sede: s, anio: anio, mes: m, sistema: 'Planta de vacío', valor: entre(r, 1500000, 2100000) * peso });
      });
    }
    var pre = [];
    SEDES.forEach(function (s) {
      var k = s === 'Barranquilla' ? 1 : 0.45;
      pre.push({ anio: anio, sede: s, sistema: 'Tanque criogénico', item: 'Oxígeno líquido', valor: 165000000 * k });
      pre.push({ anio: anio, sede: s, sistema: 'Cilindros', item: 'Recargas', valor: 52000000 * k });
      pre.push({ anio: anio, sede: s, sistema: 'Energía de las plantas', item: 'Aire y vacío', valor: 66000000 * k });
      pre.push({ anio: anio, sede: s, sistema: 'Mantenimiento de redes', item: 'Mangueras y racores', valor: 24000000 * k });
    });
    return {
      leido: new Date(Date.now() - 3 * 60000).toISOString(), errores: {},
      cilindros: cil, tanque: tan, cronograma: cro, energia: ene, anioEnergia: anio, presupuesto: pre,
      autorizados: [
        { sede: 'Barranquilla', gas: 'Oxígeno', autorizados: 40, pedidos: 31, disponibles: 9 }, { sede: 'Barranquilla', gas: 'Aire medicinal', autorizados: 12, pedidos: 8, disponibles: 4 },
        { sede: 'Barranquilla', gas: 'Nitrógeno', autorizados: 6, pedidos: 6, disponibles: 0 }, { sede: 'Barranquilla', gas: 'CO2', autorizados: 4, pedidos: 1, disponibles: 3 },
        { sede: 'Baranoa', gas: 'Oxígeno', autorizados: 18, pedidos: 11, disponibles: 7 }, { sede: 'Baranoa', gas: 'Aire medicinal', autorizados: 6, pedidos: 2, disponibles: 4 }
      ],
      niveles: [
        { sede: 'Barranquilla', nivel: 47, lleno: 136, lectura: new Date(Date.now() - 95 * 60000), baja7: 5.8, recarga: '' },
        { sede: 'Baranoa', nivel: 52, lleno: 80, lectura: new Date(Date.now() - 26 * 3600000), baja7: 2.9, recarga: '' }
      ],
      almacen: [{ sede: 'Barranquilla', material: 'Manguera verde O2 (m)', unidad: 'm', porAnio: (function () { var o = {}; o[anio] = 120; return o; })(), total: 120, existencia: 85, faltante: 35 }],
      hidrostatica: [{ anio: anio, mes: mesHoy, cilindros: 6, seriales: '', nota: 'Oxígeno de 6 m³' }],
      kpi: [
        { perspectiva: 'Procesos internos', indicador: 'Cumplimiento del cronograma de mantenimiento', meta: '≥ 90 %', frecuencia: 'Mensual' },
        { perspectiva: 'Financiera', indicador: 'Ejecución del presupuesto', meta: '≤ 100 %', frecuencia: 'Mensual' },
        { perspectiva: 'Cliente', indicador: 'Correctivos atendidos en menos de 24 horas', meta: '≥ 95 %', frecuencia: 'Mensual' },
        { perspectiva: 'Procesos internos', indicador: 'Rondas diarias de cilindros realizadas', meta: '≥ 98 %', frecuencia: 'Mensual' }
      ],
      kpiRes: [],
      planta: { total: 40, terminadas: 26, espera: 3, avance: 65 }
    };
  }

  var SERVICIOS = ['UCI adultos', 'Urgencias', 'Cirugía', 'Hospitalización piso 3', 'Neonatos', 'Recuperación'];
  var EQUIPOS = [['Compresor 1', 'Aire medicinal'], ['Compresor 2', 'Aire medicinal'], ['Bomba de vacío', 'Vacío'], ['Generador de O2 A', 'Oxígeno'], ['Secador', 'Aire medicinal']];
  var PASOS = ['Avisar al jefe de servicio antes de empezar.', 'Cerrar la válvula de zona y comprobar que no haya pacientes conectados.', 'Hacer el cambio y probar fugas con agua jabonosa.', 'Abrir la válvula y dejar registro en la hoja.'];

  function tareas(clave, hoy) {
    var anio = +clave.slice(0, 4), mes = +clave.slice(5), r = azar(anio * 100 + mes), l = [], n = 0;
    var ultimo = new Date(anio, mes, 0).getDate(), corte = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
    function semanaDe(d) { return Math.ceil((d + new Date(anio, mes - 1, 1).getDay()) / 7); }
    function estado(f) {
      if (f < corte) { var x = r(); return x < 0.72 ? 'Hecho' : x < 0.87 ? 'Vencido' : 'Reprogramado'; }
      return r() < 0.12 ? 'Reprogramado' : 'Pendiente';
    }
    SEDES.forEach(function (s) {
      var redes = s === 'Barranquilla' ? 12 : 6, plantas = s === 'Barranquilla' ? 6 : 3;
      for (var i = 0; i < redes; i++) {
        var d = entre(r, 1, ultimo), f = new Date(anio, mes - 1, d, 12), srv = SERVICIOS[entre(r, 0, SERVICIOS.length - 1)], hab = 'Cama ' + entre(r, 1, 14);
        l.push({ id: s + '|redes|' + (++n), tipo: 'Redes', sede: s, fecha: f, semana: semanaDe(d), horas: 1.5, titulo: srv + ' · ' + hab, sub: '1,5 h · 1 O2, 1 aire', frente: 'Redes · ' + srv,
          actividad: 'Cambio de mangueras y racores', estado: estado(f), detalle: [['Lugar', srv + ' · ' + hab], ['Material', '2 m de manguera verde · 2 × racor']], pasos: PASOS, hoja: 'Detalle redes' });
      }
      for (i = 0; i < plantas; i++) {
        d = entre(r, 1, ultimo); f = new Date(anio, mes - 1, d, 12); var eq = EQUIPOS[i % EQUIPOS.length];
        l.push({ id: s + '|plantas|' + (++n), tipo: 'Plantas', sede: s, fecha: f, semana: semanaDe(d), horas: 2, titulo: eq[0], sub: 'Revisión de filtros y purgas · 2 h', frente: 'Plantas · ' + eq[1],
          actividad: 'Mantenimiento preventivo', estado: estado(f), detalle: [['Equipo', eq[0]], ['Frecuencia', 'Mensual']], pasos: PASOS.slice(2), hoja: 'Detalle plantas' });
      }
      for (var w = 0; w < 5; w++) {
        var desde = new Date(anio, mes - 1, 1 + w * 7, 12); if (desde.getMonth() !== mes - 1) break;
        var hasta = new Date(anio, mes - 1, Math.min(ultimo, 7 + w * 7), 12), prog = 6, hechos = hasta < corte ? entre(r, 5, 6) : desde < corte ? Math.min(6, hoy.getDate() - desde.getDate()) : 0;
        l.push({ id: s + '|insp|' + (++n), tipo: 'Inspección', sede: s, fecha: null, desde: desde, hasta: hasta, semana: w + 1, horas: 3, titulo: 'Ronda diaria de cilindros', sub: 'Diaria · 20 min',
          frente: 'Inspecciones y rondas', actividad: 'Ronda diaria de cilindros', diasProg: prog, diasHechos: hechos, estado: hechos >= prog ? 'Hecho' : hasta < corte ? 'Vencido' : 'Pendiente', detalle: [['Días', hechos + ' de ' + prog + ' realizados']], pasos: [], hoja: 'Detalle inspecciones' });
      }
      var tickets = entre(r, 1, 3);
      for (i = 0; i < tickets; i++) {
        d = entre(r, 1, Math.min(ultimo, Math.max(1, anio === hoy.getFullYear() && mes === hoy.getMonth() + 1 ? hoy.getDate() : ultimo))); f = new Date(anio, mes - 1, d, 12);
        l.push({ id: s + '|corr|' + (++n), tipo: 'Correctivo', sede: s, fecha: f, semana: semanaDe(d), horas: 0, titulo: 'Ticket ' + (300 + n) + ' · ' + SERVICIOS[entre(r, 0, 5)], sub: 'Fuga en toma de oxígeno',
          frente: 'Correctivos (tickets)', actividad: 'Fuga en toma de oxígeno', estado: r() < 0.6 ? 'Hecho' : 'Pendiente', detalle: [['Falla', 'Fuga en toma de oxígeno']], pasos: [], hoja: 'Mantenimientos correctivos' });
      }
    });
    return l;
  }

  raiz.Ejemplo = { datos: datos, tareas: tareas };
})(typeof window !== 'undefined' ? window : globalThis);
