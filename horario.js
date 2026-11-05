// LIA · horario (iteración 3, docs/iteracion-3.md §5 y §6)
// Lo que se ve del horario: los cruces lado a lado en «Tu día» y en la cuadrícula de Semana, el aviso de duplicados y
// cruces antes de guardar, los cursos de una evaluación y el botón «+». Se carga antes del código de index.html y usa sus
// funciones y su estado (state, ui, esc, fmt, I…) solo al dibujar. La lógica pura (columnasCruces, gruposCruce,
// itemsCalendario, choques, textoChoques, cursosClase, claseDeEval) vive en el bloque LOGIC de index.html, con sus pruebas.

// Con 3 o más a la vez se ven 2 columnas: la primera actividad y «+N», que abre la lista (§5).
const COLS_VISIBLES = 2;
// Cuadrícula: alto de una hora y alto mínimo de una caja (lo más corto se dibuja con este alto y, si así toca a la
// siguiente, va a su lado: como en Google Calendar, ninguna caja pisa a otra).
const PX_HORA = 56, ALTO_MIN = 28, MIN_VISIBLE = Math.ceil(ALTO_MIN * 60 / PX_HORA);

// Desde 900 px, LIA se ve como página web (barra lateral) y Semana muestra los 7 días; en el celular, el día elegido.
const MQ_ANCHO = matchMedia('(min-width:900px)');
const esAncho = () => MQ_ANCHO.matches;
if (MQ_ANCHO.addEventListener) MQ_ANCHO.addEventListener('change', () => { if (typeof rerenderKeepScroll === 'function' && state && state.onboarded) rerenderKeepScroll(); });

// Qué abre cada actividad al tocarla (igual en la lista, en la cuadrícula y en la lista de «+N»).
function accionDe(x, date) {
  if (x.kind === 'estudio') return `data-a="block" data-ev="${x.block.evalId}" data-d="${x.block.date}" data-s="${x.block.s}" data-e="${x.block.e}"`;
  if (x.kind === 'examen') return `data-a="edit-eval" data-id="${x.ref}"`;
  if (x.kind === 'excepcion') return `data-a="edit-ex" data-id="${x.ref}"`;
  if (x.kind === 'libre') return `data-a="del-ex" data-id="${x.ref}"`;
  if (COMMIT_TYPES[x.kind]) return `data-a="commit-dia" data-id="${x.ref}" data-d="${x.cola ? ymd(addDays(fromYmd(date), -1)) : date}"`;
  return '';
}
// Su color y su ícono: el de su categoría. Una evaluación de un curso que ya existe se ve con el color de su clase y una
// franja de evaluación (§5); el color nunca va solo: el ícono y el nombre de la categoría lo acompañan.
function estiloDe(x) {
  if (x.kind === 'examen') {
    const e = evById(x.ref);
    return e && claseDeEval(state, e) ? { k: 'clase ev-clase', ico: icoRutina('clase'), sr: '', cat: '' } : { k: 'examen', ico: '', sr: '', cat: '' };
  }
  const k = x.kind === 'excepcion' && x.cat ? tipoRutina(x.cat) : x.kind;
  return COMMIT_TYPES[k] ? { k, ico: icoRutina(k), sr: `<span class="sr-only"> (${COMMIT_TYPES[k]})</span>`, cat: COMMIT_TYPES[k] } : { k, ico: '', sr: '', cat: '' };
}
const subDe = x => x.kind === 'excepcion' ? (x.sub || 'Solo este día') : x.kind === 'libre' ? 'Toca para deshacer' : x.sub || '';

// «Tu día»: lo que pasa a la vez va en una fila, en columnas (las de columnasCruces). Con 3 o más, la primera columna y «+N».
function cruceHTML(g, date) {
  const n = now(), hoy = date === ymd(n), nm = n.getHours() * 60 + n.getMinutes();
  const corta = g.cols > COLS_VISIBLES, cols = corta ? COLS_VISIBLES : g.cols, ocultos = corta ? g.items.filter(x => x.col !== 0).length : 0;
  const caja = x => {
    const st = estiloDe(x), sub = subDe(x), past = hoy && x.e <= nm;
    return `<button class="blk k-${st.k}${past ? ' pasado' : ''}" ${accionDe(x, date)}><b>${st.ico}${esc(x.label)}${st.sr}</b><small class="tnum">${fmt(x.s)} – ${fmt(x.e)}${sub ? ' · ' + esc(sub) : ''}</small></button>`;
  };
  const col = c => `<div class="cruce-col">${g.items.filter(x => x.col === c).map(caja).join('')}</div>`;
  const mas = `<div class="cruce-col"><button class="blk k-mas" data-a="cruce" data-v="lista" data-d="${date}" data-s="${g.s}" aria-label="Ver las ${g.items.length} actividades a la vez, de ${fmt(g.s)} a ${fmt(g.e)}"><b>+${ocultos}</b><small>Ver las ${g.items.length}</small></button></div>`;
  return `<div class="ag cruce"><span class="t tnum">${fmt(g.s)}</span><div class="cruce-in" role="group" aria-label="A la vez: ${g.items.length} actividades, de ${fmt(g.s)} a ${fmt(g.e)}">`
    + `<span class="cruce-t" aria-hidden="true">A la vez · ${fmt(g.s)} – ${fmt(g.e)}</span>`
    + `<div class="cruce-cols" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${corta ? col(0) + mas : [...Array(cols)].map((_, c) => col(c)).join('')}</div></div></div>`;
}

