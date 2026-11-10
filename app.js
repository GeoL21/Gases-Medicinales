/* PWA Gases Medicinales – Clínica Reina Catalina · fase 1
   Ingreso con PIN o huella del celular, accesos, filtros de sede/mes/año y tablero. */
(function () {
  'use strict';

  var PREF = 'gases:';
  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem(PREF + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(PREF + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(PREF + k); } catch (e) {} }
  };

  var D = window.Datos, MESES = D.MESES;
  var API = (window.GASES_CONFIG && window.GASES_CONFIG.api) || ls.get('api', '');
  var ES_CELULAR = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  var hoy = new Date();
  var est = {
    sesion: ls.get('sesion', null), datos: null, vista: 'inicio', cargando: false, aviso: '',
    filtro: ls.get('filtro', { sede: 'Ambas', mes: hoy.getMonth() + 1, anio: hoy.getFullYear() }),
    ingreso: { modo: 'entrar', error: '', ocupado: false }, accesos: null, cuenta: null, nuevo: null
  };
  var $app = document.getElementById('app');

  /* ───────── utilidades ───────── */
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var fmtPesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  var fmtNum = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
  function pesos(n) { return fmtPesos.format(Math.round(n || 0)).replace(/\s/g, ''); }
  function n1(n) { return fmtNum.format(n || 0); }
  function hora(d) {
    if (!(d instanceof Date)) d = D.fecha(d);
    if (!d) return '';
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ', ' +
      d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?a\.?\s?m\.?/i, ' a. m.').replace(/\s?p\.?\s?m\.?/i, ' p. m.');
  }
  function periodo() {
    var f = est.filtro;
    return (f.mes ? MESES[f.mes - 1] : 'Todo el año') + (f.anio ? ' de ' + f.anio : ' · todos los años');
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) : null; }

  function b64url(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function hexABytes(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function bytesAHex(b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }

  /* ───────── servidor ───────── */
  function api(accion, datos) {
    if (!API) return Promise.reject(new Error('Falta la dirección del servidor.'));
    var cuerpo = Object.assign({ accion: accion, token: est.sesion && est.sesion.token }, datos || {});
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo) })
      .then(function (r) { if (!r.ok) throw new Error('El servidor respondió ' + r.status); return r.json(); })
      .then(function (r) {
        if (r && r.sesion === false) { cerrarLocal(); pintar(); }
        if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo completar.');
        return r;
      });
  }

  function guardarSesion(r) {
    est.sesion = { token: r.token, vence: r.vence, usuario: r.usuario };
    ls.set('sesion', est.sesion); ls.set('ultimoUsuario', r.usuario.usuario);
  }
  function cerrarLocal() { est.sesion = null; est.datos = null; ls.del('sesion'); ls.del('paquete'); est.vista = 'inicio'; }

  /* ───────── huella del celular (WebAuthn) ───────── */
  function hayHuella() { return !!(window.PublicKeyCredential && navigator.credentials); }

  function entrarConHuella() {
    return api('retoHuella').then(function (r) {
      var opciones = { challenge: hexABytes(r.reto), rpId: location.hostname, userVerification: 'required', timeout: 120000 };
      // En el PC se pide el celular (código QR + Bluetooth), no la huella ni el PIN de Windows.
      opciones.hints = ES_CELULAR ? ['client-device'] : ['hybrid'];
      return navigator.credentials.get({ publicKey: opciones });
    }).then(function (c) {
      return api('ingresoHuella', { id: c.id, clientDataJSON: b64url(c.response.clientDataJSON), authenticatorData: b64url(c.response.authenticatorData), signature: b64url(c.response.signature) });
    }).then(guardarSesion);
  }

  /** Solo desde el celular: la huella queda guardada en el teléfono. */
  function registrarHuella() {
    if (!ES_CELULAR) return Promise.reject(new Error('La huella se registra desde el celular, no desde el PC.'));
    return api('retoAltaHuella').then(function (r) {
      return navigator.credentials.create({ publicKey: {
        challenge: hexABytes(r.reto), rp: { name: 'Gases Medicinales CRC', id: location.hostname },
        user: { id: new TextEncoder().encode(r.idUsuario), name: r.usuario, displayName: r.nombre },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none', timeout: 120000,
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }
      } });
    }).then(function (c) {
      var spki = c.response.getPublicKey && c.response.getPublicKey();
      if (!spki || c.response.getPublicKeyAlgorithm() !== -7) throw new Error('Este teléfono no entrega una clave compatible.');
      var crudo = new Uint8Array(spki).slice(-64);   // X e Y de la clave P-256
      return api('altaHuella', { id: c.id, clientDataJSON: b64url(c.response.clientDataJSON), x: bytesAHex(crudo.slice(0, 32)), y: bytesAHex(crudo.slice(32)),
        dispositivo: (navigator.userAgent.match(/Android[^;)]*|iPhone|iPad/) || ['Celular'])[0] });
    });
  }

  function mensajeHuella(err) {
    if (err && err.name === 'NotAllowedError') return 'Se canceló o venció el intento con la huella.';
    return (err && err.message) || 'No se pudo usar la huella.';
  }

  /* ───────── datos ───────── */
  function cargarDatos(silencioso) {
    var guardado = ls.get('paquete', null);
    if (guardado && !est.datos) est.datos = D.preparar(guardado);
    est.cargando = true; if (!silencioso) pintar();
    return api('datos').then(function (r) {
      ls.set('paquete', r); est.datos = D.preparar(r); est.aviso = '';
    }).catch(function (err) {
      est.aviso = navigator.onLine ? err.message : 'Sin conexión: se muestran los últimos datos guardados en este equipo.';
    }).then(function () { est.cargando = false; pintar(); });
  }

  function fil(lista) { return lista.filter(function (r) { return D.pasa(r, est.filtro); }); }
  function porSede(lista, campo) {
    var o = { Barranquilla: 0, Baranoa: 0 };
    lista.forEach(function (r) { if (o[r.sede] != null) o[r.sede] += r[campo] || 0; });
    o.total = o.Barranquilla + o.Baranoa; return o;
  }
  function sedesVisibles() { return est.filtro.sede === 'Ambas' ? D.SEDES : [est.filtro.sede]; }

  /* ───────── piezas de interfaz ───────── */
  function tarjeta(titulo, valor, pie, tono) {
    return '<div class="tarjeta ' + (tono || '') + '"><span class="rotulo">' + e(titulo) + '</span><span class="valor">' + valor + '</span><span class="pie">' + pie + '</span></div>';
  }
  function barra(etiqueta, valor, maximo, textoValor) {
    return '<div class="barra"><div class="barra-cab"><span>' + e(etiqueta) + '</span><b>' + textoValor + '</b></div><div class="barra-fondo"><div class="barra-relleno" style="width:' + (maximo ? Math.max(1, valor / maximo * 100) : 0).toFixed(1) + '%"></div></div></div>';
  }
  function tablaSedes(cabeceras, filas, pieFila) {
    return '<div class="tabla-caja"><table><thead><tr>' + cabeceras.map(function (c, i) { return '<th scope="col"' + (i ? ' class="der"' : '') + '>' + e(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      filas.map(function (f) { return '<tr>' + f.map(function (c, i) { return i ? '<td class="der">' + c + '</td>' : '<th scope="row">' + c + '</th>'; }).join('') + '</tr>'; }).join('') +
      (pieFila ? '<tr class="total">' + pieFila.map(function (c, i) { return i ? '<td class="der">' + c + '</td>' : '<th scope="row">' + c + '</th>'; }).join('') + '</tr>' : '') + '</tbody></table></div>';
  }
  function vacio(t) { return '<p class="vacio">' + e(t) + '</p>'; }

  function filtros() {
    var f = est.filtro, anios = est.datos ? D.aniosDisponibles(est.datos) : [];
    if (f.anio && anios.indexOf(f.anio) < 0) anios.push(f.anio);
    anios.sort();
    return '<div class="filtros"><div class="segmento" role="group" aria-label="Sede">' +
      ['Ambas'].concat(D.SEDES).map(function (s) { return '<button type="button" data-sede="' + s + '" aria-pressed="' + (f.sede === s) + '">' + (s === 'Ambas' ? 'Ambas sedes' : s) + '</button>'; }).join('') + '</div>' +
      '<label class="campo-mini"><span class="oculto">Mes</span><select id="f-mes"><option value="0">Todo el año</option>' + MESES.map(function (m, i) { return '<option value="' + (i + 1) + '"' + (f.mes === i + 1 ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></label>' +
      '<label class="campo-mini"><span class="oculto">Año</span><select id="f-anio"><option value="0">Todos los años</option>' + anios.map(function (a) { return '<option value="' + a + '"' + (f.anio === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></label></div>';
  }

  /* ───────── vistas ───────── */
  function vistaInicio(d) {
    var cil = fil(d.cilindros), tan = fil(d.tanque), cro = fil(d.cronograma);
    var pend = cil.filter(function (r) { return /pend/i.test(r.estado); });
    var h = '<section class="rejilla cuatro">' +
      tarjeta('Cilindros', pesos(D.suma(cil, 'valor')), cil.length + (cil.length === 1 ? ' línea de remisión' : ' líneas de remisión')) +
      tarjeta('Tanque criogénico', pesos(D.suma(tan, 'valor')), n1(D.suma(tan, 'm3')) + ' m³ en ' + tan.length + ' recargas' + (tan.some(function (r) { return r.estimado; }) ? ' · incluye estimados sin facturar' : '')) +
      tarjeta('Remisiones por firmar', String(pend.length), pesos(D.suma(pend, 'valor')) + ' pendientes', pend.length ? 'aviso' : '') +
      (function () {
        var prog = D.suma(cro, 'redesProg'), hechas = D.suma(cro, 'redesHechas');
        return tarjeta('Redes del cronograma', hechas + ' de ' + prog, 'Cuartos hechos frente a programados · meta ≥ 95 %');
      })() + '</section>';

    // Tanques (siempre la lectura más reciente; no depende del mes).
    var niveles = d.niveles.filter(function (n) { return est.filtro.sede === 'Ambas' || n.sede === est.filtro.sede; });
    var cap = { Barranquilla: [136, 40], Baranoa: [80, 24] };
    h += '<div class="rejilla dos-uno"><section class="panel"><h2>Tanques criogénicos, última lectura</h2>' +
      (niveles.length ? niveles.map(function (n) {
        var c = cap[n.sede], lleno = Math.min(100, n.nivel / c[0] * 100), bajo = n.nivel <= c[1];
        return '<div class="tanque"><div class="barra-cab"><span>' + n.sede + '</span><b>' + n1(n.nivel) + ' de ' + c[0] + ' in · ' + Math.round(lleno) + ' %</b></div>' +
          '<div class="barra-fondo alta" role="img" aria-label="Nivel al ' + Math.round(lleno) + ' por ciento"><div class="barra-relleno ' + (bajo ? 'rojo' : 'verde') + '" style="width:' + lleno.toFixed(1) + '%"></div><i class="marca" style="left:' + (c[1] / c[0] * 100).toFixed(1) + '%"></i></div>' +
          '<span class="pie">Baja ' + n1(n.baja7) + ' in por día · lectura ' + e(n.lectura instanceof Date ? hora(n.lectura) : n.lectura) + ' · recarga a ' + c[1] + ' in</span></div>';
      }).join('') : vacio('No hay lecturas de tanque.')) + '</section>';

    // Qué falta y dónde.
    var alertas = [];
    d.autorizados.filter(function (a) { return (est.filtro.sede === 'Ambas' || a.sede === est.filtro.sede) && a.autorizados > 0 && a.disponibles <= 0; })
      .forEach(function (a) { alertas.push(['urgente', 'Cilindros', a.gas + ' en ' + a.sede + ': 0 disponibles de ' + a.autorizados + ' autorizados.']); });
    if (pend.length) alertas.push(['aviso', 'Firma', pend.length + (pend.length === 1 ? ' línea de remisión sin firmar por ' : ' líneas de remisión sin firmar por ') + pesos(D.suma(pend, 'valor')) + '.']);
    d.hidrostatica.filter(function (x) { return x.anio === hoy.getFullYear() && x.mes === hoy.getMonth() + 1; })
      .forEach(function (x) { alertas.push(['urgente', 'Prueba', x.cilindros + ' cilindros por enviar a prueba hidrostática este mes' + (x.nota ? '. ' + x.nota : '') + '.']); });
    var anioAlm = est.filtro.anio || hoy.getFullYear();
    d.almacen.filter(function (a) { return (est.filtro.sede === 'Ambas' || a.sede === est.filtro.sede) && (a.porAnio[anioAlm] || 0) > a.existencia; }).slice(0, 4)
      .forEach(function (a) { alertas.push(['aviso', 'Almacén', a.sede + ' ' + anioAlm + ': ' + a.material + ', se necesitan ' + n1(a.porAnio[anioAlm]) + ' ' + a.unidad + ' y hay ' + n1(a.existencia) + '.']); });
    if (d.planta.avance != null) alertas.push(['nota', 'Proyecto', 'Planta de oxígeno Barranquilla: avance ' + d.planta.avance + ' %' + (d.planta.espera ? ', ' + d.planta.espera + ' de ' + d.planta.total + ' actividades en espera' : '') + '.']);
    h += '<section class="panel"><h2>Qué falta y dónde</h2>' + (alertas.length ? '<ul class="alertas">' + alertas.map(function (a) { return '<li><span class="chip ' + a[0] + '">' + a[1] + '</span><span>' + e(a[2]) + '</span></li>'; }).join('') + '</ul>' : vacio('Sin pendientes para este filtro.')) + '</section></div>';

    // Cilindros por mes y autorizados.
    var porMes = MESES.map(function (m, i) { return D.suma(cil.filter(function (r) { return r.mes === i + 1; }), 'valor'); });
    var maxMes = Math.max.apply(null, porMes);
    h += '<div class="rejilla dos-uno"><section class="panel"><h2>Gasto en cilindros por mes · ' + e(periodo()) + '</h2>' +
      (maxMes ? '<div class="columnas" role="img" aria-label="Gasto en cilindros por mes">' + porMes.map(function (v, i) {
        return '<div class="col"><span>' + (v ? (v / 1e6).toFixed(2).replace('.', ',') + ' M' : '') + '</span><i style="height:' + (v / maxMes * 100).toFixed(1) + '%"></i><em>' + MESES[i].slice(0, 3) + '</em></div>';
      }).join('') + '</div>' : vacio('Sin remisiones en este periodo.')) + '</section>';
    var gases = ['Oxígeno', 'Aire medicinal', 'Nitrógeno', 'CO2'];
    h += '<section class="panel"><h2>Cilindros autorizados y disponibles</h2>' + tablaSedes(['Gas'].concat(sedesVisibles()),
      gases.map(function (g) {
        return [g].concat(sedesVisibles().map(function (s) {
          var a = d.autorizados.filter(function (x) { return x.sede === s && x.gas === g; })[0];
          return a ? '<b class="' + (a.disponibles <= 0 ? 'malo' : '') + '">' + a.disponibles + '</b> de ' + a.autorizados : '—';
        }));
      })) + '<span class="pie">Disponibles de los autorizados del trimestre.</span></section></div>';

    // KPI de la planeación.
    h += '<section class="panel"><h2>Indicadores (KPI) de la planeación estratégica</h2>' + (d.kpi.length ? '<div class="rejilla cuatro">' + d.kpi.map(function (k) {
      return '<div class="kpi"><b>' + e(k.indicador) + '</b><span class="meta">Meta ' + e(k.meta) + '</span><span class="pie">' + e(k.perspectiva) + ' · ' + e(k.frecuencia.toLowerCase()) + '</span></div>';
    }).join('') + '</div>' : vacio('No pude leer el cuadro de mando.')) + '</section>';
    return h;
  }

  function vistaCronograma(d) {
    var cro = fil(d.cronograma);
    if (!cro.length) return '<section class="panel">' + vacio('El cronograma no tiene filas para ' + periodo() + '. Empieza en noviembre de 2026.') + '</section>';
    function fila(nombre, l) {
      var prog = D.suma(l, 'redesProg'), hechas = D.suma(l, 'redesHechas');
      var cumpl = l.length === 1 && l[0].cumplimiento != null ? Math.round(l[0].cumplimiento) + ' %' : (pct(hechas, prog) != null ? pct(hechas, prog) + ' % de redes' : '—');
      return [nombre, n1(D.suma(l, 'plantasHechas')) + ' de ' + n1(D.suma(l, 'plantasProg')), n1(D.suma(l, 'inspHechas')) + ' de ' + n1(D.suma(l, 'inspProg')), hechas + ' de ' + prog,
        D.suma(l, 'ticketsCerrados') + ' de ' + D.suma(l, 'tickets'), pesos(D.suma(l, 'materiales')), '<b>' + cumpl + '</b>'];
    }
    var filas = sedesVisibles().map(function (s) { return fila(s, cro.filter(function (r) { return r.sede === s; })); });
    var h = '<section class="panel"><h2>Programado frente a hecho · ' + e(periodo()) + '</h2>' +
      tablaSedes(['Sede', 'Plantas', 'Inspecciones (días)', 'Redes (cuartos)', 'Correctivos cerrados', 'Materiales', 'Cumplimiento'], filas, filas.length > 1 ? fila('Total', cro) : null) +
      '<span class="pie">Hecho de programado. Sale del «Resumen general» de cada cronograma; el detalle semana a semana llega en la fase 2.</span></section>';
    var claves = {};
    cro.forEach(function (r) { claves[r.anio + '-' + ('0' + r.mes).slice(-2)] = 1; });
    var lista = Object.keys(claves).sort();
    var max = Math.max.apply(null, lista.map(function (k) { return D.suma(cro.filter(function (r) { return r.anio + '-' + ('0' + r.mes).slice(-2) === k; }), 'materiales'); }));
    h += '<section class="panel"><h2>Materiales del preventivo por mes</h2>' + lista.slice(0, 38).map(function (k) {
      var v = D.suma(cro.filter(function (r) { return r.anio + '-' + ('0' + r.mes).slice(-2) === k; }), 'materiales');
      return barra(MESES[+k.slice(5) - 1] + ' ' + k.slice(0, 4), v, max, pesos(v));
    }).join('') + '</section>';
    return h;
  }

  function vistaCostos(d) {
    var f = est.filtro;
    var cil = fil(d.cilindros), tan = fil(d.tanque), ene = fil(d.energia), cro = fil(d.cronograma);
    var c = porSede(cil, 'valor'), t = porSede(tan, 'valor'), en = porSede(ene, 'valor'), m = porSede(cro, 'materiales');
    var total = c.total + t.total + en.total + m.total;
    var h = '<section class="rejilla cuatro">' + tarjeta('Total registrado', pesos(total), e(periodo()), 'fuerte') +
      sedesVisibles().map(function (s) { return tarjeta(s, pesos(c[s] + t[s] + en[s] + m[s]), 'Tanque ' + pesos(t[s]) + ' · cilindros ' + pesos(c[s]) + ' · materiales ' + pesos(m[s])); }).join('') +
      tarjeta('Energía de plantas', pesos(en.total), ene.length ? 'La hoja no trae año: se toma ' + d.anioEnergia : 'Sin registros en este periodo') + '</section>';

    // Presupuesto anual por rubro (no se parte por mes).
    var pre = d.presupuesto.filter(function (p) { return f.sede === 'Ambas' || p.sede === f.sede; });
    var rubros = [];
    pre.forEach(function (p) { if (rubros.indexOf(p.sistema) < 0) rubros.push(p.sistema); });
    function ejecutado(rubro, s) {
      var r = rubro.toLowerCase();
      if (r.indexOf('tanque') >= 0) return t[s]; if (r.indexOf('cilindro') >= 0) return c[s];
      if (r.indexOf('energ') >= 0) return en[s]; if (r.indexOf('redes') >= 0) return m[s];
      return null;
    }
    h += '<section class="panel"><h2>Presupuesto anual frente a lo registrado</h2>' + (rubros.length ? tablaSedes(['Rubro', 'Presupuesto', 'Registrado · ' + periodo(), 'Uso'], rubros.map(function (r) {
      var p = D.suma(pre.filter(function (x) { return x.sistema === r; }), 'valor');
      var ej = sedesVisibles().reduce(function (s, x) { var v = ejecutado(r, x); return v == null ? s : (s || 0) + v; }, null);
      var uso = ej == null ? null : pct(ej, p);
      return [e(r), pesos(p), ej == null ? '<span class="tenue">Sin registro todavía</span>' : pesos(ej), uso == null ? '—' : '<b class="' + (uso >= 80 ? 'malo' : '') + '">' + uso + ' %</b>'];
    }), ['Total', pesos(D.suma(pre, 'valor')), pesos(total), '']) +
      '<span class="pie">El presupuesto es anual; compáralo con «Todo el año». En la hoja, la energía figura con un año distinto al de los demás rubros.</span>' : vacio('No pude leer el presupuesto.')) + '</section>';

    var gases = {};
    cil.forEach(function (r) { gases[r.gas] = (gases[r.gas] || 0) + r.valor; });
    var lg = Object.keys(gases).sort(function (a, b) { return gases[b] - gases[a]; });
    var maxG = lg.length ? gases[lg[0]] : 0;
    var firmado = cil.filter(function (r) { return !/pend/i.test(r.estado); });
    h += '<div class="rejilla dos"><section class="panel"><h2>Cilindros por gas</h2>' + (lg.length ? lg.map(function (g) { return barra(g, gases[g], maxG, pesos(gases[g])); }).join('') +
      '<span class="pie">Firmado ' + pesos(D.suma(firmado, 'valor')) + ' · pendiente de firma ' + pesos(c.total - D.suma(firmado, 'valor')) + '</span>' : vacio('Sin remisiones en este periodo.')) + '</section>';
    var ultimas = tan.slice().sort(function (a, b) { return b.fecha - a.fecha; }).slice(0, 8);
    h += '<section class="panel"><h2>Últimas recargas del tanque</h2>' + (ultimas.length ? tablaSedes(['Fecha', 'Sede', 'Remisión', 'm³', 'Valor'], ultimas.map(function (r) {
      return [r.fecha.toLocaleDateString('es-CO'), r.sede, e(r.remision), n1(r.m3), pesos(r.valor) + (r.estimado ? ' <span class="chip nota">estimado</span>' : '')];
    })) : vacio('Sin recargas en este periodo.')) + '</section></div>';
    return h;
  }

  function vistaAccesos() {
    var a = est.accesos, nv = est.nuevo;
    var h = '<section class="panel"><h2>Quién puede entrar</h2>';
    if (!a) h += vacio('Cargando accesos…');
    else h += tablaSedes(['Nombre', 'Usuario', 'Tipo', 'Entra con', ''], a.map(function (u) {
      var con = [].concat(u.tienePin ? ['PIN'] : [], u.huellas.length ? ['huella (' + u.huellas.map(e).join(', ') + ')'] : []);
      return [e(u.nombre), e(u.usuario), e(u.rol), con.join(' y ') || '<span class="tenue">Invitación sin usar</span>',
        u.id === est.sesion.usuario.id ? '<span class="tenue">Tú</span>' : '<button type="button" class="boton peligro mini" data-quitar="' + e(u.id) + '" data-nombre="' + e(u.nombre) + '">Quitar acceso</button>'];
    }));
    h += '</section><section class="panel"><h2>Dar acceso a alguien</h2><p class="pie">Quien reciba acceso puede consultar todo, pero no administra accesos.</p>' +
      '<form id="form-acceso" class="formulario"><label>Nombre completo<input name="nombre" required maxlength="60" autocomplete="off"></label>' +
      '<label>Usuario para entrar<input name="usuario" required pattern="[a-z0-9._\\-]{3,20}" maxlength="20" autocapitalize="none" autocomplete="off" placeholder="por ejemplo: jefatura"></label>' +
      '<fieldset><legend>¿Cómo va a entrar?</legend><label class="opcion"><input type="radio" name="metodo" value="huella" checked> Con la huella de su celular (recibe un código de invitación)</label>' +
      '<label class="opcion"><input type="radio" name="metodo" value="pin"> Con un PIN que tú le das</label></fieldset>' +
      '<label id="campo-pin" hidden>PIN de 6 a 12 números<input name="pin" inputmode="numeric" pattern="\\d{6,12}" maxlength="12" autocomplete="off"></label>' +
      '<button class="boton" type="submit">Crear acceso</button><p class="error" role="alert" id="error-acceso"></p></form>';
    if (nv) h += '<div class="resultado" role="status"><b>Acceso creado para ' + e(nv.usuario.nombre) + '.</b>' + (nv.codigo ? '<span>Código de invitación: <code>' + e(nv.codigo) + '</code> · vale ' + nv.horas + ' horas y se usa una sola vez.</span><span>Esa persona abre la app en su celular, toca «Tengo una invitación», escribe el código y registra su huella.</span>' : '<span>Ya puede entrar con el usuario «' + e(nv.usuario.usuario) + '» y el PIN que definiste.</span>') + '</div>';
    return h + '</section>';
  }

  function vistaCuenta() {
    var c = est.cuenta, u = est.sesion.usuario;
    var h = '<section class="panel"><h2>' + e(u.nombre) + '</h2><p class="pie">Usuario «' + e(u.usuario) + '» · ' + e(u.rol) + (c ? ' · ' + c.huellas + ' huella(s) registrada(s)' : '') + '</p>';
    h += '<h3>Huella del celular</h3>';
    if (!hayHuella()) h += vacio('Este navegador no permite usar huella.');
    else if (ES_CELULAR) h += '<p class="pie">Registra la huella de este teléfono. Después entras con ella aquí y también en el PC, escaneando un código QR.</p><button type="button" class="boton" id="btn-huella">Registrar la huella de este celular</button>';
    else h += '<p class="pie">La huella se registra desde el celular: abre la app en el teléfono, entra con tu PIN y ve a «Mi cuenta». En el PC entras escaneando un código QR con ese mismo teléfono; no se usa la huella ni el PIN de Windows.</p>';
    h += '<p class="error" role="alert" id="error-huella"></p><h3>Cambiar PIN</h3><form id="form-pin" class="formulario"><label>PIN actual<input name="pinActual" type="password" inputmode="numeric" autocomplete="current-password" required></label>' +
      '<label>PIN nuevo (6 a 12 números)<input name="pinNuevo" type="password" inputmode="numeric" pattern="\\d{6,12}" autocomplete="new-password" required></label><button class="boton secundario" type="submit">Cambiar PIN</button><p class="error" role="alert" id="error-pin"></p></form>' +
      '<h3>Sesión</h3><button type="button" class="boton peligro" id="btn-salir">Cerrar sesión en este equipo</button></section>';
    return h;
  }

  function vistaProximas() {
    return '<section class="panel"><h2>Lo que sigue</h2><ul class="alertas">' + [
      ['Fase 2', 'Cronograma de trabajo semana a semana: redes, plantas, inspecciones y correctivos, con registro y evidencia.'],
      ['Fase 3', 'Costos con facturas y órdenes de compra, y resultados de los KPI calculados cada mes.'],
      ['Fase 4', 'Cilindros, tanque, inventario y documentos, conectando las apps que ya existen.']
    ].map(function (x) { return '<li><span class="chip nota">' + x[0] + '</span><span>' + x[1] + '</span></li>'; }).join('') + '</ul></section>';
  }

  /* ───────── pantallas de ingreso ───────── */
  function pantallaIngreso() {
    var i = est.ingreso, cuerpo;
    if (!API) cuerpo = '<form id="form-api" class="formulario"><p class="pie">Pega la dirección de la implementación de Apps Script (termina en /exec).</p><label>Dirección del servidor<input name="api" type="url" required placeholder="https://script.google.com/macros/s/…/exec"></label><button class="boton" type="submit">Guardar</button></form>';
    else if (i.modo === 'instalar') cuerpo = '<form id="form-instalar" class="formulario"><p class="pie">Primera vez: crea tu usuario de administrador.</p><label>Clave de instalación<input name="clave" required autocomplete="off" autocapitalize="characters"></label><label>Tu nombre<input name="nombre" required maxlength="60"></label>' +
      '<label>Usuario para entrar<input name="usuario" required pattern="[a-z0-9._\\-]{3,20}" autocapitalize="none" placeholder="por ejemplo: jorge"></label><label>PIN de 6 a 12 números<input name="pin" type="password" inputmode="numeric" pattern="\\d{6,12}" required autocomplete="new-password"></label><button class="boton" type="submit">Crear administrador</button></form>';
    else if (i.modo === 'invitacion' && !ES_CELULAR) cuerpo = '<p class="pie">La invitación se usa en el celular, porque allí queda registrada la huella. Abre esta misma dirección en tu teléfono.</p><button type="button" class="enlace" data-modo="entrar">Volver</button>';
    else if (i.modo === 'invitacion') cuerpo = '<form id="form-invitacion" class="formulario"><p class="pie">Escribe el código que te dio el administrador. Luego registras la huella de este celular.</p><label>Código de invitación<input name="codigo" required maxlength="8" autocapitalize="characters" autocomplete="off"></label><button class="boton" type="submit">Continuar</button><button type="button" class="enlace" data-modo="entrar">Volver</button></form>';
    else cuerpo = (hayHuella() ? '<button type="button" class="boton" id="btn-entrar-huella">' + (ES_CELULAR ? 'Entrar con huella' : 'Entrar con la huella del celular') + '</button>' + (ES_CELULAR ? '' : '<p class="pie centro">Aparece un código QR: escanéalo con el teléfono donde registraste tu huella.</p>') + '<div class="separador"><span>o con PIN</span></div>' : '') +
      '<form id="form-pin-ingreso" class="formulario"><label>Usuario (el corto que creaste, no tu nombre)<input name="usuario" required autocapitalize="none" autocomplete="username" placeholder="por ejemplo: jorge" value="' + e(ls.get('ultimoUsuario', '')) + '"></label><label>PIN<input name="pin" type="password" inputmode="numeric" required autocomplete="current-password"></label><button class="boton secundario" type="submit">Entrar con PIN</button></form>' +
      '<button type="button" class="enlace" data-modo="invitacion">Tengo una invitación</button>';
    return '<main class="ingreso"><div class="icono-app" aria-hidden="true"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="8" height="13" rx="3"/><path d="M7 8V6h4v2M9 4v2"/><circle cx="17.5" cy="7.5" r="3.5"/><path d="M17.5 7.5l1.4-1.4"/></svg></div>' +
      '<h1>Gases Medicinales</h1><p class="pie centro">Clínica Reina Catalina · Barranquilla y Baranoa</p><div class="panel">' + cuerpo + '<p class="error" role="alert">' + e(i.error) + '</p>' + (i.ocupado ? '<p class="pie centro">Un momento…</p>' : '') + '</div></main>';
  }

  /* ───────── armazón ───────── */
  var VISTAS = [['inicio', 'Inicio'], ['cronograma', 'Cronograma'], ['costos', 'Costos'], ['proximas', 'Lo que sigue'], ['accesos', 'Accesos'], ['cuenta', 'Mi cuenta']];

  function pintar() {
    if (!est.sesion) { $app.innerHTML = pantallaIngreso(); return; }
    var u = est.sesion.usuario, d = est.datos;
    var vistas = VISTAS.filter(function (v) { return v[0] !== 'accesos' || u.rol === 'Administrador'; });
    var conFiltros = ['inicio', 'cronograma', 'costos'].indexOf(est.vista) >= 0;
    var cuerpo;
    if (est.vista === 'accesos') cuerpo = vistaAccesos();
    else if (est.vista === 'cuenta') cuerpo = vistaCuenta();
    else if (est.vista === 'proximas') cuerpo = vistaProximas();
    else if (!d) cuerpo = '<section class="panel">' + vacio(est.cargando ? 'Leyendo las hojas del departamento…' : 'Todavía no hay datos.') + '</section>';
    else cuerpo = { inicio: vistaInicio, cronograma: vistaCronograma, costos: vistaCostos }[est.vista](d);
    var errores = d ? Object.keys(d.errores) : [];
    $app.innerHTML = '<div class="armazon"><nav class="menu" aria-label="Secciones"><div class="marca-app"><b>Gases Medicinales</b><span>Clínica Reina Catalina</span></div>' +
      vistas.map(function (v) { return '<button type="button" data-vista="' + v[0] + '" aria-current="' + (est.vista === v[0] ? 'page' : 'false') + '">' + v[1] + '</button>'; }).join('') +
      '<span class="quien">' + e(u.nombre) + ' · ' + e(u.rol) + '</span></nav><main class="contenido"><header class="cabecera"><div><h1>' + e(vistas.filter(function (v) { return v[0] === est.vista; })[0][1]) + '</h1>' +
      '<p class="pie">' + (d && d.leido ? 'Datos leídos ' + hora(d.leido) : '') + (est.cargando ? ' · actualizando…' : '') + '</p></div>' + (conFiltros ? filtros() : '') + '</header>' +
      (est.aviso ? '<p class="banda" role="status">' + e(est.aviso) + '</p>' : '') +
      (errores.length && conFiltros ? '<p class="banda" role="status">No pude leer: ' + e(errores.join(', ')) + '. Revisa la pestaña Config de la hoja de la app.</p>' : '') + cuerpo + '</main></div>';
  }

  /* ───────── eventos ───────── */
  function ocupado(si, error) { est.ingreso.ocupado = si; est.ingreso.error = error || ''; pintar(); }
  function entrar() { est.ingreso = { modo: 'entrar', error: '', ocupado: false }; est.vista = 'inicio'; pintar(); cargarDatos(); }
  function campos(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = String(v).trim(); }); return o; }

  document.addEventListener('submit', function (ev) {
    var f = ev.target; ev.preventDefault();
    var c = campos(f);
    if (f.id === 'form-api') { API = c.api; ls.set('api', API); iniciar(); }
    else if (f.id === 'form-instalar') { ocupado(true); api('configurar', c).then(guardarSesion).then(entrar).catch(function (err) { ocupado(false, err.message); }); }
    else if (f.id === 'form-pin-ingreso') { ocupado(true); api('ingresoPin', c).then(guardarSesion).then(entrar).catch(function (err) { ocupado(false, err.message); }); }
    else if (f.id === 'form-invitacion') {
      ocupado(true);
      api('canjearInvitacion', c).then(guardarSesion).then(registrarHuella).then(entrar)
        .catch(function (err) { if (est.sesion) { est.vista = 'cuenta'; est.ingreso.ocupado = false; pintar(); cargarDatos(true); abrirCuenta(mensajeHuella(err)); } else ocupado(false, mensajeHuella(err)); });
    }
    else if (f.id === 'form-acceso') {
      api('crearAcceso', c).then(function (r) { est.nuevo = r; return cargarAccesos(); }).catch(function (err) { document.getElementById('error-acceso').textContent = err.message; });
    }
    else if (f.id === 'form-pin') {
      api('cambiarPin', c).then(function () { f.reset(); document.getElementById('error-pin').textContent = 'PIN cambiado.'; }).catch(function (err) { document.getElementById('error-pin').textContent = err.message; });
    }
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.vista) { est.vista = b.dataset.vista; est.nuevo = null; pintar(); if (est.vista === 'accesos') cargarAccesos(); if (est.vista === 'cuenta') abrirCuenta(); window.scrollTo(0, 0); }
    else if (b.dataset.sede) { est.filtro.sede = b.dataset.sede; ls.set('filtro', est.filtro); pintar(); }
    else if (b.dataset.modo) { est.ingreso = { modo: b.dataset.modo, error: '', ocupado: false }; pintar(); }
    else if (b.id === 'btn-entrar-huella') { ocupado(true); entrarConHuella().then(entrar).catch(function (err) { ocupado(false, mensajeHuella(err)); }); }
    else if (b.id === 'btn-huella') { registrarHuella().then(function () { abrirCuenta('Huella registrada. Ya puedes entrar con ella.'); }).catch(function (err) { document.getElementById('error-huella').textContent = mensajeHuella(err); }); }
    else if (b.id === 'btn-salir') { api('salir').catch(function () {}).then(function () { cerrarLocal(); pintar(); }); }
    else if (b.dataset.quitar && window.confirm('¿Quitar el acceso de ' + b.dataset.nombre + '? No podrá volver a entrar.')) {
      api('quitarAcceso', { id: b.dataset.quitar }).then(cargarAccesos).catch(function (err) { window.alert(err.message); });
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'f-mes') { est.filtro.mes = +t.value; ls.set('filtro', est.filtro); pintar(); }
    else if (t.id === 'f-anio') { est.filtro.anio = +t.value; ls.set('filtro', est.filtro); pintar(); }
    else if (t.name === 'metodo') { var campo = document.getElementById('campo-pin'); campo.hidden = t.value !== 'pin'; campo.querySelector('input').required = t.value === 'pin'; }
  });

  function cargarAccesos() { return api('accesos').then(function (r) { est.accesos = r.accesos; pintar(); }); }
  function abrirCuenta(mensaje) {
    return api('yo').then(function (r) { est.cuenta = r; pintar(); if (mensaje) document.getElementById('error-huella').textContent = mensaje; }).catch(function () {});
  }

  function iniciar() {
    pintar();
    if (!API) return;
    if (est.sesion) { cargarDatos(); return; }
    api('estado').then(function (r) { if (!r.configurado) { est.ingreso.modo = 'instalar'; pintar(); } }).catch(function (err) { est.ingreso.error = navigator.onLine ? err.message : 'Sin conexión.'; pintar(); });
  }

  window.addEventListener('online', function () { if (est.sesion) cargarDatos(true); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  iniciar();
})();
