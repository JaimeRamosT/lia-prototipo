// LIA · quitar desde Lía (iteración 3, docs/iteracion-3.md §4)
// «Borra la reunión de mañana», o «elimina el trabajo del miércoles» → «Toda la rutina»: las reglas de interpret()
// devuelven quitaEvento {exId,date} o quitaRutina {ids,name}. En el chat, Lía muestra lo que va a quitar con «Quitar» y
// «Mantener»; al quitar, guarda con un solo Deshacer. Por WhatsApp, lo confirmado se quita al abrir LIA
// (aplicarDeWhatsapp). Se carga antes del código de index.html y usa sus funciones y su estado solo al llamarse. La
// lógica pura (fraseQuitar, textoQuitar, sinLoQuitado, noQuitado) vive en el bloque LOGIC de index.html, con sus pruebas.

const esQuitar = r => !!r && (r.intent === 'quitaEvento' || r.intent === 'quitaRutina');
const eventoDe = r => (r.intent === 'quitaEvento' ? state.exceptions.find(x => x.id === r.exId && !x.libre) : null);
const rutinasDe = r => (r.intent === 'quitaRutina' ? state.commitments.filter(c => (r.ids || []).includes(c.id)) : []);

// En el chat, Lía propone y espera; en una caja de dictar (Evaluaciones, registro) se quita de una vez, con Deshacer,
// como una evaluación (quitaEval).
function responderQuitar(r, q, from) {
  const frase = fraseQuitar(state, r, now());
  if (!frase) {
    const t = r.intent === 'quitaEvento' ? 'Ese evento ya no está en tu horario.' : 'Esa rutina ya no está en tu horario.';
    if (from === 'chat') { liaSay(t); render(); } else toast(t);
    return;
  }
  if (from === 'chat') { ui.pending = { quitar: r, q }; save(); render(); anunciar(`${frase} Elige Quitar o Mantener.`); return; }
  const m = aplicarQuitar(r); toast(m.texto, true); rerenderKeepScroll();
}

// La tarjeta: lo que dice Lía («Quito «Reunión» de mañana a la 1:00 p. m.»), lo que se quita y los botones.
function quitarPendienteHTML(pe) {
  const r = pe.quitar, frase = fraseQuitar(state, r, now()); if (!frase) return '';
  const x = eventoDe(r);
  const blk = x ? `<div class="blk k-excepcion"><b>${esc(x.label)}</b><small>${esc(`${cap(fechaCorta(x.date))} · ${horario(x)}`)}</small></div>`
    : rutinasDe(r).map(c => { const k = tipoRutina(c.type);
      return `<div class="blk k-${k}"><b>${icoRutina(c.type)}${esc(c.name)}<span class="sr-only"> (${COMMIT_TYPES[k]})</span></b><small>${esc(`${diasTxt(c.days)} · ${horario(c)}`)}</small></div>`; }).join('');
  return `<div class="msg">${AV(28)}<div class="bub"><span class="eyebrow">Lía entendió</span><p style="margin:0">${esc(frase)}</p>${blk}
   <div class="row-h"><button class="pill solid" data-a="confirm">Quitar</button><button class="pill ghost" data-a="cancel">Mantener</button></div></div></div>`;
}

// Quita y dice qué pasó con el estudio, con Deshacer. En Pro el plan se rearma solo (P()); en Gratis, el tiempo que
// queda libre se usa al rearmar la semana (como al liberar un día en aplicarCambio).
function aplicarQuitar(r) {
  const x = eventoDe(r), c = rutinasDe(r)[0];
  if (!x && !c) return { texto: 'Eso ya no está en tu horario: no quité nada.', opts: {} };
  const p0 = P(); snapshot();
  const q = sinLoQuitado(state, r); state.commitments = q.commitments; state.exceptions = q.exceptions; save();
  const que = x ? `«${x.label}» del ${fechaCorta(x.date)}` : `la rutina «${c.name}»`;
  if (!isPro()) {
    if (!state.frozen) return { texto: `Listo, quité ${que}.`, opts: { undo: true } };
    return { texto: `Listo, quité ${que}. En Gratis no reorganizo sola: ${canArm() ? 'rearma tu semana para usar ese tiempo' : `podrás rearmar tu semana desde el ${fechaCorta(nextArmDate())}`}.`,
      opts: { undo: true, cta: canArm() ? null : 'reorg' } };
  }
  const p1 = P(), nuevos = x ? p1.blocks.filter(b => b.date === x.date && !p0.blocks.some(y => y.date === b.date && y.s === b.s && y.evalId === b.evalId)) : [];
  const cursos = [...new Set(nuevos.map(b => (evById(b.evalId) || {}).course).filter(Boolean))];
  return { texto: cursos.length ? `Listo, quité ${que}. Usé ese tiempo para estudiar ${cursos.join(' y ')}.` : `Listo, quité ${que} y reorganicé tu estudio.`, opts: { undo: true } };
}

// «Mantener»: nada cambia.
function textoMantener(r) {
  const x = eventoDe(r), c = rutinasDe(r)[0];
  return x ? `Ok, «${x.label}» sigue en tu horario.` : c ? `Ok, la rutina «${c.name}» sigue en tu horario.` : 'Ok, no quité nada.';
}

// Por WhatsApp: lo que la persona confirmó, ya revisado con revisarPropuesta (aplicarDeWhatsapp).
function quitarDeWhatsapp(it) { const q = sinLoQuitado(state, it); state.commitments = q.commitments; state.exceptions = q.exceptions; }