// Semana: cuadrícula de horas por día (§6). mostrar: los días que se dibujan (los 7 o el elegido); semana: los 7, para que
// la escala de horas no cambie al pasar de un día a otro.
function grupoGrilla(items) {
  const xs = columnasCruces(items.map(x => ({ ...x, fin: x.e, e: Math.max(x.e, x.s + MIN_VISIBLE) }))), gs = [];
  for (const o of xs) (gs[o.grupo] = gs[o.grupo] || []).push(o);
  return gs;
}
function grillaHTML(mostrar, semana, p) {
  const n = now(), t = ymd(n), nm = n.getHours() * 60 + n.getMinutes(), S = state.settings, uno = mostrar.length === 1;
  const todos = semana.flatMap(d => itemsCalendario(state, p, d));
  let h0 = Math.min(toMin(S.wake), ...todos.map(x => x.s)), h1 = Math.max(Math.min(1440, finDelDia(S)), ...todos.map(x => x.e));
  h0 = Math.max(0, Math.floor(h0 / 60) * 60); h1 = Math.min(1440, Math.ceil(h1 / 60) * 60); if (h1 - h0 < 360) h1 = Math.min(1440, h0 + 360);
  const y = m => Math.round((m - h0) * PX_HORA / 60), alto = y(h1);
  const horas = []; for (let m = h0 + 60; m < h1; m += 60) horas.push(`<span style="top:${y(m)}px">${fmt(m)}</span>`);
  const caja = (o, d, izq, ancho, g) => {
    const st = estiloDe(o), past = d < t || (d === t && o.fin <= nm), h = y(o.e) - y(o.s) - 2;
    const otros = g.filter(q => q !== o && q.s < o.fin && o.s < q.fin).map(q => q.label);
    const sobre = `${o.label}${st.cat && nombreN(st.cat) !== nombreN(o.label) ? ` (${st.cat})` : ''}, de ${fmt(o.s)} a ${fmt(o.fin)}${o.cola || o.deAnoche ? ', sigue desde anoche' : ''}${otros.length ? `. A la vez con ${otros.join(' y ')}` : ''}`;
    return `<button class="g-blk blk k-${st.k}${past ? ' pasado' : ''}" style="top:${y(o.s)}px;height:${h}px;left:calc(${izq * 100}% + 2px);width:calc(${ancho * 100}% - 4px)" ${accionDe(o, d)} aria-label="${esc(sobre)}" title="${esc(sobre)}">`
      + `<b>${st.ico}${esc(o.label)}</b>${h >= 40 ? `<small class="tnum">${fmt(o.s)}–${fmt(o.fin)}</small>` : ''}</button>`;
  };
  const dia = d => {
    const cajas = [], items = itemsCalendario(state, p, d);
    for (const g of grupoGrilla(items)) {
      const cols = g[0].cols, corta = cols > COLS_VISIBLES, ancho = corta ? COLS_VISIBLES : cols;
      for (const o of g) { if (corta && o.col !== 0) continue; cajas.push(caja(o, d, o.col / ancho, (corta ? 1 : o.span) / ancho, g)); }
      if (corta) {
        const s = g[0].s, e = Math.max(...g.map(o => o.e)), fin = Math.max(...g.map(o => o.fin)), ocultos = g.filter(o => o.col !== 0).length;
        cajas.push(`<button class="g-blk blk k-mas" style="top:${y(s)}px;height:${y(e) - y(s) - 2}px;left:calc(50% + 2px);width:calc(50% - 4px)" data-a="cruce" data-v="grilla" data-d="${d}" data-s="${s}" aria-label="Ver las ${g.length} actividades a la vez, de ${fmt(s)} a ${fmt(fin)}"><b>+${ocultos}</b></button>`);
      }
    }
    const ahora = d === t && nm > h0 && nm < h1 ? `<i class="g-ahora" style="top:${y(nm)}px" aria-hidden="true"></i>` : '';
    return `<div class="g-dia${d === t ? ' hoy' : ''}" role="group" aria-label="${cap(fechaLarga(d))}${d === t ? ', hoy' : ''}"><div class="g-cuerpo" style="height:${alto}px">${ahora}${cajas.join('')}${items.length ? '' : '<p class="sr-only">Sin actividades.</p>'}</div></div>`;
  };
  const cab = d => { const dt = fromYmd(d); return `<div class="g-cab${d === t ? ' hoy' : ''}" aria-hidden="true"><span>${DIAS[dt.getDay()].slice(0, 3)}</span><b class="tnum">${dt.getDate()}</b></div>`; };
  return `<div class="grilla${uno ? ' uno' : ''}" style="--cols:${mostrar.length};--hora:${PX_HORA}px">`
    + (uno ? '' : `<div class="g-esq" aria-hidden="true"></div>${mostrar.map(cab).join('')}`)
    + `<div class="g-horas tnum" style="height:${alto}px" aria-hidden="true">${horas.join('')}</div>${mostrar.map(dia).join('')}</div>`;
}

