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
    var corte = window.AbortController ? new AbortController() : null, reloj = corte && setTimeout(function () { corte.abort(); }, 150000);
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo), signal: corte ? corte.signal : undefined })
      .catch(function (err) { throw new Error(err && err.name === 'AbortError' ? 'El servidor tardó más de dos minutos. Vuelve a intentarlo.' : navigator.onLine ? 'No se pudo conectar con el servidor.' : 'Sin conexión.'); })
      .then(function (r) { clearTimeout(reloj); if (!r.ok) throw new Error('El servidor respondió ' + r.status); return r.json(); })
      .then(function (r) {
        if (r && r.sesion === false) { cerrarLocal(); pintar(); }
        if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo completar.');
        return r;
      });
  }

  function guardarSesion(r) {
    ultimaActividad = Date.now(); ls.set('actividad', ultimaActividad);
    est.sesion = { token: r.token, vence: r.vence, usuario: r.usuario };
    ls.set('sesion', est.sesion); ls.set('ultimoUsuario', r.usuario.usuario);
  }
  function cerrarLocal() { est.sesion = null; est.datos = null; est.crono = null; ls.del('sesion'); ls.del('paquete'); est.vista = 'inicio'; }

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

  /* ───────── Cronograma: semana y mes (fase 2, solo consulta) ───────── */
  var DIAS_C = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var PESTANAS = [['Todo', null], ['Redes', 'Redes'], ['Plantas', 'Plantas'], ['Inspecciones', 'Inspección'], ['Correctivos', 'Correctivo']];
  var TONO = { Hecho: 'hecho', Vencido: 'vencido', Pendiente: 'pendiente', Reprogramado: 'reprog' };
  function medio(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); }
  function masDias(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12); }
  function claveMes(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function inicioSemana(d) { return masDias(d, -d.getDay()); }   // domingo, igual que las hojas
  function mismoDia(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function cr() {
    if (!est.crono) est.crono = { vista: ls.get('cronoVista', 'semana'), ref: medio(new Date()), pestana: 'Todo', sel: null, dia: new Date().getDay(), meses: {}, errores: {}, pendientes: 0, aviso: '' };
    return est.crono;
  }
  function mesesNecesarios() {
    var c = cr();
    if (c.vista === 'mes') return [claveMes(c.ref)];
    var ini = inicioSemana(c.ref), a = claveMes(ini), b = claveMes(masDias(ini, 6));
    return a === b ? [a] : [a, b];
  }
  function cargarCrono(forzar) {
    var c = cr();
    mesesNecesarios().forEach(function (k) {
      if (c.meses[k] && !forzar) return;
      if (c.meses[k] === undefined) c.meses[k] = null;
      c.pendientes++;
      api('cronograma', { mes: k }).then(function (r) { c.meses[k] = D.tareasCrono(r); c.errores[k] = Object.keys(r.errores || {}); c.aviso = ''; })
        .catch(function (err) { c.aviso = navigator.onLine ? err.message : 'Sin conexión: el cronograma detallado necesita internet.'; if (!c.meses[k]) delete c.meses[k]; })
        .then(function () { c.pendientes--; if (est.vista === 'cronograma') pintar(); });
    });
  }
  function tareasCargadas() {
    var c = cr(), vistas = {}, lista = [];
    mesesNecesarios().forEach(function (k) { (c.meses[k] || []).forEach(function (t) { if (!vistas[t.id]) { vistas[t.id] = 1; lista.push(t); } }); });
    return lista.filter(function (t) { return est.filtro.sede === 'Ambas' || t.sede === est.filtro.sede; });
  }
  function dePestana(l) {
    var tipo = PESTANAS.filter(function (p) { return p[0] === cr().pestana; })[0][1];
    return tipo ? l.filter(function (t) { return t.tipo === tipo; }) : l;
  }
  function chipTipo(t) { return '<span class="chip tipo-' + t.tipo.slice(0, 3).toLowerCase() + '">' + e(t.tipo === 'Inspección' ? 'Ronda' : t.tipo) + '</span>'; }
  function chipEstado(t) { return '<span class="chip est-' + TONO[t.estado] + '">' + e(t.estado) + '</span>'; }
  function botonTarea(t) {
    return '<button type="button" class="tarea' + (cr().sel === t.id ? ' elegida' : '') + '" data-tarea="' + e(t.id) + '" aria-expanded="' + (cr().sel === t.id) + '">' +
      '<span class="chips">' + chipTipo(t) + chipEstado(t) + (est.filtro.sede === 'Ambas' ? '<span class="chip nota">' + e(t.sede) + '</span>' : '') + '</span>' +
      '<b>' + e(t.titulo) + '</b><span class="pie">' + e(t.sub) + '</span></button>';
  }
  function filtrosCrono() {
    var c = cr(), ini = inicioSemana(c.ref), fin = masDias(ini, 6), f = est.filtro;
    var rotulo = c.vista === 'mes' ? MESES[c.ref.getMonth()] + ' ' + c.ref.getFullYear()
      : ini.getDate() + (ini.getMonth() !== fin.getMonth() ? ' de ' + MESES[ini.getMonth()].slice(0, 3).toLowerCase() : '') + ' al ' + fin.getDate() + ' de ' + MESES[fin.getMonth()].slice(0, 3).toLowerCase() + ' ' + fin.getFullYear();
    return '<div class="filtros"><div class="segmento" role="group" aria-label="Sede">' +
      ['Ambas'].concat(D.SEDES).map(function (s) { return '<button type="button" data-sede="' + s + '" aria-pressed="' + (f.sede === s) + '">' + (s === 'Ambas' ? 'Ambas sedes' : s) + '</button>'; }).join('') + '</div>' +
      '<div class="segmento" role="group" aria-label="Vista"><button type="button" data-cvista="semana" aria-pressed="' + (c.vista === 'semana') + '">Semana</button><button type="button" data-cvista="mes" aria-pressed="' + (c.vista === 'mes') + '">Mes</button></div>' +
      '<div class="segmento paso" role="group" aria-label="Periodo"><button type="button" data-cnav="-1" aria-label="' + (c.vista === 'mes' ? 'Mes anterior' : 'Semana anterior') + '">‹</button><span aria-live="polite">' + e(rotulo) + '</span>' +
      '<button type="button" data-cnav="1" aria-label="' + (c.vista === 'mes' ? 'Mes siguiente' : 'Semana siguiente') + '">›</button><button type="button" data-cnav="0">Hoy</button></div></div>';
  }
  function pestanasCrono() {
    return '<div class="pestanas" role="group" aria-label="Tipo de trabajo">' + PESTANAS.map(function (p) {
      return '<button type="button" data-ctab="' + p[0] + '" aria-pressed="' + (cr().pestana === p[0]) + '">' + p[0] + '</button>'; }).join('') + '</div>';
  }
  function panelDetalle(todas) {
    var t = todas.filter(function (x) { return x.id === cr().sel; })[0];
    if (!t) return '';
    return '<button type="button" class="velo" data-cerrar="1" aria-label="Cerrar detalle" tabindex="-1"></button><section class="panel detalle" id="detalle-tarea" role="dialog" aria-modal="false" aria-labelledby="detalle-titulo">' +
      '<div class="detalle-cab"><span class="chips">' + chipTipo(t) + chipEstado(t) + '<span class="chip nota">' + e(t.sede) + '</span></span><button type="button" class="boton secundario mini" data-cerrar="1">Cerrar</button></div>' +
      '<h2 id="detalle-titulo" tabindex="-1">' + e(t.actividad || t.titulo) + '</h2><p class="pie">' + e(t.titulo) + '</p>' +
      '<dl class="datos">' + t.detalle.map(function (p) { return '<div><dt>' + e(p[0]) + '</dt><dd>' + e(p[1]) + '</dd></div>'; }).join('') + '</dl>' +
      (t.pasos.length ? '<h3>Paso a paso para el técnico</h3><ol class="pasos">' + t.pasos.map(function (p) { return '<li>' + e(p) + '</li>'; }).join('') + '</ol>' : '') +
      '<p class="pie">Solo consulta. Lo hecho se marca en la hoja «Cronograma ' + e(t.sede) + '», pestaña «' + e(t.hoja) + '».</p></section>';
  }
  function filaRonda(t) {
    return '<button type="button" class="fila-ronda' + (cr().sel === t.id ? ' elegida' : '') + '" data-tarea="' + e(t.id) + '"><span><b>' + e(t.titulo) + '</b>' + (est.filtro.sede === 'Ambas' ? ' <span class="chip nota">' + e(t.sede) + '</span>' : '') +
      '<br><span class="pie">' + e(t.sub) + '</span></span><span class="der">' + chipEstado(t) + '<br><b>' + t.diasHechos + ' de ' + t.diasProg + ' días</b></span></button>';
  }
  function vistaSemana(todas) {
    var c = cr(), ini = inicioSemana(c.ref), fin = masDias(ini, 6), hoyD = medio(new Date());
    var enSemana = todas.filter(function (t) {
      var f = t.tipo === 'Inspección' ? t.desde : t.fecha;
      return !!f && f >= ini && f <= fin;
    });
    var l = dePestana(enSemana), conFecha = l.filter(function (t) { return t.tipo !== 'Inspección'; }), rondas = l.filter(function (t) { return t.tipo === 'Inspección'; });
    var hechos = l.filter(function (t) { return t.estado === 'Hecho'; }).length, vencidos = l.filter(function (t) { return t.estado === 'Vencido'; }).length;
    function cuenta(tipo) { return l.filter(function (t) { return t.tipo === tipo; }).length; }
    var h = '<div class="rejilla cuatro">' +
      tarjeta('Programado esta semana', l.length, cuenta('Redes') + ' de redes · ' + cuenta('Plantas') + ' de plantas · ' + cuenta('Inspección') + (cuenta('Inspección') === 1 ? ' ronda' : ' rondas') + (cuenta('Correctivo') ? ' · ' + cuenta('Correctivo') + (cuenta('Correctivo') === 1 ? ' ticket' : ' tickets') : '')) +
      tarjeta('Hecho', hechos + ' de ' + l.length, 'Según el estado de cada hoja') +
      tarjeta('Vencido', vencidos, vencidos ? 'Con fecha pasada y sin marcar' : 'Nada atrasado', vencidos ? 'alerta' : '') +
      tarjeta('Horas de trabajo', n1(D.suma(l, 'horas')) + ' h', 'Programadas en la semana') + '</div>';
    if (c.pestana !== 'Inspecciones') {
      h += '<section class="panel"><h2>Trabajos con fecha</h2><div class="dias-cel" role="group" aria-label="Día">';
      for (var i = 0; i < 7; i++) { var dd = masDias(ini, i), nn = conFecha.filter(function (t) { return mismoDia(t.fecha, dd); }).length;
        h += '<button type="button" data-cdia="' + i + '" aria-pressed="' + (c.dia === i) + '"><span>' + DIAS_C[i] + '</span><b>' + dd.getDate() + '</b>' + (nn ? '<i>' + nn + '</i>' : '') + '</button>'; }
      h += '</div><div class="semana">';
      for (i = 0; i < 7; i++) { var d = masDias(ini, i), delDia = conFecha.filter(function (t) { return mismoDia(t.fecha, d); });
        h += '<div class="dia' + (c.dia === i ? ' activo' : '') + '"><span class="dia-cab' + (mismoDia(d, hoyD) ? ' hoy' : '') + '">' + DIAS_C[i] + ' ' + d.getDate() + (mismoDia(d, hoyD) ? ' · hoy' : '') + '</span>' +
          (delDia.length ? delDia.map(botonTarea).join('') : '<span class="pie sin">Sin trabajos con fecha</span>') + '</div>'; }
      h += '</div></section>';
    }
    var det = panelDetalle(todas);
    h += '<div class="rejilla ' + (det ? 'dos' : '') + '">';
    if (c.pestana === 'Todo' || c.pestana === 'Inspecciones') h += '<section class="panel"><h2>Inspecciones y rondas de la semana</h2>' + (rondas.length ? rondas.map(filaRonda).join('') : vacio('Sin rondas programadas esta semana.')) +
      '<p class="pie">Días realizados frente a programados. Toca una fila para ver su paso a paso.</p></section>';
    else h += '<span></span>';
    h += det + '</div>';
    return h;
  }
  function vistaMes(todas, d) {
    var c = cr(), anio = c.ref.getFullYear(), mes = c.ref.getMonth() + 1, k = claveMes(c.ref);
    var res = d ? d.cronograma.filter(function (r) { return r.anio === anio && r.mes === mes && (est.filtro.sede === 'Ambas' || r.sede === est.filtro.sede); }) : [];
    var delMes = dePestana(todas);
    var cumpl = res.length === 1 && res[0].cumplimiento != null ? Math.round(res[0].cumplimiento) + ' %' : '—';
    function hp(tipo) { var l = todas.filter(function (t) { return t.tipo === tipo; }); return l.filter(function (t) { return t.estado === 'Hecho'; }).length + ' de ' + l.length; }
    var h = '<div class="rejilla cuatro">' + tarjeta('Cumplimiento del mes', cumpl, res.length === 1 ? 'Meta ≥ 95 % · según la hoja' : 'Elige una sede para verlo') +
      tarjeta('Redes', hp('Redes'), 'Cuartos y cubículos hechos') + tarjeta('Plantas', hp('Plantas'), 'Mantenimientos hechos') +
      tarjeta('Materiales del mes', pesos(D.suma(res, 'materiales')), 'Preventivo y correctivos') + '</div>';
    var semanas = {}; delMes.forEach(function (t) { if (t.semana) semanas[t.semana] = 1; });
    var cols = Object.keys(semanas).map(Number).sort(function (a, b) { return a - b; });
    var frentes = [], vistos = {};
    delMes.forEach(function (t) { var f = (est.filtro.sede === 'Ambas' ? t.sede + ' · ' : '') + t.frente; t._f = f; if (!vistos[f]) { vistos[f] = 1; frentes.push(f); } });
    var orden = { Red: 0, Pla: 1, Ins: 2, Cor: 3 };
    frentes.sort(function (a, b) { var ta = delMes.filter(function (t) { return t._f === a; })[0], tb = delMes.filter(function (t) { return t._f === b; })[0];
      return (ta.sede < tb.sede ? -1 : ta.sede > tb.sede ? 1 : 0) || orden[ta.tipo.slice(0, 3)] - orden[tb.tipo.slice(0, 3)] || (a < b ? -1 : 1); });
    function celda(l) {
      if (!l.length) return '<span class="tenue">—</span>';
      var insp = l[0].tipo === 'Inspección', prog = insp ? D.suma(l, 'diasProg') : l.length, hech = insp ? D.suma(l, 'diasHechos') : l.filter(function (t) { return t.estado === 'Hecho'; }).length;
      var mal = l.some(function (t) { return t.estado === 'Vencido'; }), okk = prog > 0 && hech >= prog;
      return '<span class="celda ' + (okk ? 'ok' : mal ? 'mal' : '') + '">' + hech + ' de ' + prog + '</span>';
    }
    h += '<section class="panel"><h2>Hecho frente a programado, por semana</h2>';
    if (!delMes.length) h += vacio(c.meses[k] ? 'El cronograma no tiene trabajos en ' + MESES[mes - 1].toLowerCase() + ' de ' + anio + '. Empieza en noviembre de 2026.' : 'Leyendo el cronograma…');
    else h += '<div class="tabla-caja"><table><thead><tr><th scope="col">Frente de trabajo</th>' + cols.map(function (s) { return '<th scope="col" class="centro"><button type="button" class="enlace" data-csem="' + s + '">Sem. ' + s + '</button></th>'; }).join('') + '<th scope="col" class="der">Mes</th></tr></thead><tbody>' +
      frentes.map(function (f) { var l = delMes.filter(function (t) { return t._f === f; });
        return '<tr><th scope="row">' + e(f) + '</th>' + cols.map(function (s) { return '<td class="centro">' + celda(l.filter(function (t) { return t.semana === s; })) + '</td>'; }).join('') + '<td class="der">' + celda(l) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="pie">Verde: completo. Rojo: con trabajos vencidos. Las rondas se cuentan en días. Toca «Sem.» para abrir esa semana.</p>';
    h += '</section>';
    var venc = delMes.filter(function (t) { return t.estado === 'Vencido'; }).sort(function (a, b) { return (a.fecha || a.desde) - (b.fecha || b.desde); });
    var det = panelDetalle(todas);
    h += '<div class="rejilla ' + (det ? 'dos' : '') + '"><section class="panel"><h2>Vencidos del mes</h2>' + (venc.length ? '<div class="lista-tareas">' + venc.map(function (t) {
      var f = t.fecha || t.desde; return '<div class="con-fecha"><span class="pie">' + (f ? DIAS_C[f.getDay()] + ' ' + f.getDate() : '') + '</span>' + botonTarea(t) + '</div>'; }).join('') + '</div>' : vacio('Nada vencido en este mes.')) + '</section>' + det + '</div>';
    return h;
  }
  function vistaCronograma(d) {
    var c = cr(), cargando = mesesNecesarios().some(function (k) { return !c.meses[k]; });
    var err = {}; mesesNecesarios().forEach(function (k) { (c.errores[k] || []).forEach(function (x) { err[x] = 1; }); });
    var h = pestanasCrono();
    if (c.aviso) h += '<p class="banda" role="status">' + e(c.aviso) + '</p>';
    if (Object.keys(err).length) h += '<p class="banda" role="status">No pude leer: ' + e(Object.keys(err).join(', ')) + '.</p>';
    if (cargando && c.pendientes) h += '<section class="panel">' + vacio('Leyendo el cronograma de las dos sedes…') + '</section>';
    else h += c.vista === 'mes' ? vistaMes(tareasCargadas(), d) : vistaSemana(tareasCargadas());
    return h;
  }
  function abrirTarea(id) {
    var c = cr(); c.sel = c.sel === id ? null : id; pintar();
    var p = document.getElementById('detalle-titulo');
    if (p) { p.focus({ preventScroll: true }); if (window.innerWidth >= 1024) document.getElementById('detalle-tarea').scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  }
  function cerrarTarea() { var c = cr(), id = c.sel; if (!id) return; c.sel = null; pintar(); var b = document.querySelector('[data-tarea="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (b) b.focus(); }
  function eventosCrono(b) {
    var c = cr(), d = b.dataset;
    if (d.cvista) { c.vista = d.cvista; ls.set('cronoVista', c.vista); c.sel = null; }
    else if (d.cnav !== undefined) { var n = +d.cnav; c.sel = null;
      if (!n) { c.ref = medio(new Date()); c.dia = c.ref.getDay(); }
      else if (c.vista === 'mes') c.ref = new Date(c.ref.getFullYear(), c.ref.getMonth() + n, 1, 12);
      else c.ref = masDias(c.ref, 7 * n); }
    else if (d.ctab) { c.pestana = d.ctab; c.sel = null; }
    else if (d.cdia !== undefined) c.dia = +d.cdia;
    else if (d.csem) { var t = tareasCargadas().filter(function (x) { return x.semana === +d.csem && (x.fecha || x.desde) && claveMes(x.fecha || x.desde) === claveMes(c.ref); })[0];
      if (t) { c.ref = medio(t.fecha || t.desde); c.dia = c.ref.getDay(); } c.vista = 'semana'; c.sel = null; }
    else if (d.tarea) { abrirTarea(d.tarea); return true; }
    else if (d.cerrar) { cerrarTarea(); return true; }
    else return false;
    pintar(); cargarCrono(); return true;
  }

  /* ───────── Costos y facturas (fase 3, solo consulta) ───────── */
  var MES3 = MESES.map(function (m) { return m.slice(0, 3); });
  function nombreRubro(r) {
    var x = r.toLowerCase();
    return x.indexOf('tanque') >= 0 ? 'Tanque criogénico' : x.indexOf('energ') >= 0 ? 'Energía de las plantas' : x.indexOf('redes') >= 0 ? 'Mantenimiento de redes' : x.indexOf('prueba') >= 0 ? 'Pruebas hidrostáticas' : r;
  }
  function sedeOk(r) { return est.filtro.sede === 'Ambas' || r.sede === est.filtro.sede; }
  function anioCostos() { return est.filtro.anio || hoy.getFullYear(); }
  /** Ejecutado por rubro para un filtro de mes (0 = todo el año). Devuelve { lista, valor } o null si el rubro no tiene fuente. */
  function fuenteRubro(d, rubro) {
    var r = rubro.toLowerCase();
    if (r.indexOf('tanque') >= 0) return { l: d.tanque, campo: 'valor' };
    if (r.indexOf('cilindro') >= 0) return { l: d.cilindros, campo: 'valor' };
    if (r.indexOf('energ') >= 0) return { l: d.energia, campo: 'valor' };
    if (r.indexOf('redes') >= 0) return { l: d.cronograma, campo: 'materiales', hastaHoy: true };
    return null;
  }
  function delPeriodo(l, anio, mes, hastaHoy) {
    return l.filter(function (r) {
      if (!sedeOk(r) || r.anio !== anio || (mes && r.mes !== mes)) return false;
      return !hastaHoy || r.anio < hoy.getFullYear() || (r.anio === hoy.getFullYear() && r.mes <= hoy.getMonth() + 1);
    });
  }
  function cobertura(l, campo) {
    var con = l.filter(function (r) { return r[campo]; });
    if (!con.length) return 'Aún no hay costo cargado';
    var ms = con.map(function (r) { return r.mes; }), a = Math.min.apply(null, ms), b = Math.max.apply(null, ms), sedes = {};
    con.forEach(function (r) { sedes[r.sede] = 1; });
    var falta = sedesVisibles().filter(function (s) { return !sedes[s]; });
    return (falta.length && sedesVisibles().length > 1 ? 'Solo ' + Object.keys(sedes).join(' y ') + ' · ' : '') + (a === b ? MESES[a - 1].toLowerCase() : MES3[a - 1].toLowerCase() + '–' + MES3[b - 1].toLowerCase());
  }
  function totalMes(d, anio, mes) {
    var t = 0;
    ['tanque', 'cilindro', 'energ', 'redes'].forEach(function (k) { var f = fuenteRubro(d, k); t += D.suma(delPeriodo(f.l, anio, mes, f.hastaHoy), f.campo); });
    return t;
  }
  function documentos(d, anio, mes) {
    var l = [];
    delPeriodo(d.cilindros, anio, mes).forEach(function (r) {
      var pend = /pend/i.test(r.estado);
      l.push({ tipo: 'Remisión', num: r.remision || 'sin número', concepto: 'Cilindros · ' + r.gas + ' · ' + r.sede, fecha: r.fecha, mes: r.mes, valor: r.valor, estado: pend ? 'Por firmar' : 'Firmado', clase: pend ? 'firmar' : 'ok', grupo: 'Cilindros' });
    });
    delPeriodo(d.tanque, anio, mes).forEach(function (r) {
      l.push({ tipo: r.factura ? 'Factura' : 'Remisión', num: r.factura || r.remision || 'sin número', concepto: 'Tanque · ' + r.sede + (r.factura && r.remision ? ' · remisión ' + r.remision : ''), fecha: r.fecha, mes: r.mes, valor: r.valor,
        estado: r.estimado ? 'Sin factura (estimado)' : 'Facturado', clase: r.estimado ? 'sinfac' : 'ok', grupo: 'Tanque' });
    });
    return l.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0) || b.mes - a.mes; });
  }
  function vistaCostos(d) {
    var f = est.filtro, anio = anioCostos(), mes = f.mes;
    var mesesMeta = mes ? 1 : (anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12), frac = mesesMeta / 12;
    var pre = d.presupuesto.filter(sedeOk), rubros = [];
    pre.forEach(function (p) { if (rubros.indexOf(p.sistema) < 0) rubros.push(p.sistema); });
    var presTotal = D.suma(pre, 'valor'), ejecTotal = totalMes(d, anio, mes);
    var docs = documentos(d, anio, mes), pend = docs.filter(function (x) { return x.clase !== 'ok'; });
    var h = '<div class="rejilla cuatro">' + tarjeta(mes ? 'Ejecutado en ' + MESES[mes - 1].toLowerCase() : 'Ejecutado del año', pesos(ejecTotal), 'Con lo cargado hasta hoy · ' + anio) +
      tarjeta('Presupuesto anual', pesos(presTotal), (mes ? 'Doceava parte: ' : 'Meta a ' + MESES[mesesMeta - 1].toLowerCase() + ': ') + pesos(presTotal * frac)) +
      tarjeta('Ejecución', presTotal ? n1(ejecTotal / (mes ? presTotal / 12 : presTotal) * 100) + ' %' : '—', mes ? 'De la doceava parte del mes' : 'Del presupuesto anual · la meta a la fecha es ' + n1(frac * 100) + ' %') +
      tarjeta('Por firmar o facturar', pend.length, pend.length ? pesos(D.suma(pend, 'valor')) + ' en remisiones' : 'Todo al día', pend.length ? 'alerta' : '') + '</div>';

    h += '<section class="panel"><h2>Presupuesto frente a ejecutado, por rubro</h2>';
    if (!rubros.length) h += vacio('No pude leer el presupuesto.');
    else {
      h += '<div class="tabla-caja"><table class="apilar rubros"><thead><tr><th scope="col">Rubro</th><th scope="col" class="der">Presupuesto anual</th><th scope="col" class="der">' + (mes ? 'Doceava parte' : 'Meta a la fecha (' + mesesMeta + ' de 12)') + '</th><th scope="col" class="der">Ejecutado</th><th scope="col" class="der">Avance</th></tr></thead><tbody>' +
        rubros.map(function (r) {
          var p = D.suma(pre.filter(function (x) { return x.sistema === r; }), 'valor'), fu = fuenteRubro(d, r);
          var l = fu ? delPeriodo(fu.l, anio, mes, fu.hastaHoy) : [], ej = fu ? D.suma(l, fu.campo) : 0, base = mes ? p / 12 : p, av = base ? ej / base * 100 : 0;
          return '<tr><th scope="row">' + e(nombreRubro(r)) + '<br><span class="pie">' + e(fu ? cobertura(l, fu.campo) : 'Aún no hay costo cargado') + '</span></th><td class="der">' + pesos(p) + '</td><td class="der">' + pesos(p * frac) + '</td><td class="der"><b>' + (fu ? pesos(ej) : '<span class="tenue">Sin datos</span>') + '</b></td>' +
            '<td class="der"><span class="avance"><span class="barra-fondo"><span class="barra-relleno' + (av > 100 ? ' rojo' : '') + '" style="width:' + Math.min(100, av).toFixed(1) + '%"></span>' + (mes ? '' : '<span class="raya" style="left:' + (frac * 100).toFixed(1) + '%"></span>') + '</span><span class="num">' + n1(av) + ' %</span></span></td></tr>';
        }).join('') + '<tr class="total"><th scope="row">Total</th><td class="der">' + pesos(presTotal) + '</td><td class="der">' + pesos(presTotal * frac) + '</td><td class="der">' + pesos(ejecTotal) + '</td><td class="der">' + (presTotal ? n1(ejecTotal / (mes ? presTotal / 12 : presTotal) * 100) + ' %' : '—') + '</td></tr></tbody></table></div>' +
        '<p class="pie">' + (mes ? '' : 'La raya negra marca la meta a la fecha (doceavas partes). ') + 'Debajo de cada rubro se indica qué periodo tiene datos cargados, para no confundir «gasté poco» con «falta cargar». En la hoja el presupuesto figura con años distintos por rubro; aquí se compara con el gasto de ' + anio + '.</p>';
    }
    h += '</section>';

    var porMes = [], doceava = presTotal / 12, tope = doceava;
    for (var i = 1; i <= 12; i++) { porMes.push(totalMes(d, anio, i)); tope = Math.max(tope, porMes[i - 1]); }
    h += '<section class="panel"><h2>Ejecutado mes a mes frente a la doceava parte · ' + anio + '</h2><div class="meses-caja"><div class="meses">' + porMes.map(function (v, i) {
      return '<button type="button" data-mes="' + (mes === i + 1 ? 0 : i + 1) + '" aria-pressed="' + (mes === i + 1) + '" aria-label="' + MESES[i] + ': ' + pesos(v) + '"><span class="pie">' + (v ? (v / 1e6).toFixed(v < 1e7 ? 1 : 0).replace('.', ',') + ' M' : '') + '</span><i style="height:' + (tope ? v / tope * 100 : 0).toFixed(1) + '%"></i><em>' + MES3[i] + '</em></button>'; }).join('') + '</div>' +
      (doceava ? '<span class="linea-meta" style="bottom:calc(22px + (100% - 44px) * ' + (doceava / tope).toFixed(4) + ')"><b>Doceava parte: ' + pesos(doceava) + '</b></span>' : '') + '</div>' +
      '<p class="pie">Toca un mes para ver solo ese mes; tócalo otra vez para volver a todo el año.</p></section>';

    var fd = (est.docs = est.docs || { filtro: 'Todos' }).filtro;
    var grupos = [['Todos', docs.length], ['Por firmar', docs.filter(function (x) { return x.clase === 'firmar'; }).length], ['Sin factura', docs.filter(function (x) { return x.clase === 'sinfac'; }).length], ['Tanque', null], ['Cilindros', null]];
    var vis = docs.filter(function (x) { return fd === 'Todos' || (fd === 'Por firmar' && x.clase === 'firmar') || (fd === 'Sin factura' && x.clase === 'sinfac') || x.grupo === fd; });
    h += '<section class="panel"><h2>Facturas y remisiones · ' + e(mes ? MESES[mes - 1] + ' ' + anio : String(anio)) + '</h2><div class="pastillas" role="group" aria-label="Filtrar documentos">' + grupos.map(function (g) {
      return '<button type="button" data-docs="' + g[0] + '" aria-pressed="' + (fd === g[0]) + '">' + g[0] + (g[1] != null ? ' · ' + g[1] : '') + '</button>'; }).join('') +
      '<label class="campo-mini buscar"><span class="oculto">Buscar por número</span><input type="search" id="buscar-doc" placeholder="Buscar número" inputmode="search" autocomplete="off"></label></div>';
    h += vis.length ? '<div class="tabla-caja"><table id="tabla-docs" class="apilar docs"><thead><tr><th scope="col">Documento</th><th scope="col">Concepto</th><th scope="col" class="der">Fecha</th><th scope="col" class="der">Valor</th><th scope="col" class="der">Estado</th></tr></thead><tbody>' + vis.map(function (x) {
      return '<tr data-num="' + e(String(x.num).toLowerCase()) + '"><th scope="row"><span class="chip nota">' + x.tipo + '</span> ' + e(x.num) + '</th><td>' + e(x.concepto) + '</td><td class="der">' + (x.fecha ? x.fecha.getDate() + ' ' + MES3[x.fecha.getMonth()].toLowerCase() + ' ' + x.fecha.getFullYear() : MES3[x.mes - 1] + ' ' + anio) + '</td><td class="der">' + pesos(x.valor) + '</td><td class="der"><span class="chip ' + (x.clase === 'ok' ? 'est-hecho' : 'est-reprog') + '">' + x.estado + '</span></td></tr>'; }).join('') +
      '</tbody></table></div><p class="pie">' + vis.length + ' documentos, del más reciente al más antiguo. Salen de «Cilindros ejecutados», «Recargas» y «Tanque criogenico».</p>' : vacio('Sin documentos con ese filtro en este periodo.');
    return h + '</section>';
  }

  /* ───────── Indicadores (KPI) ───────── */
  function normal(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function metaDe(k) {
    var m = String(k.meta).replace(/>=/g, '≥').replace(/<=/g, '≤').match(/(≥|≤|<|>)\s*([\d.,]+)/);
    return { op: m ? m[1] : '', n: m ? D.num(m[2]) : null, unidad: /%/.test(k.meta) ? ' %' : /min/i.test(k.meta) ? ' min' : '', anual: /año|anual/i.test(k.meta + ' ' + k.frecuencia) };
  }
  function cumple(v, m) { if (v == null || m.n == null) return null; return m.op === '≥' ? v >= m.n : m.op === '≤' ? v <= m.n : m.op === '<' ? v < m.n : m.op === '>' ? v > m.n : null; }
  function promedio(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : null; }
  function resultadoKpi(d, k, anio, mes) {
    var ind = normal(k.indicador), m = metaDe(k), porMes = [], nota = '', fuente, valor = null, seguimiento = false, i;
    var esRutinas = /rutina|preventiv/.test(ind), esPresupuesto = /presupuest|costo/.test(ind);
    if (esRutinas) {
      fuente = 'Calculado del cronograma';
      for (i = 1; i <= 12; i++) porMes.push(promedio(delPeriodo(d.cronograma, anio, i, true).filter(function (r) { return r.cumplimiento != null; }).map(function (r) { return r.cumplimiento; })));
      var filas = delPeriodo(d.cronograma, anio, mes, true).filter(function (r) { return r.cumplimiento != null; });
      valor = promedio(filas.map(function (r) { return r.cumplimiento; }));
      nota = sedesVisibles().map(function (s) { var p = promedio(filas.filter(function (r) { return r.sede === s; }).map(function (r) { return r.cumplimiento; })); return p == null ? null : s + ' ' + n1(p) + ' %'; }).filter(Boolean).join(' · ');
      m.unidad = ' %';
    } else if (esPresupuesto) {
      fuente = 'Calculado de costos'; seguimiento = true;
      var pres = D.suma(d.presupuesto.filter(sedeOk), 'valor'), ej = totalMes(d, anio, 0), ms = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;
      valor = pres ? ej / pres * 100 : null; m.unidad = ' % ejecutado';
      nota = 'Meta a la fecha: ' + n1(ms / 12 * 100) + ' %. Falta definir contra qué se mide la reducción.';
      for (i = 1; i <= 12; i++) porMes.push(null);
    } else {
      fuente = 'Escrito en la hoja';
      var mias = d.kpiRes.filter(function (r) { var a = normal(r.indicador); return r.anio === anio && (a === ind || (a.length > 8 && (a.indexOf(ind) >= 0 || ind.indexOf(a) >= 0))) && (est.filtro.sede === 'Ambas' || r.sede === est.filtro.sede || r.sede === 'Ambas'); });
      for (i = 1; i <= 12; i++) porMes.push(promedio(mias.filter(function (r) { return r.mes === i; }).map(function (r) { return r.resultado; })));
      var elegidas = mes ? mias.filter(function (r) { return r.mes === mes; }) : mias;
      if (elegidas.length) {
        if (m.anual && !mes) { valor = elegidas.reduce(function (a, r) { return a + r.resultado; }, 0); nota = 'Suma del año'; }
        else { var ult = Math.max.apply(null, elegidas.map(function (r) { return r.mes; })), u = elegidas.filter(function (r) { return r.mes === ult; });
          valor = promedio(u.map(function (r) { return r.resultado; }));
          nota = MESES[ult - 1] + (u.length > 1 ? ' · ' + u.map(function (r) { return r.sede + ' ' + n1(r.resultado); }).join(' · ') : '') + (u[0].obs ? ' · ' + u[0].obs : ''); }
      }
    }
    var c = seguimiento ? null : cumple(valor, m);
    return { valor: valor, texto: valor == null ? 'Sin resultado' : n1(valor) + m.unidad, nota: nota, fuente: fuente, estado: valor == null ? 'sin' : seguimiento || c == null ? 'seg' : c ? 'ok' : 'mal',
      tendencia: porMes.map(function (v) { var x = cumple(v, m); return v == null ? '' : seguimiento || x == null ? 'seg' : x ? 'ok' : 'mal'; }) };
  }
  function vistaKpi(d) {
    var anio = anioCostos(), mes = est.filtro.mes;
    if (!d.kpi.length) return '<section class="panel">' + vacio('No pude leer el cuadro de mando de la planeación estratégica.') + '</section>';
    var res = d.kpi.map(function (k) { return { k: k, r: resultadoKpi(d, k, anio, mes) }; });
    function n(e2) { return res.filter(function (x) { return x.r.estado === e2; }).length; }
    var ETI = { ok: ['Cumple', 'est-hecho'], mal: ['No cumple', 'est-vencido'], seg: ['En seguimiento', 'est-pendiente'], sin: ['Sin resultado', 'est-pendiente'] };
    var h = '<div class="rejilla cuatro">' + tarjeta('Indicadores', res.length, 'Del cuadro de mando') + tarjeta('Cumplen', n('ok'), e(periodo())) +
      tarjeta('No cumplen', n('mal'), n('mal') ? res.filter(function (x) { return x.r.estado === 'mal'; }).map(function (x) { return e(x.k.indicador); }).join(' · ') : 'Ninguno', n('mal') ? 'alerta' : '') +
      tarjeta('Sin resultado', n('sin'), n('sin') ? 'Falta escribirlos en la hoja' : 'Todos tienen dato') + '</div>';
    h += '<div class="rejilla tres">' + res.map(function (x) {
      return '<article class="tarjeta kpi-t ' + (x.r.estado === 'mal' ? 'alerta' : '') + '"><div class="detalle-cab"><b>' + e(x.k.indicador) + '</b><span class="chip ' + ETI[x.r.estado][1] + '">' + ETI[x.r.estado][0] + '</span></div>' +
        '<div class="kpi-valor"><span class="valor">' + e(x.r.texto) + '</span><span class="pie">Meta: <b class="meta">' + e(x.k.meta) + '</b></span></div>' +
        '<span class="pie">' + e(x.r.nota || x.k.perspectiva) + '</span><div class="tendencia" role="img" aria-label="Meses con resultado de enero a diciembre">' + x.r.tendencia.map(function (t, i) { return '<i class="' + t + '" title="' + MES3[i] + '"></i>'; }).join('') + '</div>' +
        '<span class="pie">' + x.r.fuente + ' · ' + e(x.k.frecuencia.toLowerCase()) + '</span></article>'; }).join('') + '</div>';
    var ult = d.kpiRes.filter(function (r) { return r.anio === anio; }).sort(function (a, b) { return b.mes - a.mes; }).slice(0, 12);
    h += '<section class="panel"><h2>Resultados escritos en la hoja</h2>' + (ult.length ? tablaSedes(['Indicador', 'Mes', 'Sede', 'Resultado', 'Observación'], ult.map(function (r) { return [e(r.indicador), MESES[r.mes - 1], e(r.sede), n1(r.resultado), e(r.obs)]; })) : vacio('Todavía no hay resultados escritos para ' + anio + '.')) +
      '<p class="pie">Los indicadores que no se calculan solos se escriben cada mes en la hoja «PWA Gases Medicinales», pestaña «Resultados KPI»: año, mes, sede, indicador y resultado (solo el número). La app solo la lee.</p></section>';
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


  /* Instalar la app (Chrome y Edge entregan el aviso; en otros navegadores se explica cómo). */
  var avisoInstalar = null;
  function yaInstalada() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function bloqueInstalar() {
    if (yaInstalada()) return '';
    if (avisoInstalar) return '<button type="button" class="boton secundario" id="btn-instalar">Instalar la app</button>';
    return '<p class="pie centro">Para instalarla: abre el menú del navegador (⋮) y elige «' + (ES_CELULAR ? 'Agregar a pantalla principal' : 'Transmitir, guardar y compartir → Instalar página como aplicación') + '».</p>';
  }
  window.addEventListener('beforeinstallprompt', function (ev) { ev.preventDefault(); avisoInstalar = ev; pintar(); });
  window.addEventListener('appinstalled', function () { avisoInstalar = null; pintar(); });

  function vistaCuenta() {
    var c = est.cuenta, u = est.sesion.usuario;
    var h = '<section class="panel"><h2>' + e(u.nombre) + '</h2><p class="pie">Usuario «' + e(u.usuario) + '» · ' + e(u.rol) + (c ? ' · ' + c.huellas + ' huella(s) registrada(s)' : '') + '</p>';
    h += '<h3>Huella del celular</h3>';
    if (!hayHuella()) h += vacio('Este navegador no permite usar huella.');
    else if (ES_CELULAR) h += '<p class="pie">Registra la huella de este teléfono. Después entras con ella aquí y también en el PC, escaneando un código QR.</p><button type="button" class="boton" id="btn-huella">Registrar la huella de este celular</button>';
    else h += '<p class="pie">La huella se registra desde el celular: abre la app en el teléfono, entra con tu PIN y ve a «Mi cuenta». En el PC entras escaneando un código QR con ese mismo teléfono; no se usa la huella ni el PIN de Windows.</p>';
    h += '<p class="error" role="alert" id="error-huella"></p><h3>Cambiar PIN</h3><form id="form-pin" class="formulario"><label>PIN actual<input name="pinActual" type="text" class="pin" inputmode="numeric" autocomplete="off" data-lpignore="true" data-1p-ignore required></label>' +
      '<label>PIN nuevo (6 a 12 números)<input name="pinNuevo" type="text" class="pin" inputmode="numeric" pattern="\\d{6,12}" autocomplete="off" data-lpignore="true" data-1p-ignore required></label><button class="boton secundario" type="submit">Cambiar PIN</button><p class="error" role="alert" id="error-pin"></p></form>' +
      (yaInstalada() ? '' : '<h3>Instalar</h3>' + bloqueInstalar()) + '<h3>Sesión</h3><button type="button" class="boton peligro" id="btn-salir">Cerrar sesión en este equipo</button></section>';
    return h;
  }

  function vistaProximas() {
    return '<section class="panel"><h2>Lo que sigue</h2><ul class="alertas">' + [
      ['Más adelante', 'Marcar lo ejecutado del cronograma desde la app, con evidencia (hoy se marca en las hojas).'],
      
      ['Fase 4', 'Cilindros, tanque, inventario y documentos, conectando las apps que ya existen.']
    ].map(function (x) { return '<li><span class="chip nota">' + x[0] + '</span><span>' + x[1] + '</span></li>'; }).join('') + '</ul></section>';
  }

  /* ───────── pantallas de ingreso ───────── */
  function pantallaIngreso() {
    var i = est.ingreso, cuerpo;
    if (!API) cuerpo = '<form id="form-api" class="formulario"><p class="pie">Pega la dirección de la implementación de Apps Script (termina en /exec).</p><label>Dirección del servidor<input name="api" type="url" required placeholder="https://script.google.com/macros/s/…/exec"></label><button class="boton" type="submit">Guardar</button></form>';
    else if (i.modo === 'instalar') cuerpo = '<form id="form-instalar" class="formulario"><p class="pie">Primera vez: crea tu usuario de administrador.</p><label>Clave de instalación<input name="clave" required autocomplete="off" autocapitalize="characters"></label><label>Tu nombre<input name="nombre" required maxlength="60"></label>' +
      '<label>Usuario para entrar<input name="usuario" required pattern="[a-z0-9._\\-]{3,20}" autocapitalize="none" placeholder="por ejemplo: jorge"></label><label>PIN de 6 a 12 números<input name="pin" type="text" class="pin" inputmode="numeric" pattern="\\d{6,12}" required autocomplete="off" data-lpignore="true" data-1p-ignore></label><button class="boton" type="submit">Crear administrador</button></form>';
    else if (i.modo === 'invitacion' && !ES_CELULAR) cuerpo = '<p class="pie">La invitación se usa en el celular, porque allí queda registrada la huella. Abre esta misma dirección en tu teléfono.</p><button type="button" class="enlace" data-modo="entrar">Volver</button>';
    else if (i.modo === 'invitacion') cuerpo = '<form id="form-invitacion" class="formulario"><p class="pie">Escribe el código que te dio el administrador. Luego registras la huella de este celular.</p><label>Código de invitación<input name="codigo" required maxlength="8" autocapitalize="characters" autocomplete="off"></label><button class="boton" type="submit">Continuar</button><button type="button" class="enlace" data-modo="entrar">Volver</button></form>';
    else cuerpo = (hayHuella() ? '<button type="button" class="boton" id="btn-entrar-huella">' + (ES_CELULAR ? 'Entrar con huella' : 'Entrar con la huella del celular') + '</button>' + (ES_CELULAR ? '' : '<p class="pie centro">Aparece un código QR: escanéalo con el teléfono donde registraste tu huella.</p>') + '<div class="separador"><span>o con PIN</span></div>' : '') +
      '<form id="form-pin-ingreso" class="formulario"><label>Usuario (el corto que creaste, no tu nombre)<input name="usuario" required autocapitalize="none" autocomplete="username" placeholder="por ejemplo: jorge" value="' + e(ls.get('ultimoUsuario', '')) + '"></label><label>PIN<input name="pin" type="text" class="pin" inputmode="numeric" required autocomplete="off" data-lpignore="true" data-1p-ignore></label><button class="boton secundario" type="submit">Entrar con PIN</button></form>' +
      '<button type="button" class="enlace" data-modo="invitacion">Tengo una invitación</button>';
    return '<main class="ingreso"><div class="icono-app" aria-hidden="true"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="8" height="13" rx="3"/><path d="M7 8V6h4v2M9 4v2"/><circle cx="17.5" cy="7.5" r="3.5"/><path d="M17.5 7.5l1.4-1.4"/></svg></div>' +
      '<h1>Gases Medicinales</h1><p class="pie centro">Clínica Reina Catalina · Barranquilla y Baranoa</p><div class="panel">' + cuerpo + '<p class="error" role="alert">' + e(i.error) + '</p>' + (i.ocupado ? '<p class="pie centro">Un momento…</p>' : '') + '</div>' + bloqueInstalar() + '</main>';
  }

  /* ───────── armazón ───────── */
  var VISTAS = [['inicio', 'Inicio'], ['cronograma', 'Cronograma'], ['costos', 'Costos'], ['kpi', 'Indicadores (KPI)'], ['proximas', 'Lo que sigue'], ['accesos', 'Accesos'], ['cuenta', 'Mi cuenta']];

  function pintar() {
    if (!est.sesion) { $app.innerHTML = pantallaIngreso(); return; }
    var u = est.sesion.usuario, d = est.datos;
    var vistas = VISTAS.filter(function (v) { return v[0] !== 'accesos' || u.rol === 'Administrador'; });
    var conFiltros = ['inicio', 'cronograma', 'costos', 'kpi'].indexOf(est.vista) >= 0;
    var cuerpo;
    if (est.vista === 'accesos') cuerpo = vistaAccesos();
    else if (est.vista === 'cuenta') cuerpo = vistaCuenta();
    else if (est.vista === 'proximas') cuerpo = vistaProximas();
    else if (est.vista === 'cronograma') cuerpo = vistaCronograma(d);
    else if (!d) cuerpo = '<section class="panel">' + vacio(est.cargando ? 'Leyendo las hojas del departamento… La primera vez puede tardar hasta un minuto.' : 'Todavía no hay datos.') + (est.cargando ? '' : '<button type="button" class="boton secundario" data-recargar="1">Volver a leer</button>') + '</section>';
    else cuerpo = { inicio: vistaInicio, cronograma: vistaCronograma, costos: vistaCostos, kpi: vistaKpi }[est.vista](d);
    var errores = d ? Object.keys(d.errores) : [];
    $app.innerHTML = '<div class="armazon"><nav class="menu" aria-label="Secciones"><div class="marca-app"><b>Gases Medicinales</b><span>Clínica Reina Catalina</span></div>' +
      vistas.map(function (v) { return '<button type="button" data-vista="' + v[0] + '" aria-current="' + (est.vista === v[0] ? 'page' : 'false') + '">' + v[1] + '</button>'; }).join('') +
      '<span class="quien">' + e(u.nombre) + ' · ' + e(u.rol) + '</span></nav><main class="contenido"><header class="cabecera"><div><h1>' + e(vistas.filter(function (v) { return v[0] === est.vista; })[0][1]) + '</h1>' +
      '<p class="pie">' + (d && d.leido ? 'Datos leídos ' + hora(d.leido) : '') + (est.cargando ? ' · actualizando…' : ' <button type="button" class="enlace" data-recargar="1">Actualizar</button>') + '</p></div>' + (est.vista === 'cronograma' ? filtrosCrono() : conFiltros ? filtros() : '') + '</header>' +
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
    if (b.dataset.vista) { est.vista = b.dataset.vista; est.nuevo = null; pintar(); if (est.vista === 'accesos') cargarAccesos(); if (est.vista === 'cuenta') abrirCuenta(); if (est.vista === 'cronograma') cargarCrono(); window.scrollTo(0, 0); }
    else if (est.vista === 'cronograma' && est.sesion && eventosCrono(b)) { /* atendido */ }
    else if (b.dataset.mes !== undefined) { est.filtro.mes = +b.dataset.mes; ls.set('filtro', est.filtro); pintar(); }
    else if (b.dataset.docs) { est.docs = { filtro: b.dataset.docs }; pintar(); }
    else if (b.dataset.recargar) { if (est.vista === 'cronograma') cargarCrono(true); cargarDatos(); }
    else if (b.dataset.sede) { est.filtro.sede = b.dataset.sede; ls.set('filtro', est.filtro); if (est.crono) est.crono.sel = null; pintar(); }
    else if (b.dataset.modo) { est.ingreso = { modo: b.dataset.modo, error: '', ocupado: false }; pintar(); }
    else if (b.id === 'btn-entrar-huella') { ocupado(true); entrarConHuella().then(entrar).catch(function (err) { ocupado(false, mensajeHuella(err)); }); }
    else if (b.id === 'btn-huella') { registrarHuella().then(function () { abrirCuenta('Huella registrada. Ya puedes entrar con ella.'); }).catch(function (err) { document.getElementById('error-huella').textContent = mensajeHuella(err); }); }
    else if (b.id === 'btn-instalar') { if (avisoInstalar) { avisoInstalar.prompt(); avisoInstalar.userChoice.then(function () { avisoInstalar = null; pintar(); }); } }
    else if (b.id === 'btn-salir') { api('salir').catch(function () {}).then(function () { cerrarLocal(); pintar(); }); }
    else if (b.dataset.quitar && window.confirm('¿Quitar el acceso de ' + b.dataset.nombre + '? No podrá volver a entrar.')) {
      api('quitarAcceso', { id: b.dataset.quitar }).then(cargarAccesos).catch(function (err) { window.alert(err.message); });
    }
  });

  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && est.vista === 'cronograma' && est.crono && est.crono.sel) cerrarTarea(); });

  /* Cierre por inactividad: 10 min en PC, 30 min en celular. */
  var MIN_INACTIVO = ES_CELULAR ? 30 : 10, ultimaActividad = ls.get('actividad', Date.now());
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (t) { window.addEventListener(t, function () { ultimaActividad = Date.now(); ls.set('actividad', ultimaActividad); }, { passive: true, capture: true }); });
  function revisarInactividad() {
    if (!est.sesion) return;
    var ultima = Math.max(ultimaActividad, ls.get('actividad', 0));
    if (Date.now() - ultima < MIN_INACTIVO * 60000) return;
    api('salir').catch(function () {});
    cerrarLocal(); est.ingreso = { modo: 'entrar', error: 'La sesión se cerró por ' + MIN_INACTIVO + ' minutos sin uso.', ocupado: false }; pintar();
  }
  setInterval(revisarInactividad, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) revisarInactividad(); });

  document.addEventListener('input', function (ev) {
    if (ev.target.id !== 'buscar-doc') return;
    var q = ev.target.value.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('#tabla-docs tbody tr'), function (tr) { tr.hidden = !!q && tr.dataset.num.indexOf(q) < 0; });
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
    revisarInactividad();
    if (est.sesion) { cargarDatos(); return; }
    api('estado').then(function (r) { if (!r.configurado) { est.ingreso.modo = 'instalar'; pintar(); } }).catch(function (err) { est.ingreso.error = navigator.onLine ? err.message : 'Sin conexión.'; pintar(); });
  }

  window.addEventListener('online', function () { if (est.sesion) cargarDatos(true); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  iniciar();
})();