// La lista de lo que pasa a la vez (al tocar «+N»), desde la lista de «Tu día» o desde la cuadrícula.
function sheetCruce(d) {
  const p = P(), s = +d.s, date = d.d;
  const gs = d.v === 'grilla' ? grupoGrilla(itemsCalendario(state, p, date)) : gruposCruce(agendaFor(state, p, date).filter(x => x.kind !== 'libre')).map(g => g.items);
  const g = gs.find(x => x && x[0].s === s); if (!g) return '';
  const fin = o => o.fin !== undefined ? o.fin : o.e, hasta = Math.max(...g.map(fin));
  const fila = o => {
    const st = estiloDe(o), sub = subDe(o);
    return `<button class="item" ${accionDe(o, date)} style="text-align:left"><span class="sw k-${st.k}" aria-hidden="true">${st.ico || esc(o.label.slice(0, 1))}</span><span class="grow"><b>${esc(o.label)}</b>${st.sr}<br><span class="small muted tnum">${fmt(o.s)} – ${fmt(fin(o))}${sub ? ' · ' + esc(sub) : ''}</span></span></button>`;
  };
  return `<div class="grab"></div><h2>${g.length} actividades a la vez</h2><p class="muted small" style="margin:0">${cap(fechaLarga(date))}, de ${fmt(s)} a ${fmt(hasta)}. Toca una para verla.</p>
   <div class="stack">${g.map(fila).join('')}</div><button class="btn sec" data-a="close">Cerrar</button>`;
}

// Un solo botón «+» para agregar (§6). En Semana, en el celular, propone el día que estás mirando.
function fabHTML() {
  const d = !esAncho() && ui.tab === 'semana' && ui.vista === 'semana' && ui.sel && ui.sel >= ymd(now()) ? ui.sel : null;
  return `<button class="fab" data-a="agregar"${d ? ` data-d="${d}"` : ''} aria-label="Agregar${d ? ` algo el ${fechaLarga(d)}` : ''}">${I.plus.replace('<svg', '<svg aria-hidden="true"')}<span aria-hidden="true">Agregar</span></button>`;
}

// ---------- Antes de guardar: duplicados y cruces (§5) ----------
// En un formulario, el aviso reemplaza «Guardar» por «Guardar igual» y «Volver»; lo escrito se queda. El texto avisado va
// en un campo oculto: si después cambia lo escrito y el aviso ya es otro, se avisa de nuevo en vez de guardar.
function choqueFormHTML(texto, form) {
  // Lo seguro (Volver) es la acción principal; el foco en el aviso basta para que el lector lo lea una vez.
  return `<div class="warn choque"><span class="ico" style="color:var(--exam-ink)">${I.alert}</span><div class="grow small"><b id="choque-t" tabindex="-1" data-foco>${esc(texto)}</b><br>¿Lo guardo igual?</div></div>
  <input type="hidden" name="igual" value="${esc(texto)}"><button class="btn pri" type="button" data-a="choque-volver" data-v="${form}">Volver</button><button class="btn sec" type="submit">Guardar igual</button>`;
}
const pedirConfirmacion = (texto, fd) => !!texto && texto !== String(fd.get('igual') || '');
function mostrarChoque() { const w = document.getElementById('choque-t'); if (w) { w.scrollIntoView({ block: 'center' }); w.focus({ preventScroll: true }); } }
// Editar una rutina sin tocar su nombre, sus días ni sus horas no vuelve a avisar.
function rutinaSinCambios(r) {
  if (!r.id) return false;
  const g = r.ids.map(id => state.commitments.find(c => c.id === id));
  return g.length === r.tramos.length && g.every((c, i) => c && nombreN(c.name) === nombreN(r.name.trim() || COMMIT_TYPES[r.type]) && c.start === r.tramos[i].start && c.end === r.tramos[i].end
    && [...c.days].sort().join() === [...new Set(r.tramos[i].days)].sort().join());
}
// Lo que Lía entendió (en el chat, al dictar o por WhatsApp), revisado contra lo que ya hay.
function choqueDe(i, excluir) {
  const n = now();
  if (i.kind === 'eval') return choques(state, { kind: 'eval', type: i.type, course: i.course, date: i.date, time: i.time }, n, excluir);
  if (i.kind === 'commit') return choques(state, { kind: 'commit', name: i.name, type: i.type, days: i.days, start: i.start, end: i.end }, n, excluir);
  if (i.date && !i.libre) return choques(state, { kind: 'evento', label: i.label, cat: i.cat, date: i.date, start: i.start, end: i.end }, n, excluir);
  return { duplicado: null, cruces: [] };
}
const nombreDe = i => i.kind === 'eval' ? `${(EVAL_TYPES[i.type] || EVAL_TYPES.parcial).label} de ${i.course}` : i.kind === 'commit' ? i.name : i.label;
function textoChoqueLista(lista) {
  const ts = lista.map(i => ({ i, t: textoChoques(choqueDe(i)) })).filter(x => x.t);
  if (!ts.length) return '';
  return lista.length === 1 ? ts[0].t : ts.map(x => `«${nombreDe(x.i)}»: ${minus(x.t)}`).join(' ');
}
// En el chat, la propuesta con aviso lleva «Guardar igual» y «Volver» en vez de «Confirmar» y «Corregir».
function botonesPropuesta(pe, normales) {
  if (!pe.choque) return normales;
  return `<p class="small choque-chat" style="margin:0"><b>${esc(pe.choque)}</b> ¿Lo guardo igual?</p><div class="row-h"><button class="pill solid" data-a="volver-chat">Volver</button><button class="pill ghost" data-a="confirm">Guardar igual</button></div>`;
}
// Al escribir en Evaluaciones o en el registro, lo entendido se guarda al toque; con un aviso, primero esta hoja.
function sheetChoqueDictar() {
  const c = ui.choqueDictar;
  return `<div class="grab"></div><span class="eyebrow">Antes de guardar</span><h2>¿Lo guardo igual?</h2><p style="margin:0">${esc(c.texto)}</p>
   <div class="stack small muted">${c.items.map(i => `<span>${esc(resumenItem(i))}</span>`).join('')}</div>
   <button class="btn pri" data-a="dictar-volver">Volver</button><button class="btn sec" data-a="dictar-igual">Guardar igual</button>`;
}
// Por WhatsApp ya dijo «sí»: se guarda igual y el aviso dice con qué se cruza («Guardé X; se cruza con Y»).
function crucesWhatsapp(it) {
  const lista = it && it.intent === 'add' ? it.items || [] : it && it.intent === 'except' ? (it.exs || []).filter(x => !x.libre) : [];
  return lista.map(i => ({ i, r: choqueDe(i) })).filter(x => x.r.cruces.length)
    .map(x => ({ nombre: nombreDe(x.i), texto: minus(textoChoques({ duplicado: null, cruces: x.r.cruces })).replace(/\.$/, '') }));
}

// ---------- Evaluación ligada a un curso (§5) ----------
// Los cursos (clases) que ya existen, para elegir con un toque; también se puede escribir uno nuevo.
function cursosChipsHTML(sel) {
  const cs = cursosClase(state); if (!cs.length) return '';
  return `<div class="stack cursos" style="gap:6px;margin-top:-6px"><span class="small muted" id="e-cursos-ayuda">Elige uno de tus cursos o escribe otro.</span>
   <div class="chips" role="group" aria-label="Tus cursos">${cs.map(c => `<button type="button" class="pill ghost" data-a="curso" data-v="${esc(c)}" aria-pressed="${nombreN(c) === nombreN(sel)}">${esc(c)}</button>`).join('')}</div></div>`;
}
function marcarCursos() {
  const i = document.getElementById('e-course'); if (!i) return;
  for (const b of document.querySelectorAll('.sheet [data-a="curso"]')) b.setAttribute('aria-pressed', String(nombreN(b.dataset.v) === nombreN(i.value)));
}
document.addEventListener('input', ev => { if (ev.target && ev.target.id === 'e-course') marcarCursos(); });
// «Más temprano» en «Tu día» se queda como lo dejaste aunque la pantalla se vuelva a dibujar.
document.addEventListener('toggle', ev => { if (ev.target && ev.target.matches && ev.target.matches('details[data-antes]')) ui.antesAbierto = ev.target.open; }, true);

// Lee lo escrito en un formulario abierto de la hoja.
const leerHoja = sel => { const f = document.querySelector(`.sheet form[data-form="${sel}"]`); return f ? new FormData(f) : null; };

const ACCIONES_HORARIO = {
  cruce: d => { const h = sheetCruce(d); if (!h) return; ui.sheet = h; render(); },
  curso: d => { const i = document.getElementById('e-course'); if (!i) return; i.value = d.v; marcarCursos(); },
  // «Volver»: el formulario sin el aviso, con lo escrito, y el foco donde se corrige (las horas).
  'choque-volver': d => {
    if (d.v === 'rutina') { const r = leerRutina(); if (!r) return; r.choque = null; pintarRutina('#c-start'); return; }
    const fd = leerHoja(d.v); if (!fd) return;
    if (d.v === 'evento') {
      ui.evento = { ...(ui.evento || {}), label: String(fd.get('label') || ''), cat: tipoRutina(String(fd.get('ev-cat') || 'otro')), date: String(fd.get('date') || ''), start: String(fd.get('start') || ''), end: String(fd.get('end') || ''), choque: null };
      ui.sheet = sheetEvento(); render(); const el = document.getElementById('ev-date'); if (el) el.focus(); return;
    }
    if (d.v === 'eval') {
      const f = document.querySelector('.sheet form[data-form="eval"]'), id = f && f.dataset.id;
      ui.sheet = sheetEval(id || null, { type: fd.get('type'), course: String(fd.get('course') || ''), date: fd.get('date'), time: fd.get('time'), hours: String(fd.get('hours') || '') });
      render(); const el = document.getElementById('e-date'); if (el) el.focus();
    }
  },
  // En el chat, «Volver» no guarda y devuelve tu frase a la caja para que la corrijas.
  'volver-chat': () => {
    const p = ui.pending; ui.pending = null; liaSay('Ok, no lo guardé. Corrige tu mensaje si quieres y envíalo otra vez.'); render();
    const i = document.getElementById('chat-in'); if (i && p && p.q) { i.value = p.q; i.focus(); }
  },
  'dictar-igual': () => {
    const c = ui.choqueDictar; ui.choqueDictar = null; ui.sheet = null; if (!c) { render(); return; }
    const hecho = applyItems(c.items); rerenderKeepScroll();
    toast(`Lía agregó: ${c.items.map(resumenItem).join('; ')}.${textoAgendado(hecho.ids)}`, true);
  },
  'dictar-volver': () => {
    const c = ui.choqueDictar; ui.choqueDictar = null; ui.sheet = null; render();
    const i = c && document.getElementById(`dict-${c.from}`); if (i) { i.value = c.q; i.focus(); }
  },
};

// Hasta la 0.11 los recordatorios llegaban como notificaciones del navegador (LIA Pro, docs/notificaciones.md). Desde la
// 0.12.0 llegan por WhatsApp y con la alerta de Google Calendar: si este dispositivo los tenía activos, se da de baja una
// sola vez (deja de estar suscrito y se avisa a Supabase para que no le mande más).
function limpiarAvisosViejos() {
  let l = null; try { l = JSON.parse(localStorage.getItem('lia.avisos')); localStorage.removeItem('lia.avisos'); localStorage.removeItem('lia.avisos.firma'); } catch (e) { l = null; }
  if (state.settings && state.settings.avisos) { delete state.settings.avisos; save(); }
  if (!l) return;
  try { caches.delete('datos-avisos').catch(() => {}); } catch (e) { /* sin Cache Storage */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(r => r.pushManager && r.pushManager.getSubscription()).then(s => s && s.unsubscribe()).catch(() => {});
  if (l.endpoint && state.cuenta && cuentasActivas()) sbRpc('quitar_dispositivo', { p_endpoint: l.endpoint }).catch(() => {});
}
