// GENERADO por supabase/functions/lia-whatsapp/copiar.mjs. No lo edites: cambia el original y vuelve a correrlo.
// Origen: el bloque entre /*LOGIC-START*/ y /*LOGIC-END*/ de index.html.
function crear() {

const pad=n=>String(n).padStart(2,'0');
const toMin=t=>{const [h,m]=String(t).split(':').map(Number);return h*60+(m||0);};
const fmt=m=>{m=Math.max(0,Math.round(m));return pad(Math.floor(m/60)%24)+':'+pad(m%60);};
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const fromYmd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};
const addDays=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
const dayDiff=(a,b)=>Math.round((fromYmd(b)-fromYmd(a))/864e5);
const DIAS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const DIAS_C=['D','L','M','M','J','V','S'];
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const EVAL_TYPES={parcial:{label:'Parcial',h:5,exam:true},examen:{label:'Examen',h:5,exam:true},final:{label:'Final',h:6,exam:true},practica:{label:'Práctica',h:3,exam:true},control:{label:'Control',h:2,exam:true},entrega:{label:'Entrega',h:4,exam:false},exposicion:{label:'Exposición',h:3,exam:false}};
// Categorías de rutinas y de lo que pasa un solo día. El orden es el de los formularios.
const COMMIT_TYPES={clase:'Clases',trabajo:'Trabajo',traslado:'Traslado',comida:'Comidas',curso:'Curso o taller',deporte:'Deporte',ocio:'Ocio y descanso',casa:'Familia y casa',otro:'Otro'};
// Un tipo que esta versión no conoce (por ejemplo, datos de una versión más nueva) se muestra como «Otro».
const tipoRutina=t=>COMMIT_TYPES[t]?t:'otro';
const uid=()=>Math.random().toString(36).slice(2,9);
const hrs=m=>{m=Math.round(m);const h=Math.floor(m/60),r=m%60;return h&&r?`${h} h ${r} min`:h?`${h} h`:`${r} min`;};
const fechaLarga=s=>{const d=fromYmd(s);return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;};
const fechaCorta=s=>{const d=fromYmd(s);return `${DIAS[d.getDay()].slice(0,3)} ${d.getDate()} ${MESES[d.getMonth()].slice(0,3)}`;};

function subtract(wins,s,e){const out=[];for(const w of wins){if(e<=w.s||s>=w.e){out.push(w);continue;}if(s>w.s)out.push({s:w.s,e:s});if(e<w.e)out.push({s:e,e:w.e});}return out;}
// Un día de estudio va de la hora de despertar a la de dormir. Si se duerme después de medianoche (00:30),
// el día termina en el minuto 1470; un horario que termina al día siguiente (22:00–06:00) funciona igual.
const MARGEN_DESPERTAR=30;  // nadie estudia apenas abre los ojos
function finDelDia(S){const w=toMin(S.wake);let s=toMin(S.sleep);if(s<=w)s+=1440;return s;}
function intervalo(start,end){const s=toMin(start);let e=toMin(end);if(e<s)e+=1440;return{s,e};}
// Una rutina puede empezar o terminar en una fecha (desde/hasta, opcionales: hoy solo las trae Google Calendar).
const vigente=(c,f)=>(!c.desde||f>=c.desde)&&(!c.hasta||f<=c.hasta);
function busyFor(state,date){const wd=fromYmd(date).getDay(),ayer=(wd+6)%7,prev=ymd(addDays(fromYmd(date),-1));const b=[];
  // Lo liberado solo ese día ("hoy no tengo clases", "salgo temprano", un rato de ocio para estudiar) se descuenta
  // de esa rutina o de ese evento de un día.
  const libres=(c,d,desfase)=>state.exceptions.filter(x=>x.libre&&x.ref===c.id&&x.date===d).map(x=>{const r=intervalo(x.start,x.end);return[r.s+desfase,r.e+desfase];});
  const poner=(c,s,e,extra,quitar)=>{let partes=[{s,e}];for(const [ls,le] of quitar)partes=subtract(partes,ls,le);
    for(const q of partes)if(q.e>q.s)b.push({s:q.s,e:q.e,kind:tipoRutina(c.type),label:c.name,ref:c.id,...extra});};
  for(const c of state.commitments){const r=intervalo(c.start,c.end);
    if(c.days.includes(wd)&&vigente(c,date))poner(c,r.s,r.e,{},libres(c,date,0));
    if(r.e>1440&&c.days.includes(ayer)&&vigente(c,prev))poner(c,0,r.e-1440,{cola:true},libres(c,prev,-1440));}  // sigue desde anoche
  for(const x of state.exceptions){if(x.libre)continue;const r=intervalo(x.start,x.end),base={kind:'excepcion',label:x.label,ref:x.id,cat:x.cat};
    if(x.date===date)poner(x,r.s,r.e,base,libres(x,date,0));
    else if(x.date===prev&&r.e>1440)poner(x,0,r.e-1440,{...base,cola:true},libres(x,prev,-1440));}
  return b;}
// Gratis: lo que no se pudo estudiar vuelve a entrar en los huecos libres del horario armado, sin mover lo demás
// y antes de su evaluación. falta: {evalId: minutos}. Devuelve los bloques nuevos (vacío si no hay huecos).
function reacomodar(state,f,falta,now){const t=ymd(now);let nuevos=[];
  for(const [id,min] of Object.entries(falta)){const e=state.evals.find(x=>x.id===id);if(!e||e.date<t||!(min>=10))continue;
    const hecho=state.done.filter(x=>x.evalId===id).reduce((a,x)=>a+x.min,0);
    const armado=[...f.blocks,...nuevos].filter(b=>finBloque(b).date>=t).map(b=>{const sig=b.s>=1440;return{date:sig?ymd(addDays(fromYmd(b.date),1)):b.date,s:sig?b.s-1440:b.s,len:b.e-b.s};});
    const p=plan({...state,evals:[{...e,hours:(hecho+min)/60}],done:[...state.done,...armado.map(x=>({evalId:'',date:x.date,start:fmt(x.s),min:x.len}))],
      exceptions:[...state.exceptions,...armado.map(x=>({date:x.date,start:fmt(x.s),end:fmt(x.s+x.len+10),label:''}))]},now,[id]);
    nuevos=[...nuevos,...p.blocks];}
  return nuevos;}
// «Tu semana»: lo de esta semana (evaluaciones y estudio agendado desde hoy) y cómo fue la anterior (estudio hecho).
function resumenSemana(state,p,now){const t=ymd(now),lun=fromYmd(mondayDe(now)),dias=k=>[...Array(7)].map((_,i)=>ymd(addDays(lun,i+7*k)));
  const esta=dias(0),pasada=dias(-1);
  return{lunes:esta[0],evals:state.evals.filter(e=>esta.includes(e.date)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)),
    agendado:p.blocks.filter(b=>esta.includes(b.date)&&b.date>=t).reduce((a,b)=>a+b.e-b.s,0),
    sinHueco:state.evals.filter(e=>esta.includes(e.date)&&(p.unmet||{})[e.id]>0),
    hechoPasada:state.done.filter(x=>pasada.includes(x.date)).reduce((a,x)=>a+x.min,0),
    evalsPasada:state.evals.filter(e=>pasada.includes(e.date)).length};}
const mondayDe=d=>ymd(addDays(d,-((d.getDay()+6)%7)));
// Rutinas con varios horarios (decisión del 28-oct): cada horario es un compromiso y los de una misma rutina
// comparten grupo. Así el formato de los datos guardados no cambia (v:1).
function agruparRutinas(cs){const out=[],ix={};
  for(const c of cs){const k=c.grupo||c.id;if(ix[k]===undefined){ix[k]=out.length;out.push({id:c.id,grupo:c.grupo||null,name:c.name,type:c.type,tramos:[]});}out[ix[k]].tramos.push(c);}
  return out;}
// Rutinas con las que se cruza un horario {days,start,end}, sin contar las de excluir (los horarios de la misma rutina).
// Un horario que pasa la medianoche también se cruza con lo que hay temprano al día siguiente.
function crucesTramo(cs,t,excluir){if(!t.days.length||!HHMM.test(t.start)||!HHMM.test(t.end)||t.start===t.end)return[];
  const r=intervalo(t.start,t.end),out=[];
  for(const c of cs){if(excluir.includes(c.id))continue;const q=intervalo(c.start,c.end);
    const mismo=t.days.some(d=>c.days.includes(d))&&r.s<q.e&&q.s<r.e;
    const sigueT=r.e>1440&&t.days.some(d=>c.days.includes((d+1)%7))&&r.e-1440>q.s;
    const sigueC=q.e>1440&&c.days.some(d=>t.days.includes((d+1)%7))&&q.e-1440>r.s;
    if(mismo||sigueT||sigueC)out.push(c);}
  return out;}
// Todo lo ocupado dentro de un día de estudio, incluida la madrugada siguiente cuando se duerme después de medianoche.
function ocupadoMarco(state,date,fin){const o=busyFor(state,date).map(b=>[b.s,b.e]);
  for(const x of state.done)if(x.date===date)o.push([toMin(x.start),toMin(x.start)+x.min]);
  for(const e of state.evals)if(e.date===date)o.push([toMin(e.time)-30,toMin(e.time)+120]);
  if(fin>1440){const m=ymd(addDays(fromYmd(date),1));
    for(const b of busyFor(state,m))if(!b.cola)o.push([b.s+1440,b.e+1440]);
    for(const x of state.done)if(x.date===m)o.push([toMin(x.start)+1440,toMin(x.start)+1440+x.min]);
    for(const e of state.evals)if(e.date===m)o.push([toMin(e.time)+1410,toMin(e.time)+1560]);}
  return o;}
function evalDeadline(ev,S){const t=EVAL_TYPES[ev.type]||EVAL_TYPES.parcial;
  if(t.exam)return{date:ymd(addDays(fromYmd(ev.date),-1)),end:finDelDia(S)};
  return{date:ev.date,end:Math.min(toMin(ev.time)-60,finDelDia(S))};}
// Amanecidas: estudio anotado de 00:00 a 04:59 cuenta como «después de medianoche» de la noche anterior.
// Devuelve las noches con estudio y cuántas pasaron la medianoche entre dos fechas (inclusive), y si el plan de esas
// fechas tiene bloques que terminan después de medianoche.
const MADRUGADA=300;
function nochesDeEstudio(state,p,desde,hasta){const noches=new Set(),tarde=new Set(),corte=Math.min(MADRUGADA,toMin((state.settings&&state.settings.wake)||'05:00'));
  for(const x of state.done){const ini=toMin(x.start),fin=ini+x.min;
    const noche=ini<corte?ymd(addDays(fromYmd(x.date),-1)):x.date;if(noche<desde||noche>hasta)continue;
    noches.add(noche);if(ini<corte||fin>1440)tarde.add(noche);}
  const riesgo=p.blocks.filter(b=>b.date>=desde&&b.date<=hasta&&b.e>1440).length;
  return{noches:noches.size,tarde:tarde.size,salvadas:noches.size-tarde.size,riesgo,dias:[...noches].sort(),diasTarde:[...tarde].sort()};}
function doneFor(state,id){return state.done.filter(x=>x.evalId===id).reduce((a,x)=>a+x.min,0);}

// Motor de horarios: reparte las horas que pide cada evaluación en los huecos libres reales.
// Con soloIds, reparte solo esas evaluaciones (las demás siguen ocupando la hora de su examen).
function plan(state,now,soloIds){
  const S=state.settings,wake=toMin(S.wake)+MARGEN_DESPERTAR,sleep=finDelDia(S);
  const today=ymd(now),nowMin=now.getHours()*60+now.getMinutes();
  const evs=state.evals.filter(e=>!soloIds||soloIds.includes(e.id)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  let last=ymd(addDays(now,6));for(const e of evs)if(e.date>last)last=e.date;
  const nDays=Math.min(dayDiff(today,last),60);const days={};
  for(let i=0;i<=nDays;i++){const d=ymd(addDays(fromYmd(today),i));let wins=wake<sleep?[{s:wake,e:sleep}]:[];
    if(i===0)wins=subtract(wins,0,Math.ceil((nowMin+10)/15)*15);
    for(const [s,e] of ocupadoMarco(state,d,sleep))wins=subtract(wins,s,e);
    days[d]={wins,load:0,free:wins.reduce((a,w)=>a+w.e-w.s,0)};}
  for(const x of state.done)if(days[x.date])days[x.date].load+=x.min;
  const blocks=[],unmet={};
  for(const ev of evs){
    let rem=Math.max(0,Math.round(ev.hours*60)-doneFor(state,ev.id));
    const dl=evalDeadline(ev,S);
    if(dl.date<today){unmet[ev.id]=ev.date<today?0:rem;continue;}
    const dlist=Object.keys(days).filter(d=>d<=dl.date).sort();
    const evLoad={};let progress=true;
    while(rem>=10&&progress){progress=false;
      for(const d of dlist){if(rem<10)break;const day=days[d];
        const avail=Math.min(S.maxDay-day.load,120-(evLoad[d]||0));
        const need=S.minBlock;  // ningún bloque más corto que el mínimo, aunque falte menos tiempo
        if(avail<need)continue;
        const limit=d===dl.date?dl.end:sleep;
        const cands=day.wins.map(w=>({s:w.s,e:Math.min(w.e,limit)})).filter(w=>w.e-w.s>=need);
        if(!cands.length)continue;
        cands.sort((a,b)=>(b.e-b.s)-(a.e-a.s)||a.s-b.s);
        const w=cands[0];let len=Math.min(S.block,Math.max(rem,need),avail,w.e-w.s);
        len=Math.floor(len/5)*5;if(len<need)continue;
        let st=w.s;if(w.e-w.s>=len+180&&st<600)st=Math.min(600,w.e-len);
        blocks.push({evalId:ev.id,date:d,s:st,e:st+len});
        day.wins=subtract(day.wins,st,st+len+10);day.load+=len;evLoad[d]=(evLoad[d]||0)+len;rem-=len;progress=true;}}
    unmet[ev.id]=rem>=10?rem:0;}
  blocks.sort((a,b)=>(a.date+fmt(a.s)).localeCompare(b.date+fmt(b.s)));
  return{blocks,unmet,days};
}
// Plan Gratis: el que se armó al empezar la semana, contado con honestidad. Un bloque que ya pasó sin estudiarse
// no cuenta como agendado: esas horas vuelven a faltar y el bloque queda en «perdidos» hasta que la persona diga si lo estudió.
const claveBloque=b=>`${b.evalId}|${b.date}|${b.s}`;
// Cuándo termina un bloque: si pasa la medianoche, termina al día siguiente.
// Un bloque armado ya se estudió si algo anotado de esa evaluación cae dentro (lo de después de medianoche se guarda con el día siguiente).
function estudiado(state,b){const sig=ymd(addDays(fromYmd(b.date),1));
  return state.done.some(x=>{if(x.evalId!==b.evalId)return false;const s=toMin(x.start)+(x.date===b.date?0:x.date===sig?1440:NaN);return s<b.e&&s+x.min>b.s;});}
function finBloque(b){return b.e>=1440?{date:ymd(addDays(fromYmd(b.date),1)),min:b.e-1440}:{date:b.date,min:b.e};}
function planCongelado(state,f,now){const t=ymd(now),nm=now.getHours()*60+now.getMinutes(),S=state.settings;
  const evs=new Map(state.evals.map(e=>[e.id,e])),vistos=new Set(Array.isArray(f.vistos)?f.vistos:[]);
  const hecho=b=>estudiado(state,b);
  const aTiempo=b=>{const dl=evalDeadline(evs.get(b.evalId),S);return b.date<dl.date||(b.date===dl.date&&b.e<=dl.end);};
  const paso=b=>{const f=finBloque(b);return f.date<t||(f.date===t&&f.min<=nm);};
  const vivos=f.blocks.filter(b=>evs.has(b.evalId)&&!hecho(b)&&aTiempo(b));
  const blocks=vivos.filter(b=>b.date>=t);
  const perdidos=vivos.filter(b=>paso(b)&&evs.get(b.evalId).date>=t&&!vistos.has(claveBloque(b)));
  const unmet={},unplanned={};
  for(const e of state.evals){const r=Math.max(0,Math.round(e.hours*60)-doneFor(state,e.id));
    if(f.evalIds.includes(e.id)){const fut=vivos.filter(b=>b.evalId===e.id&&!paso(b)).reduce((a,b)=>a+b.e-b.s,0);unmet[e.id]=e.date>=t&&r-fut>=10?r-fut:0;}
    else if(e.date>=t&&r>=10)unplanned[e.id]=r;}
  return{blocks,unmet,unplanned,perdidos,days:{},frozen:true};}
// Gratis: bloques armados que todavía no pasan y que ahora caen encima de algo ocupado (una rutina o algo de un día).
// Un bloque después de medianoche se compara también con lo que empieza temprano al día siguiente. Con filtro, solo
// cuenta lo ocupado que pasa el filtro (p. ej., solo el ocio).
function bloquesQueChocan(state,f,now,filtro){const t=ymd(now),nm=now.getHours()*60+now.getMinutes(),evs=new Set(state.evals.map(e=>e.id)),pasa=x=>!filtro||filtro(x);
  return f.blocks.filter(b=>{const fin=finBloque(b);if(!evs.has(b.evalId)||fin.date<t||(fin.date===t&&fin.min<=nm))return false;
    const o=busyFor(state,b.date).filter(pasa).map(x=>[x.s,x.e]);
    if(b.e>1440)for(const x of busyFor(state,ymd(addDays(fromYmd(b.date),1))))if(!x.cola&&pasa(x))o.push([x.s+1440,x.e+1440]);
    return o.some(([s,e])=>s<b.e&&b.s<e);});}
// Gratis: una evaluación nueva entra sola al horario ya armado, en los huecos libres, sin mover lo que ya estaba.
// Los bloques armados que aún no pasan cuentan como estudio de su día (para el máximo diario) y como ocupados,
// con los 10 minutos de pausa que el motor deja después de cada bloque.
function sumarAlCongelado(state,f,ids,now){const t=ymd(now);
  const nuevas=state.evals.filter(e=>ids.includes(e.id)&&e.date>=t&&!f.evalIds.includes(e.id)).map(e=>e.id);
  if(!nuevas.length)return{blocks:[],unmet:{}};
  const armado=f.blocks.filter(b=>finBloque(b).date>=t).map(b=>{const sig=b.s>=1440;return{date:sig?ymd(addDays(fromYmd(b.date),1)):b.date,s:sig?b.s-1440:b.s,len:b.e-b.s};});
  const p=plan({...state,done:[...state.done,...armado.map(x=>({evalId:'',date:x.date,start:fmt(x.s),min:x.len}))],
    exceptions:[...state.exceptions,...armado.map(x=>({date:x.date,start:fmt(x.s),end:fmt(x.s+x.len+10),label:''}))]},now,nuevas);
  return{blocks:p.blocks,unmet:p.unmet};}
// ---------- Ciclo (16 semanas) ----------
// El ciclo empieza el lunes que eligió la persona (settings.cicloInicio) o, si no eligió, el lunes de la semana de su
// primera evaluación (como mucho 15 semanas atrás, para que esta semana siempre se vea).
const SEMANAS_CICLO=16;
const lunesDe=d=>ymd(addDays(d,-((d.getDay()+6)%7)));
function inicioCiclo(state,now){const hoyL=lunesDe(now);
  const elegido=state.settings&&/^\d{4}-\d{2}-\d{2}$/.test(state.settings.cicloInicio||'')?lunesDe(fromYmd(state.settings.cicloInicio)):null;
  const primera=state.evals.map(e=>e.date).filter(Boolean).sort()[0],min=ymd(addDays(fromYmd(hoyL),-7*(SEMANAS_CICLO-1)));
  let ini=elegido||(primera&&primera<hoyL?lunesDe(fromYmd(primera)):hoyL);
  if(!elegido&&ini<min)ini=min;return ini;}
// La carga de cada semana: evaluaciones, horas de estudio (agendadas y hechas) y de trabajo, y un nivel que se explica solo:
// pesada con 3 o más evaluaciones o si a alguna no le alcanzan las horas; media con 2; ligera con 0 o 1.
function cargaCiclo(state,p,inicio,semanas=SEMANAS_CICLO){const out=[];
  for(let k=0;k<semanas;k++){const lunes=ymd(addDays(fromYmd(inicio),7*k)),dias=[...Array(7)].map((_,i)=>ymd(addDays(fromYmd(lunes),i)));
    const evs=state.evals.filter(e=>dias.includes(e.date)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    const estudio=dias.reduce((a,d)=>a+p.blocks.filter(b=>b.date===d).reduce((x,b)=>x+b.e-b.s,0)+state.done.filter(x=>x.date===d).reduce((x,h)=>x+h.min,0),0);
    const trabajo=dias.reduce((a,d)=>a+busyFor(state,d).filter(b=>b.kind==='trabajo'||b.cat==='trabajo').reduce((x,b)=>x+b.e-b.s,0),0);
    const sinHueco=evs.filter(e=>(p.unmet||{})[e.id]>0);
    const nivel=evs.length>=3||sinHueco.length?'pesada':evs.length===2?'media':'ligera';
    out.push({n:k+1,lunes,domingo:dias[6],evals:evs,estudio,trabajo,sinHueco,nivel});}
  return out;}
// La semana pesada que viene (esta o una de las 3 siguientes) y cuánto estudio ya hay agendado antes de que empiece.
function semanaPesada(state,p,now){const t=ymd(now),hoyL=lunesDe(now);
  const s=cargaCiclo(state,p,hoyL,4).map(w=>({...w,evals:w.evals.filter(e=>e.date>=t)})).find(w=>w.evals.length>=3||w.sinHueco.length);if(!s)return null;
  const ids=new Set(s.evals.map(e=>e.id)),antes=p.blocks.filter(b=>ids.has(b.evalId)&&b.date<s.lunes).reduce((a,b)=>a+b.e-b.s,0);
  return{...s,antes,estaSemana:s.lunes===hoyL};}
function agendaFor(state,P,date){
  const it=[];const ev=id=>state.evals.find(e=>e.id===id);
  for(const b of busyFor(state,date))it.push(b.cola?{...b,sub:'Sigue desde anoche'}:{...b});
  for(const x of state.exceptions)if(x.libre&&x.date===date){const r=intervalo(x.start,x.end);it.push({s:r.s,e:r.e,kind:'libre',label:x.label,ref:x.id});}
  for(const e of state.evals)if(e.date===date)it.push({s:toMin(e.time),e:toMin(e.time)+120,kind:'examen',label:`${EVAL_TYPES[e.type].label} · ${e.course}`,ref:e.id});
  for(const x of state.done)if(x.date===date){const e=ev(x.evalId);it.push({s:toMin(x.start),e:toMin(x.start)+x.min,kind:'hecho',label:`Estudiaste ${e?e.course:''}`,ref:x.id});}
  for(const b of P.blocks)if(b.date===date){const e=ev(b.evalId);it.push({s:b.s,e:b.e,kind:'estudio',label:`Estudiar ${e?e.course:''}`,sub:e?`Para: ${EVAL_TYPES[e.type].label} ${fechaCorta(e.date)}`:'',ref:b.evalId,block:b});}
  it.sort((a,b)=>a.s-b.s);return it;
}

// ---------- «Tu día» completo (iteración 2) ----------
// El día despierto va de la hora de despertar a la de dormir. Cada minuto es de una sola cosa, en este orden:
// evaluación, rutina o algo de un solo día, estudio; lo que queda es libre. Así las partes suman el día completo.
const esEstudio=x=>x.kind==='estudio'||x.kind==='hecho';
function tramosDia(state,P,date){const S=state.settings,m={s:toMin(S.wake),e:finDelDia(S)};
  const sig=ymd(addDays(fromYmd(date),1));
  const todo=[...agendaFor(state,P,date),...(m.e>1440?agendaFor(state,P,sig).filter(x=>!x.cola).map(x=>({...x,s:x.s+1440,e:x.e+1440})):[])]
    .filter(x=>x.kind!=='libre'&&x.e>m.s&&x.s<m.e);
  const pts=[...new Set([m.s,m.e,...todo.flatMap(x=>[Math.max(x.s,m.s),Math.min(x.e,m.e)])])].sort((a,b)=>a-b),out=[];
  for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],en=todo.filter(x=>x.s<b&&x.e>a);
    const top=en.find(x=>x.kind==='examen')||en.find(x=>!esEstudio(x))||en.find(esEstudio);
    const k=!top?'libre':top.kind==='examen'?'examen':top.kind==='hecho'?'hecho':top.kind==='estudio'?'estudio':top.kind==='excepcion'?(top.cat?tipoRutina(top.cat):'excepcion'):top.kind;
    const l=out[out.length-1];if(l&&l.k===k&&l.e===a)l.e=b;else out.push({s:a,e:b,k});}
  return out;}
// Resumen del día: despierto = ocupado + estudio + libre.
function resumenDia(state,P,date){const tr=tramosDia(state,P,date),suma=f=>tr.filter(f).reduce((a,x)=>a+x.e-x.s,0);
  const estudio=suma(x=>x.k==='estudio'||x.k==='hecho'),libre=suma(x=>x.k==='libre'),despierto=suma(()=>true);
  return{despierto,ocupado:despierto-estudio-libre,estudio,libre,tramos:tr};}
// Huecos libres que se pueden tocar para agregar algo: de 15 min o más, sin lo ya liberado (que tiene su propia fila)
// y, si es hoy, solo desde ahora.
function huecosDia(state,P,date,now){const t=ymd(now);if(date<t)return[];
  const desde=date===t?Math.ceil((now.getHours()*60+now.getMinutes())/5)*5:0;
  let w=tramosDia(state,P,date).filter(x=>x.k==='libre').map(x=>({s:Math.max(x.s,desde),e:x.e})).filter(x=>x.e>x.s);
  for(const x of state.exceptions)if(x.libre&&x.date===date){const r=intervalo(x.start,x.end);w=subtract(w,r.s,r.e);}
  return w.filter(x=>x.e-x.s>=15);}

// ---------- El ocio es tiempo protegido (decisión del 28-oct) ----------
// Lía no pone estudio en el ocio. Si no alcanza el tiempo libre, propone usar un rato de ocio, y solo si la persona dice que sí.
const esOcio=x=>x.kind==='ocio'||(x.kind==='excepcion'&&tipoRutina(x.cat||'')==='ocio');
// El primer rato de ocio antes de la evaluación donde cabe un bloque de lo que falta (respetando el máximo por día), o null.
function ocioParaEstudio(state,P,evalId,now){const S=state.settings,ev=state.evals.find(e=>e.id===evalId);if(!ev)return null;
  const falta=((P.unmet||{})[evalId]||0)+((P.unplanned||{})[evalId]||0);if(falta<10)return null;
  const dl=evalDeadline(ev,S),t=ymd(now),nm=now.getHours()*60+now.getMinutes(),fin=Math.min(finDelDia(S),1440);
  for(let i=0;i<=60;i++){const d=ymd(addDays(fromYmd(t),i));if(d>dl.date)break;
    const desde=Math.max(toMin(S.wake)+MARGEN_DESPERTAR,d===t?Math.ceil((nm+10)/15)*15:0),hasta=d===dl.date?Math.min(fin,dl.end):fin;
    if(hasta-desde<S.minBlock)continue;
    const busy=busyFor(state,d),ocio=busy.filter(x=>!x.cola&&esOcio(x));if(!ocio.length)continue;
    const bl=P.blocks.filter(b=>b.date===d),hechos=state.done.filter(x=>x.date===d);
    const carga=bl.reduce((a,b)=>a+b.e-b.s,0)+hechos.reduce((a,x)=>a+x.min,0);
    const delCurso=bl.filter(b=>b.evalId===evalId).reduce((a,b)=>a+b.e-b.s,0)+hechos.filter(x=>x.evalId===evalId).reduce((a,x)=>a+x.min,0);
    const cabe=Math.min(S.maxDay-carga,120-delCurso);if(cabe<S.minBlock)continue;
    const otros=[...busy.filter(x=>!esOcio(x)).map(x=>[x.s,x.e]),...bl.map(b=>[b.s,b.e+10]),...hechos.map(x=>[toMin(x.start),toMin(x.start)+x.min]),
      ...state.evals.filter(e=>e.date===d).map(e=>[toMin(e.time)-30,toMin(e.time)+120])];
    for(const o of ocio){let w=[{s:Math.max(o.s,desde),e:Math.min(o.e,hasta)}].filter(x=>x.e>x.s);for(const [s,e] of otros)w=subtract(w,s,e);
      const h=w.find(x=>x.e-x.s>=S.minBlock);if(!h)continue;
      const len=Math.floor(Math.min(Math.max(falta,S.minBlock),S.block,cabe,h.e-h.s)/5)*5;if(len<S.minBlock)continue;  // un bloque como los de siempre
      return{date:d,s:h.s,e:h.s+len,ref:o.ref,label:o.label,evento:o.kind==='excepcion'};}}
  return null;}
// Gratis: saca del horario armado unos bloques que ya no sirven (p. ej., quedaron en tu ocio) y ubica ese estudio
// en los huecos libres, sin mover lo demás. Lo que no entra queda como «falta» (planCongelado lo cuenta).
function reubicarCongelado(state,f,quitar,now){const t=ymd(now),k=claveBloque,fuera=new Set(quitar.map(k));
  const quedan=f.blocks.filter(b=>!fuera.has(k(b))),ids=[...new Set(quitar.map(b=>b.evalId))];
  const dia=b=>b.s>=1440?ymd(addDays(fromYmd(b.date),1)):b.date,ini=b=>b.s>=1440?b.s-1440:b.s,vigente=b=>finBloque(b).date>=t;
  // Lo armado que se queda cuenta como avance de las evaluaciones que se reubican, o como carga del día para las demás.
  const hechos=quedan.filter(b=>ids.includes(b.evalId)?!estudiado(state,b):vigente(b)).map(b=>({evalId:ids.includes(b.evalId)?b.evalId:'',date:dia(b),start:fmt(ini(b)),min:b.e-b.s}));
  const ocup=quedan.filter(vigente).map(b=>({date:dia(b),start:fmt(ini(b)),end:fmt(ini(b)+b.e-b.s+10),label:''}));
  const p=plan({...state,done:[...state.done,...hechos],exceptions:[...state.exceptions,...ocup]},now,ids);
  return{blocks:[...quedan,...p.blocks],nuevos:p.blocks};}

// ---------- Lectura de frases (sin IA) ----------
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const DAYW={domingo:0,domingos:0,lunes:1,martes:2,miercoles:3,jueves:4,viernes:5,sabado:6,sabados:6};
const EVAL_KW={parcial:'parcial',parciales:'parcial',examen:'examen',examenes:'examen',tarea:'entrega',tareas:'entrega',proyecto:'entrega',monografia:'entrega',informe:'entrega',ensayo:'entrega',final:'final',finales:'final',practica:'practica',pc:'practica',pc1:'practica',pc2:'practica',pc3:'practica',pc4:'practica',control:'control',quiz:'control',lab:'control',laboratorio:'control',entrega:'entrega',entrego:'entrega',entregar:'entrega',entregable:'entrega',exposicion:'exposicion',expongo:'exposicion',sustentacion:'exposicion',sustento:'exposicion'};
const COMMIT_KW={trabajo:'trabajo',trabajar:'trabajo',trabajando:'trabajo',chamba:'trabajo',chambeo:'trabajo',turno:'trabajo',clase:'clase',clases:'clase',
  traslado:'traslado',traslados:'traslado',demoro:'traslado',viaje:'traslado',bus:'traslado',combi:'traslado',micro:'traslado',metro:'traslado',metropolitano:'traslado',movilidad:'traslado',
  almuerzo:'comida',almorzar:'comida',desayuno:'comida',cena:'comida',cenar:'comida',lonche:'comida',comida:'comida',refrigerio:'comida',
  curso:'curso',cursos:'curso',taller:'curso',talleres:'curso',academia:'curso',ingles:'curso',idioma:'curso',idiomas:'curso',diplomado:'curso',cepre:'curso',
  frances:'curso',portugues:'curso',aleman:'curso',italiano:'curso',chino:'curso',japones:'curso',
  gimnasio:'deporte',gym:'deporte',futbol:'deporte',fulbito:'deporte',voley:'deporte',basquet:'deporte',natacion:'deporte',correr:'deporte',running:'deporte',
  deporte:'deporte',entreno:'deporte',entrenamiento:'deporte',yoga:'deporte',pilates:'deporte',crossfit:'deporte',box:'deporte',boxeo:'deporte',baile:'deporte',
  descanso:'ocio',descansar:'ocio',siesta:'ocio',ocio:'ocio',netflix:'ocio',videojuegos:'ocio',cine:'ocio',relajo:'ocio',hobby:'ocio',pasatiempo:'ocio',
  familia:'casa',hijo:'casa',hija:'casa',hijos:'casa',hijas:'casa',cuido:'casa',cuidar:'casa',quehaceres:'casa',
  voluntariado:'otro',iglesia:'otro',misa:'otro'};
const NUMW={una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12};
const MESN={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
const TIMECTX=new Set(['las','la','de','a','desde','hasta','y','entre']);
function tokenize(text){
  const raw=text.replace(/[“”"«»¿?¡!]/g,' ').replace(/(\d)(am|pm|hrs|hr|h)\b/gi,'$1 $2').replace(/([ap])\.\s?m\.?/gi,'$1m').replace(/,/g,' , ').split(/\s+/).filter(Boolean);
  const toks=raw.map(o=>({o:o.replace(/[.;]+$/,''),n:norm(o).replace(/[.;]+$/,'')}));
  for(let i=0;i<toks.length;i++){const t=toks[i];if(NUMW[t.n]&&i>0&&TIMECTX.has(toks[i-1].n)){t.n=String(NUMW[t.n]);}}
  // «Práctica de fútbol», «entrenamiento de vóley»: un deporte, no una práctica calificada.
  for(let i=0;i<toks.length;i++){const t=toks[i];if(t.n!=='practica'&&t.n!=='practicas')continue;
    const sig=toks[i+1]&&toks[i+1].n==='de'?toks[i+2]:toks[i+1];if(sig&&COMMIT_KW[sig.n]==='deporte')t.n='entrenamiento';}
  return toks;}
const H='(\\d{1,2})(?::(\\d{2}))?(?:\\s*(am|pm))?';
function partOf(ns){const m=ns.match(/\b(?:en|por|de|a) (?:la|las) (manana|tarde|noche)s?\b/)||ns.match(/\b(tarde|noche)s?\b/);return m?m[1]:null;}
// Parte del día pegada a una hora: "10 de la noche", "6 de la mañana", "2 de la madrugada", "12 del mediodía".
const Q='(?:\\s+(?:(?:de|en|por)\\s+la|del)\\s+(manana|tarde|noche|madrugada|mediodia))?';
const HQ=H+Q;
function adj(h,m,ap,part){h=+h;m=+m||0;if(ap){if(ap==='pm'&&h<12)h+=12;if(ap==='am'&&h===12)h=0;}
  else if(part==='noche'&&h===12)h=0;
  else if((part==='tarde'||part==='noche'||part==='mediodia')&&h<12)h+=12;
  else if(part!=='manana'&&part!=='madrugada'&&h>=1&&h<=6)h+=12;return h*60+m;}
// Lecturas posibles de una hora en minutos: "6" puede ser 06:00 o 18:00; "6 am" o "6 de la mañana", solo 06:00.
function horasPosibles(h,m,ap,q){h=+h;m=+m||0;if(h>24||m>59)return[];if(h>12)return[h%24*60+m];
  const am=h%12*60+m,pm=(h%12+12)*60+m;
  if(ap==='am'||q==='madrugada')return[am];
  if(q==='manana')return[h===12?720+m:am];
  if(ap==='pm'||q==='tarde'||q==='mediodia')return[pm];
  if(q==='noche')return[h===12?m:pm];
  return h===12?[720+m,m]:[am,pm];}
// La lectura más probable de un rango: que dure 12 h o menos, que no cruce la medianoche, que no empiece
// de madrugada y, si empatan, la de siempre (de 1 a 6 sin aclarar es de la tarde). Si cruza, el fin pasa de 1440.
function rangoProbable(a,b,parte){const pg=a[2]||a[3]||b[2]||b[3]?null:parte;
  const qa=a[3]||pg,qb=b[3]||pg,hab=adj(a[0],a[1],a[2],qa);let mejor=null;
  for(const s of horasPosibles(a[0],a[1],a[2],qa))for(const e0 of horasPosibles(b[0],b[1],b[2],qb)){
    let e=e0===0&&s>0?1440:e0,cruza=false;if(e<=s){e+=1440;cruza=true;}
    const pen=[e-s>720?1:0,cruza?1:0,s<360?1:0,s===hab?0:1].join();
    if(!mejor||pen<mejor.pen)mejor={s,e,pen};}
  return mejor?[mejor.s,mejor.e]:null;}
function parseTimes(ns){const part=partOf(ns);
  let m=ns.match(new RegExp(`\\b(?:de|desde|entre)\\s+(?:las\\s+|la\\s+)?${HQ}\\s+(?:a|hasta|y)\\s+(?:las\\s+|la\\s+)?${HQ}`));
  if(!m)m=ns.match(new RegExp(`\\b(\\d{1,2}):(\\d{2})(?:\\s*(am|pm))?${Q}\\s*(?:-|a|hasta)\\s*${HQ}`));
  if(m){const r=rangoProbable(m.slice(1,5),m.slice(5,9),part);if(r)return{range:r,part};}
  m=ns.match(new RegExp(`\\b(?:hasta(?:\\s+las|\\s+la)?|salgo\\b.{0,25}?\\ba(?:\\s+las|\\s+la)?)\\s+${HQ}`));
  if(m)return{until:adj(m[1],m[2],m[3],m[4]||part),part,crudo:m.slice(1,5)};
  m=ns.match(new RegExp(`\\b(?:a las|a la|las)\\s+${HQ}`));
  if(m)return{at:adj(m[1],m[2],m[3],m[4]||part),part,crudo:m.slice(1,5)};
  m=ns.match(/\b(\d{1,2}):(\d{2})(?:\s*(am|pm))?/);
  if(m)return{at:adj(m[1],m[2],m[3],part),part,crudo:[m[1],m[2],m[3],null]};
  m=ns.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if(m)return{at:adj(m[1],0,m[2],part),part,crudo:[m[1],null,m[2],null]};
  return{part};}
function nextWeekday(now,wd,allowToday){let d=(wd-now.getDay()+7)%7;if(d===0&&!allowToday)d=7;return ymd(addDays(now,d));}
// «En 2 semanas», «dentro de 10 días», «en un mes», «el lunes dentro de 3 semanas», «el martes de la próxima semana».
// Con un día de la semana, es ese día en la semana que cae dentro de N semanas (de lunes a domingo). Sin número de
// días ni día de la semana («la próxima semana») no hay fecha exacta: null.
const NUM_REL='(\\d{1,2}|un par de|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince)';
const RE_REL=new RegExp(`\\b(cada\\s+)?(?:dentro de|en|de aqui a|de aca a|faltan?)\\s+(?:unas?\\s+|como\\s+)?${NUM_REL}\\s+(semanas?|dias?|mes(?:es)?)\\b`);
// «La próxima semana» (1), «la subsiguiente semana» (2) o 0.
function semanaSinDia(ns){const w=ns.match(/\b(?:(proxima|siguiente|otra|subsiguiente)\s+semana|semana\s+que\s+viene)\b/);return w?(w[1]==='subsiguiente'?2:1):0;}
// Un día de la semana dentro de N semanas (de lunes a domingo).
function diaEnSemanas(wd,n,now){const base=addDays(now,7*n);return ymd(addDays(base,(wd+6)%7-(base.getDay()+6)%7));}
function fechaRelativa(ns,now){const m=ns.match(RE_REL);let n=null,u=null,exacta=true;
  if(m){if(m[1])return null;n=m[2]==='un par de'?2:m[2]==='quince'?15:m[2]==='un'?1:NUMW[m[2]]||+m[2];u=m[3][0];}
  else{n=semanaSinDia(ns)||null;u='s';exacta=false;}
  if(!n||n>(u==='d'?90:u==='s'?12:3))return null;
  if(u==='d')return ymd(addDays(now,n));
  let base=addDays(now,7*n);
  if(u==='m'){base=new Date(now.getFullYear(),now.getMonth()+n,now.getDate());if(base.getDate()!==now.getDate())base=new Date(now.getFullYear(),now.getMonth()+n+1,0);}
  const dia=Object.entries(DAYW).find(([w])=>new RegExp(`\\b${w}\\b`).test(ns));
  if(dia)return u==='s'?diaEnSemanas(dia[1],n,now):ymd(addDays(base,(dia[1]+6)%7-(base.getDay()+6)%7));
  return exacta?ymd(base):null;}
function parseDate(ns,now){
  const ns2=ns.replace(/\b(?:en|por|de|a) (?:la|las) mananas?\b/g,' ');
  const enN=fechaRelativa(ns2,now);if(enN)return enN;
  if(/\bpasado manana\b/.test(ns))return ymd(addDays(now,2));
  if(/\bhoy\b/.test(ns2))return ymd(now);
  if(/\bmanana\b/.test(ns2))return ymd(addDays(now,1));
  let m=ns.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  const mk=(d,mo)=>{let y=now.getFullYear();let dt=new Date(y,mo-1,d);if(dt<addDays(now,-1))dt=new Date(y+1,mo-1,d);return ymd(dt);};
  if(m)return mk(+m[1],+m[2]);
  m=ns.match(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if(m)return mk(+m[1],MESN[m[2]]);
  // «El lunes 9», «el martes 3 a las 8»: el número dice qué semana es. No es fecha si el número es una hora
  // («el viernes 10 de la noche») o el inicio de un rango («lunes 8 a 1»).
  m=ns2.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+(\d{1,2})\b(?!\s*(?::|am\b|pm\b|h\b|hrs?\b|horas?\b|de la\b|del\b|-|a\s+\d|hasta\b))/);
  if(m){const f=diaConNumero(+m[2],DAYW[m[1]],now);if(f)return f;}
  for(const [w,wd] of Object.entries(DAYW)){if(new RegExp(`\\b${w}\\b`).test(ns2)){const prox=new RegExp(`\\b(proximo|siguiente|otro)\\s+${w}\\b`).test(ns2);let d=nextWeekday(now,wd,false);if(prox&&dayDiff(ymd(now),d)<7)d=ymd(addDays(fromYmd(d),7));return d;}}
  m=ns.match(/\bel (\d{1,2})\b(?!\s*(?::|am|pm|h\b|horas))/);
  if(m)return diaDelMes(+m[1],now);
  return null;}
// La fecha de algo de un solo día: hoy, mañana, pasado mañana, una fecha con número («el 5 de noviembre», «el lunes 9»,
// «el 12»), o null si la frase habla de días de la semana («los lunes», «de lunes a viernes») o no dice el día.
function unSoloDia(ns,now){const ns2=ns.replace(/\b(?:en|por|de|a) (?:la|las) mananas?\b/g,' ');
  if(/\b(los|todos|cada|diario)\b/.test(ns2))return null;
  if(/\b(entro|salgo|llego|recien|empiezo|termino)\b/.test(ns2))return null;  // cambia la entrada o la salida de siempre: lo ven otras reglas
  if(/\b(desde|a partir de(l)?)\b/.test(ns2))return null;  // «desde mañana me cambiaron el turno»: es para siempre
  const enN=fechaRelativa(ns2,now);if(enN)return enN;
  if(/\bsemana\b/.test(ns2))return null;
  const rel=/\b(hoy|manana|pasado manana)\b/.test(ns2),num=/\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b|\b\d{1,2}\s*\/\s*\d{1,2}\b|\bel \d{1,2}\b(?!\s*(?::|am|pm|h\b|horas))/.test(ns2);
  const wdNum=/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+\d{1,2}\b(?!\s*(?::|am\b|pm\b|h\b|hrs?\b|horas?\b|de la\b|del\b|-|a\s+\d|hasta\b))/.test(ns2);
  if(!rel&&!num&&!wdNum)return null;if(!rel&&!wdNum&&parseDays(ns2).length)return null;
  return parseDate(ns,now);}
// El fin de algo que empieza a cierta hora: «hasta las 6», «a las 6» o «6 pm», siempre después del inicio (12 h como máximo).
function finDespues(inicio,tm){const s0=toMin(inicio);const cands=tm.crudo?horasPosibles(...tm.crudo):tm.until!=null?[tm.until]:tm.at!=null?[tm.at]:[];
  const ok=cands.flatMap(v=>[v,v+1440]).filter(v=>v>s0&&v-s0<=720).sort((a,b)=>a-b);return ok.length?fmt(ok[0]):null;}
// «El 9»: el día 9 de este mes o, si ya pasó, del siguiente.
function diaDelMes(d,now){let dt=new Date(now.getFullYear(),now.getMonth(),d);if(dt<addDays(now,-1))dt=new Date(now.getFullYear(),now.getMonth()+1,d);return ymd(dt);}
// «El lunes 9»: el próximo día 9 que cae lunes (de hoy en adelante, hasta 3 meses). Si ninguno cae lunes,
// manda el número, igual que «el 9»: es lo más concreto que dijo la persona y la propuesta muestra el día.
function diaConNumero(d,wd,now){if(d<1||d>31)return null;const hoy=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  for(let k=0;k<3;k++){const dt=new Date(now.getFullYear(),now.getMonth()+k,d);if(dt.getDate()===d&&dt>=hoy&&dt.getDay()===wd)return ymd(dt);}
  return diaDelMes(d,now);}
function parseDays(ns){
  // «Todos los días de semana» y «días hábiles» son de lunes a viernes («todos los días de la semana», toda la semana).
  if(/\b(dias de semana|dias habiles|dias laborables|dias utiles)\b/.test(ns))return[1,2,3,4,5];
  if(/\b(todos los dias|diario|diariamente|cada dia)\b/.test(ns))return[0,1,2,3,4,5,6];
  if(/\bfin(?:es)? de semana\b/.test(ns))return[6,0];
  if(/\bentre semana\b/.test(ns))return[1,2,3,4,5];
  const dw='(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?';
  const m=ns.match(new RegExp(`\\b${dw}\\s+(?:a|al|hasta)\\s+(?:el\\s+)?${dw}\\b`));
  if(m){const a=DAYW[m[1]],b=DAYW[m[2]];const out=[];let d=a;for(let k=0;k<7;k++){out.push(d);if(d===b)break;d=(d+1)%7;}return out;}
  const out=[];for(const [w,wd] of Object.entries(DAYW))if(new RegExp(`\\b${w}\\b`).test(ns)&&!out.includes(wd))out.push(wd);
  return out.sort((a,b)=>((a+6)%7)-((b+6)%7));}
const STOPW=new Set(['el','la','los','las','a','y',',','hoy','manana','pasado','este','esta','proximo','proxima','siguiente','que','para','con','en','al','del','por','tengo','es','son','sera','dentro','faltan','falta','vence','vencen','vencera']);
// «Práctica calificada de química»: «calificada» es parte del tipo, no del curso.
const SKIPW=new Set(['de','del','en','el','la','mi','un','una','los','las','sobre','para','curso','curso:','calificada','calificado','calificadas','calificados']);
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function extractCourse(toks,i,conTipos){let j=i+1;while(j<toks.length&&SKIPW.has(toks[j].n))j++;const out=[];
  for(;j<toks.length&&out.length<4;j++){const t=toks[j];
    if(t.n==='de'&&out.length&&j+1<toks.length&&!STOPW.has(toks[j+1].n)&&toks[j+1].n!=='de'&&DAYW[toks[j+1].n]===undefined&&!/^\d/.test(toks[j+1].n)&&!MESN[toks[j+1].n]){out.push(t.o);continue;}
    if(STOPW.has(t.n)||t.n==='de'||DAYW[t.n]!==undefined||(EVAL_KW[t.n]&&!out.length&&!conTipos)||MESN[t.n])break;
    if(/^\d/.test(t.n)){if(out.length&&/^\d$/.test(t.n)&&!(toks[j+1]&&/^(de|\/|am|pm|h|horas)$/.test(toks[j+1].n))){out.push(t.o);continue;}break;}
    if(/^(i|ii|iii|iv|v)$/.test(t.n)&&out.length){out.push(t.o.toUpperCase());continue;}
    out.push(t.o);}
  return cap(out.join(' '));}
function hasTime(ns){return /\d/.test(ns);}
function splitClauses(toks){const parts=[];let cur=[];
  for(let i=0;i<toks.length;i++){const t=toks[i];
    if(t.n==='y'||t.n===','){const lns=cur.map(x=>x.n).join(' ');const rns=toks.slice(i+1).map(x=>x.n).join(' ');
      const leftOk=hasTime(lns)||(cur.some(x=>EVAL_KW[x.n])&&parseDate(lns,new Date())!==null);
      const rightOk=/\d/.test(rns)||Object.keys(DAYW).some(w=>new RegExp(`\\b${w}\\b`).test(rns))||cur.length&&toks.slice(i+1).some(x=>EVAL_KW[x.n]||COMMIT_KW[x.n])||/\b(hoy|manana|tarde|noche)\b/.test(rns);
      const esEval=x=>EVAL_KW[x.n]||ENTREGA_N.has(x.n)&&x.n!=='trabajo';
      const dosEvals=cur.some(esEval)&&toks.slice(i+1,i+4).some(esEval);
      if(cur.length&&(leftOk&&rightOk||dosEvals)){parts.push(cur);cur=[];continue;}
      if(!cur.length)continue;}
    cur.push(t);}
  if(cur.length)parts.push(cur);return parts;}
// Entregas con nombre propio: "informe de laboratorio", "trabajo final de marketing", "tarea de algoritmos".
const ENTREGA_N=new Set(['tarea','tareas','proyecto','monografia','informe','ensayo','trabajo']);
const TRABAJO_ENTREGA=/^(final|grupal|escrito|monografico|aplicativo)$/;
// Lo que no se dijo queda vacío (decisión 4: nada se guarda sin hora) y Lía lo pregunta (continuarBorrador).
function evalDe(ns,now,type,course){const date=parseDate(ns,now)||'';const tm=parseTimes(ns);
  const time=tm.at!=null?fmt(tm.at):tm.range?fmt(tm.range[0]):type==='entrega'&&/\bmedianoche\b/.test(ns)?'23:59':'';
  const hm=ns.match(/\b(\d{1,2})\s*(?:h|hrs|horas)\b/);const hours=hm?Math.min(+hm[1],40):EVAL_TYPES[type].h;
  return{kind:'eval',type,course,date,time,hours};}
// Nombre de una rutina dicha en una frase: «Clases», «Trabajo» y «Traslado» por su tipo; las demás, por la palabra
// que se usó («Almuerzo», «Gimnasio») y, si es un curso, con su tema («Curso de inglés»).
const NOMBRE_KW={almorzar:'Almuerzo',cenar:'Cena',descansar:'Descanso',entreno:'Entrenamiento',cuido:'Cuidar a la familia',cuidar:'Cuidar a la familia',
  hijo:'Familia',hija:'Familia',hijos:'Familia',hijas:'Familia',quehaceres:'Quehaceres de la casa'};
function nombreRutina(toks,i,type){if(type==='clase'||type==='trabajo'||type==='traslado')return COMMIT_TYPES[type];
  const w=toks[i],a=toks[i+1],b=toks[i+2];if(NOMBRE_KW[w.n])return NOMBRE_KW[w.n];
  if(/^(curso|cursos|taller|talleres|academia|entrenamiento)$/.test(w.n)&&a&&a.n==='de'&&b&&!STOPW.has(b.n)&&DAYW[b.n]===undefined&&!/^\d/.test(b.n))return cap(w.o.toLowerCase()+' de '+b.o.toLowerCase());
  return cap(w.o.toLowerCase());}
// La categoría que sugiere el nombre de una rutina («Almuerzo» → comida), o null si no se sabe.
function tipoPorNombre(nombre){for(const w of norm(String(nombre||'')).split(/[^a-z0-9]+/))if(COMMIT_KW[w])return COMMIT_KW[w];return null;}
// ---------- Una evaluación nueva se liga a su curso (iteración 3) ----------
// «Parcial de cálculo» → «Cálculo I» si esa clase existe: así queda con el nombre exacto del curso (y con el color de su
// clase). Los cursos conocidos son las clases y los cursos de las evaluaciones que ya están (sin las entregas con nombre
// propio, como «Informe de Química», ni las rutinas que se llaman como su tipo, como «Clases»).
const ROMANOS={i:'1',ii:'2',iii:'3',iv:'4',v:'5',vi:'6'};
const palCurso=s=>norm(String(s||'')).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w&&!/^(de|del|la|las|el|los|y|e|en|a|al|para|con)$/.test(w)).map(w=>ROMANOS[w]||w);
function cursosConocidos(state){const out=[],vistos=new Set();
  const poner=n=>{const k=palCurso(n).join(' ');if(!k||vistos.has(k)||COMMIT_KW[k]||/^(clases?|cursos?|otro)$/.test(k))return;vistos.add(k);out.push(n);};
  for(const c of state.commitments||[])if(c.type==='clase')poner(c.name);
  for(const e of state.evals||[])if(!(e.type==='entrega'&&/^(tareas?|proyecto|monografia|informe|ensayo|trabajo)\b/.test(norm(e.course||''))))poner(e.course);
  return out;}
// El curso conocido más parecido a lo dicho, o null. Sin tildes ni mayúsculas; «1» y «I» valen igual; una palabra de
// 4 letras o más vale como abreviatura («mate» → «Matemática Básica»). Todo lo dicho tiene que estar en el curso (otro
// número es otro curso). Si dos cursos se parecen igual, no elige; el nombre exacto gana.
function cursoParecido(x,state){const xs=palCurso(x),num=w=>/^\d+$/.test(w);if(!xs.some(w=>!num(w)))return null;
  let mejor=0,cual=[];
  for(const c of cursosConocidos(state)){const cs=palCurso(c);let p=xs.join(' ')===cs.join(' ')?3:2;
    for(const w of xs){if(cs.includes(w))continue;
      if(!num(w)&&w.length>=4&&cs.some(v=>!num(v)&&v.length>=4&&(v.startsWith(w)||w.startsWith(v))))p=Math.min(p,1);else{p=0;break;}}
    if(p>mejor){mejor=p;cual=[c];}else if(p&&p===mejor)cual.push(c);}
  return cual.length===1?cual[0]:null;}
function parseClause(toks,now,prev,S,state){
  const ns=toks.map(t=>t.n).join(' '),ligar=c=>(state&&cursoParecido(c,state))||c;
  const iE=toks.findIndex(t=>EVAL_KW[t.n]);
  const iC=toks.findIndex(t=>COMMIT_KW[t.n]);
  const iN=toks.findIndex((t,j)=>ENTREGA_N.has(t.n)&&(t.n!=='trabajo'||TRABAJO_ENTREGA.test((toks[j+1]||{}).n||'')||toks.slice(Math.max(0,j-3),j).some(x=>EVAL_KW[x.n]==='entrega')));
  if(iN>=0&&!toks.slice(0,iN).some(x=>EVAL_KW[x.n]&&EVAL_KW[x.n]!=='entrega')){
    const doble=toks[iN].n==='trabajo'&&TRABAJO_ENTREGA.test((toks[iN+1]||{}).n||'');
    const resto=extractCourse(toks,doble?iN+1:iN,true);
    // «Un avance del proyecto de emprendimiento», «el borrador del informe de marketing»: lo que se entrega es parte de
    // otra cosa, así que el curso es lo último («Emprendimiento»). Si el curso ya existe, se liga a ese (cursoParecido).
    const antes=toks[iN-2],anidado=iN>=2&&/^(de|del)$/.test(toks[iN-1].n)&&!!antes&&!EVAL_KW[antes.n]&&!SKIPW.has(antes.n)&&!STOPW.has(antes.n)&&!/^\d/.test(antes.n);
    const ligado=resto&&state?cursoParecido(resto,state):null;
    const nombre=ligado||(anidado&&resto?resto:cap(toks[iN].o.toLowerCase()+(doble?' '+toks[iN+1].o.toLowerCase():''))+(resto?' de '+resto:''));
    return evalDe(ns,now,'entrega',nombre);}
  if(iE>=0){let k=iE;while(k+1<toks.length&&EVAL_KW[toks[k+1].n])k++;const type=EVAL_KW[toks[k].n];
    return evalDe(ns,now,type,ligar(extractCourse(toks,k)));}
  if(iC>=0||(prev&&prev.kind==='commit')){
    const type=iC>=0?COMMIT_KW[toks[iC].n]:prev.type;
    const name=iC>=0?nombreRutina(toks,iC,type):prev.name;
    return rutinaDicha(ns,type,name);}
  return null;}
// Días y horas de una rutina. Con solo la hora de inicio («cena todos los días a las 8») el fin queda vacío y Lía lo
// pregunta; con una parte del día y sin hora («en la tarde»), la franja del formulario.
function rutinaDicha(ns,type,name){const days=parseDays(ns),tm=parseTimes(ns);let range=tm.range,start='';
  if(!range&&tm.at!=null)start=fmt(tm.at);else if(!range&&tm.part)range=FRANJA_RUTINA[tm.part];
  return{kind:'commit',type,name,days,start:range?fmt(range[0]):start,end:range?fmt(range[1]):''};}
// Compromisos de un solo día que no son clases ni trabajo.
const EVENTO=/\b(cumpleanos|reunion|cita|fiesta|matrimonio|boda|evento|consulta|dentista|entrevista|partido|velorio|tramite|concierto)\b/;
function nombreEvento(toks,w){const i=toks.findIndex(t=>t.n===w);if(i<0)return cap(w);const sig=toks[i+1];
  return cap(toks[i].o.toLowerCase()+(sig&&/^(medica|medico|familiar)$/.test(sig.n)?' '+sig.o.toLowerCase():''));}
// ---------- Lo que se repite cada semana es una rutina (iteración 3) ----------
const REPITE=/\b(semanal|semanales|semanalmente|cada semana|todas las semanas|todos los (?:lunes|martes|miercoles|jueves|viernes|sabados|domingos|dias|fines de semana)|cada (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia|fin de semana)|los (?:lunes|martes|miercoles|jueves|viernes|sabados|domingos|fines de semana)|diario|diariamente|entre semana|dias de semana|dias habiles|dias laborables)\b/;
const RANGO_DIAS=/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\s+(?:a|al|hasta)\s+(?:el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\b/;
// El nombre que sigue a una palabra, hasta los días o las horas: «reunión de equipo todos los martes» → «Reunión de equipo».
function frasePropia(toks,i){const out=[];
  for(let j=i;j<toks.length&&out.length<6;j++){const t=toks[j],sig=(toks[j+1]||{n:''}).n,n=t.n.replace(/[^a-z0-9]/g,'');
    if(!n||DAYW[n]!==undefined||/^\d/.test(n)||/^(semanal|semanales|semanalmente|todos|todas|cada|diario|diariamente|entre|desde|hasta)$/.test(n))break;
    if(/^(de|del|a|al|los|las|el|la|en|por)$/.test(n)&&(DAYW[sig]!==undefined||/^\d/.test(sig)||/^(las?|todos|cada|semana|manana|tarde|noche|fines?)$/.test(sig)))break;
    out.push(t.o.replace(/[,:;.]+$/,''));if(/[,:;]$/.test(t.o))break;}
  while(out.length&&/^(de|del|a|al|el|la|los|las|y|con|en|para|por|que)$/.test(norm(out[out.length-1])))out.pop();
  return out.length?cap(out[0].toLowerCase())+(out.length>1?' '+out.slice(1).join(' '):''):'';}
// Una rutina dicha como evento que se repite («evento semanal», «todos los martes», «de lunes a viernes»), o null.
function rutinaSemanal(toks,ns,iC){
  const iV=toks.findIndex(t=>t.n!=='evento'&&EVENTO.test(t.n)),iG=toks.findIndex(t=>/^(evento|eventos|rutina|rutinas|actividad|actividades)$/.test(t.n.replace(/[^a-z]/g,'')));
  if(iV<0&&iG<0)return null;
  if(!(REPITE.test(ns)||RANGO_DIAS.test(ns)||parseDays(ns).length>=3))return null;
  let type,name;
  if(iV>=0){name=frasePropia(toks,iV);type=catEvento(name);}   // «Reunión de equipo», «Cita con la psicóloga»
  else if(iC>=0){type=COMMIT_KW[toks[iC].n];name=nombreRutina(toks,iC,type);}   // «evento semanal de almuerzo» → Almuerzo
  else{let j=iG+1;while(j<toks.length&&/^(semanal|semanales|fijo|fija|fijos|recurrente|de|del|un|una|mi|el|la|para)$/.test(toks[j].n.replace(/[^a-z]/g,'')))j++;
    name=frasePropia(toks,j);type=catEvento(name);
    // Sin nombre, solo si se pide crearla («crea un evento semanal de lunes a viernes de 7 a 8»).
    if(!name){if(!/\b(crea|creame|crear|agrega|agregame|agregar|anade|anademe|anota|anotame|pon|ponme|registra|registrame|programa|programame|agenda|agendame)\b/.test(ns))return null;name='Evento';}}
  return rutinaDicha(ns,type,name);}
// "No tengo clases", "cancelaron mi clase", "hoy no voy a trabajar": ese compromiso no va ese día.
const NO_VA=/\b(cancelaron|cancelo|suspendieron|suspendio|no hay|no tengo|no tendre|no voy a (?:ir|tener|trabajar)|no voy al?|no ire|no trabajo|no entro)\b/;
const ESTUDIE=/\b(estudie|repase|avance|practique|adelante|le meti)\b/;
// «Avancé el informe» es estudio hecho; «una entrega de un avance del proyecto» o «el primer avance», algo que se entrega
// (salvo que diga cuánto: «hice un avance de 2 horas»).
const AVANCE_SUST=/\b(un|el|del|al|mi|tu|su|primer|segundo|tercer|cuarto|ultimo|otro|nuevo|este|ese|cada|de)\s+avances?\b/g;
const estudie=ns=>ESTUDIE.test(minutosDichos(ns)?ns:ns.replace(AVANCE_SUST,' '));
// Frases nuevas del 2-nov-2026 (incluida la del supervisor): quitar una rutina, cambiar la hora de entrada de un día
// y pedir que Lía agende algo.
const QUITAR_RUT=/\b(borra|borrame|borrar|elimina|eliminame|eliminar|quita|quitame|quitar|saca|sacame|sacar)\b/;
const ENTRO=/\b(entro|entrare|ingreso|ingresare|empiezo|empezare|comienzo|comenzare)\b/;
// «En vez de (entrar a) las 9», «en lugar de las 8»: la hora de siempre, que no es la nueva.
const EN_VEZ=new RegExp(`\\b(?:en vez de|en lugar de)\\s+(?:(?:entrar|salir|ir|empezar|comenzar|ingresar)\\s+)?(?:(?:a|desde)\\s+)?(?:las?\\s+)?(\\d{1,2})(?::(\\d{2}))?(?:\\s*(am|pm))?`);
// Cambiar para siempre una rutina que ya está.
const CAMBIA_RUT=/\b(cambia|cambiame|cambiar|cambie|mueve|mueveme|mover|ahora (?:es|son|sera|seran|empieza|empiezan|termina|terminan|salgo|entro)|ya no es)\b/;
const AGENDAR=/^(agenda|agendame|agendes|agendar|agendarme|agendalo|agendala|programa|programame|programes|programar|reserva|reservame|reservar|separame|apartame|bloquea|bloqueame|anota|anotame|anotes|apunta|apuntame)$/;
// Las rutinas que nombra una frase: por su nombre («la clase de inglés» → Inglés) o, si no, por su tipo.
function rutinasNombradas(toks,ns,state){const gs=agruparRutinas(state.commitments);
  const ws=ns.split(' ').filter(w=>w.length>3&&!QUITAR_RUT.test(w)&&!/^(rutinas?|clases?|cursos?|horario|mis?|todas?)$/.test(w));
  const nombradas=gs.filter(g=>norm(g.name).split(/[^a-z0-9]+/).some(w=>ws.includes(w)));if(nombradas.length)return nombradas;
  const tipos=toks.filter(t=>COMMIT_KW[t.n]).map(t=>COMMIT_KW[t.n]);return gs.filter(g=>tipos.includes(g.type));}
// Qué es lo que se pide agendar: las palabras que siguen al verbo hasta la fecha o la hora («un repaso de cálculo el
// jueves de 4 a 6» → «Repaso de cálculo»). Vacío si no lo dice («agéndame para mañana a las 10»).
function queAgendar(toks,i){const T=t=>!!t&&(/^(hoy|manana|pasado|mediodia|medianoche|madrugada)$/.test(t.n)||DAYW[t.n]!=null||/^\d/.test(t.n));
  const CON=/^(a|al|de|del|el|la|las|para|desde|entre|este|esta|proximo|proxima|en|por|hasta)$/,out=[];
  for(let j=i+1;j<toks.length;j++){const t=toks[j];if(T(t)||t.n===','||t.n==='hasta'||(CON.test(t.n)&&(T(toks[j+1])||/^(las?|proxim[oa]|este|esta)$/.test((toks[j+1]||{}).n||''))))break;out.push(t);}
  while(out.length&&/^(que|me|te|un|una|unos|unas|el|la|los|las|mi|mis|para|por|favor|porfa|algo|es|seria|sera)$/.test(out[0].n))out.shift();
  while(out.length&&/^(de|a|al|el|la|para|en|y|por|que)$/.test(out[out.length-1].n))out.pop();
  const l=out.map(t=>t.o).join(' ').slice(0,40);return l?l.charAt(0).toUpperCase()+l.slice(1):'';}
function minutosDichos(ns){let m=ns.match(/\b(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hora|horas)\b(\s*y\s*media)?/);
  if(m)return Math.round(parseFloat(m[1].replace(',','.'))*60)+(m[2]?30:0);
  m=ns.match(/\b(\d+)\s*(?:min|mins|minuto|minutos)\b/);if(m)return +m[1];
  if(/\b(una|un)\s+hora\s+y\s+media\b|\bhora y media\b/.test(ns))return 90;
  if(/\bmedia hora\b/.test(ns))return 30;
  m=ns.match(/\b(una|un|dos|tres|cuatro|cinco)\s+horas?\b(\s+y\s+media)?/);if(m)return(m[1]==='un'?1:NUMW[m[1]])*60+(m[2]?30:0);
  return null;}
function fechaPasada(ns,now){if(/\banteayer\b/.test(ns))return ymd(addDays(now,-2));if(/\b(ayer|anoche)\b/.test(ns))return ymd(addDays(now,-1));
  for(const [w,wd] of Object.entries(DAYW))if(new RegExp(`\\b${w}\\b`).test(ns))return ymd(addDays(now,-((now.getDay()-wd+7)%7)));
  return ymd(now);}
// La evaluación que menciona la frase: por su nombre completo o por su primera palabra ("cálculo" → "Cálculo II").
function evalMencionada(ns,state,now){const t=ymd(now);let mejor=null,peso=0;
  const orden=state.evals.slice().sort((a,b)=>(a.date<t)-(b.date<t)||a.date.localeCompare(b.date));
  for(const e of orden){const c=norm(e.course).replace(/[^a-z0-9 ]/g,' ').trim();const w=c.split(/\s+/).find(x=>x.length>2);
    const p=c&&new RegExp(`\\b${c}\\b`).test(ns)?2:w&&new RegExp(`\\b${w}\\b`).test(ns)?1:0;if(p>peso){mejor=e;peso=p;}}
  return mejor;}
// ---------- Cambiar o quitar una evaluación que ya está ----------
// «Me cambiaron el examen de cálculo al viernes», «ya no tengo el parcial de física». Antes Lía lo leía como una
// evaluación nueva y la duplicaba. Solo cuenta si lo que cambió va junto a una evaluación («cambiaron el examen»,
// «el parcial de física ahora es…»), para no confundirlo con «ya no tengo tiempo para el examen».
// Los verbos firmes bastan («me cambiaron el examen»: Lía pregunta la fecha nueva); los débiles («pasaron», «ahora es»)
// necesitan una fecha o una hora nueva.
const MUEVE_FIRME=/^(cambiaron|cambio|cambie|cambia|cambiar|movieron|movio|movi|mueve|mover|postergaron|postergo|posterga|postergar|aplazaron|aplazo|aplaza|aplazar|reprogramaron|reprogramo|reprograma|reprogramar|adelantaron|retrasaron|corrieron)$/;
const MUEVE_DEBIL=/^(pasaron|paso|pasa|pasar)$/;
const QUITA_EVAL=/^(cancelaron|cancelo|suspendieron|suspendio|anularon|anulo|borra|borrar|elimina|eliminar|quita|quitar|saca|sacar)$/;
const JUNTO_PASA=new Set(['el','la','los','las','lo','le','me','mi','mis','su','sus','un','una','ese','esa','este','esta','fecha','hora','dia','del','de','proximo','proxima']);
const JUNTO_CORTA=new Set(['y',',','que','para','tiempo','pero','porque','cuando','si','ni','o']);
// Una palabra que nombra una evaluación: «examen», «pc2», «informe»; «trabajo» solo si es «trabajo final» y parecidos.
function esEvalTok(toks,j){const t=toks[j];if(!t)return false;
  return !!EVAL_KW[t.n]||(ENTREGA_N.has(t.n)&&(t.n!=='trabajo'||TRABAJO_ENTREGA.test((toks[j+1]||{}).n||'')));}
// ¿La evaluación va junto a lo que cambió? Después (salteando artículos y la fecha vieja) o poco antes, sin otra idea en medio.
function evalJunto(toks,i0,i1){
  for(let j=i1;j<toks.length&&j<i1+6;j++){if(esEvalTok(toks,j))return true;const n=toks[j].n;
    if(!(JUNTO_PASA.has(n)||DAYW[n]!==undefined||MESN[n]||/^\d{1,2}$/.test(n)))break;}
  for(let j=i0-1;j>=0&&j>=i0-7;j--){if(esEvalTok(toks,j))return true;const n=toks[j].n;if(JUNTO_CORTA.has(n)||COMMIT_KW[n])break;}
  // «…y lo pasaron al jueves»: el pronombre apunta a la evaluación que se nombró antes.
  return /^(lo|la|los|las)$/.test((toks[i0-1]||{}).n||'')&&toks.slice(0,i0).some((_,j)=>esEvalTok(toks,j));}
// Lo que dice la frase que cambió: [{accion:'mover'|'quitar', firme}] (solo los que van junto a una evaluación).
function disparadores(toks){const out=[];
  for(let i=0;i<toks.length;i++){const w=toks[i].n,a=(toks[i+1]||{}).n||'',b=(toks[i+2]||{}).n||'';let d=null;
    if(w==='ya'&&a==='no'&&/^(tengo|tendre|hay|habra|va|sera|es)$/.test(b))d={accion:/^(sera|es)$/.test(b)?'mover':'quitar',firme:!/^(sera|es)$/.test(b),i1:i+3};
    else if(w==='ahora'&&/^(es|sera)$/.test(a))d={accion:'mover',firme:false,i1:i+2};
    else if(w==='nueva'&&a==='fecha')d={accion:'mover',firme:false,i1:i+2};
    else if(MUEVE_FIRME.test(w))d={accion:'mover',firme:true,i1:i+1};
    else if(MUEVE_DEBIL.test(w))d={accion:'mover',firme:false,i1:i+1};
    else if(QUITA_EVAL.test(w))d={accion:'quitar',firme:true,i1:i+1};
    if(d&&evalJunto(toks,i,d.i1))out.push(d);}
  return out;}
// La fecha y la hora nuevas. Lo nuevo va después de «al», «para», «ahora es» o «es el» («del lunes al jueves»,
// «ya no es el lunes, es el martes»); si no hay esas palabras, la única fecha que se dijo (suelta) puede ser la vieja.
function fechaHoraNueva(ns,now){const partes=ns.replace(/\bya no (?:es|sera)\b/g,' ya-no ').split(/\b(?:al|para|ahora es|ahora sera|es|sera)\b/);let date='';  // «ya no es el lunes»: el lunes es la vieja
  for(let i=partes.length-1;i>=1&&!date;i--)date=parseDate(partes[i],now)||'';
  const hs=[...ns.matchAll(new RegExp(`\\b(?:a las|a la)\\s+${HQ}`,'g'))],h=hs[hs.length-1];
  return{date,suelta:partes.length===1?parseDate(ns,now)||'':'',antes:parseDate(partes[0],now)||'',time:h?fmt(adj(h[1],h[2],h[3],h[4]||partOf(ns))):''};}
// Las evaluaciones próximas a las que se refiere la frase: por su curso y, si hay varias, por su tipo y su fecha.
// «Examen» vale también para un parcial o un final (así les dicen muchos).
function evalesAludidas(dicho,toks,ns,antes,state,now){const t=ymd(now),prox=state.evals.filter(e=>e.date>=t);
  const tipos=new Set(toks.filter((x,j)=>esEvalTok(toks,j)).map(x=>EVAL_KW[x.n]||'entrega'));
  if(tipos.has('examen')){tipos.add('parcial');tipos.add('final');}
  const palabras=c=>norm(c).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>2&&!SKIPW.has(w)&&!EVAL_KW[w]&&!ENTREGA_N.has(w));
  let cs=prox.filter(e=>palabras(e.course).some(w=>new RegExp(`\\b${w}\\b`).test(ns)));
  if(cs.length){const c2=cs.filter(e=>tipos.has(e.type));if(c2.length)cs=c2;}
  else if(dicho&&palabras(dicho.course).length)return[];  // nombró un curso que no está
  else cs=prox.filter(e=>tipos.has(e.type));
  // «El parcial del miércoles»: el de esa fecha o, si no hay, el que cae ese día de la semana (puede ser el de la otra semana).
  if(cs.length>1&&antes){const wd=fromYmd(antes).getDay(),diaDicho=Object.keys(DAYW).some(w=>DAYW[w]===wd&&new RegExp(`\\b${w}\\b`).test(ns));
    const c2=cs.filter(e=>e.date===antes),c3=diaDicho?cs.filter(e=>fromYmd(e.date).getDay()===wd):[];if(c2.length)cs=c2;else if(c3.length)cs=c3;}
  return cs.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));}
// Devuelve la intención (cambiaEval, quitaEval, la pregunta de lo que falta o un aviso), o null si la frase no cambia
// ni quita una evaluación. Si no encuentra la evaluación que cambió, devuelve null y la frase se lee como una nueva.
function cambioDeEval(text,state,now){const toks=tokenize(text),ns=toks.map(t=>t.n).join(' ');
  const ds=disparadores(toks);if(!ds.length)return null;
  const nv=fechaHoraNueva(ns,now),hay=!!(nv.date||nv.suelta||nv.time);
  const mover=ds.find(d=>d.accion==='mover'&&(d.firme||hay)),quitar=ds.find(d=>d.accion==='quitar');
  const accion=mover&&(!quitar||hay)?'mover':quitar?'quitar':null;if(!accion)return null;
  const dicho=parseClause(toks,now,null,state.settings,state),ref=dicho&&dicho.kind==='eval'?dicho:{type:'parcial',course:''};
  const cs=evalesAludidas(dicho&&dicho.kind==='eval'?dicho:null,toks,ns,nv.antes,state,now);
  if(!cs.length)return accion==='quitar'?{intent:'aviso',texto:`No encontré ${nombreEval(ref)} entre tus evaluaciones próximas, así que no hay nada que quitar.`,deCambio:true}:null;
  const it={kind:'cambio',accion,evalId:'',type:ref.type,course:ref.course,date:'',time:'',cands:cs.slice(0,4).map(e=>e.id)};
  if(cs.length===1)Object.assign(it,{evalId:cs[0].id,type:cs[0].type,course:cs[0].course});
  if(accion==='mover'){const una=cs.length===1?cs[0]:null;
    it.date=nv.date||(nv.suelta&&!cs.some(e=>e.date===nv.suelta)?nv.suelta:'');
    it.time=nv.time&&!(una&&!it.date&&nv.time===una.time)?nv.time:'';}
  return continuarBorrador({intent:'cambio',items:[it]},state,now);}
// «¿Cuándo es la práctica de física?», «¿a qué hora es mi parcial de cálculo?»: la fecha de esa evaluación (antes
// respondía la próxima evaluación, fuera la que fuera). Sin curso («¿cuándo es mi próximo examen?») o con una fecha
// nueva («el parcial es el viernes, ¿cuándo estudio?»), null: lo ven las reglas de siempre.
function cuandoEsEval(toks,ns,state,now){
  if(!/\b(cuando|que dia|que fecha|a que hora)\b/.test(ns)||!toks.some((t,j)=>esEvalTok(toks,j)))return null;
  const dicho=parseClause(toks,now,null,state.settings,state);if(!dicho||dicho.kind!=='eval'||!dicho.course||dicho.date)return null;
  const cs=evalesAludidas(dicho,toks,ns,'',state,now);
  if(!cs.length)return{intent:'aviso',texto:`No encontré ${nombreEval(dicho)} entre tus evaluaciones próximas.`};
  const e=cs[0],k=dayDiff(ymd(now),e.date);
  return{intent:'aviso',texto:`${cap(nombreEval(e))} ${e.type==='entrega'?'vence':'es'} ${k===0?'hoy':k===1?'mañana':'el '+fechaLarga(e.date)} a las ${e.time}.`};}
// ---------- Quitar algo del horario (iteración 3, revisión de Coconut del 4-nov-2026) ----------
// «Elimina el evento del lunes a la 1:00 pm», «borra lo del martes a las 3», «cancelaron la reunión del jueves». Antes
// Lía creaba un evento nuevo. Ahora busca lo que hay ese día a esa hora (o lo que se nombra) y propone quitarlo:
// - un evento de un día: {intent:'quitaEvento',exId,date}; una evaluación: {intent:'quitaEval',evalId}, como siempre;
// - una rutina: pregunta si solo ese día (se libera, como «mañana no tengo clases») o toda la rutina
//   ({intent:'quitaRutina',ids,name}). La app pide confirmar antes de borrar (textoQuitar, sinLoQuitado);
// - si no hay nada, lo dice. Las evaluaciones nombradas («borra el parcial de física») las ve cambioDeEval.
const QUITAR=/\b(borra|borrame|borrar|borralo|borrala|elimina|eliminame|eliminar|eliminalo|eliminala|quita|quitame|quitar|quitalo|quitala|saca|sacame|sacar|sacalo|sacala|cancela|cancelame|cancelar|cancelalo|cancelala|anula|anular|anulalo|anulala)\b/;
const YA_NO_HAY=/\b(cancelaron|cancelo|suspendieron|suspendio|ya no (?:tengo|tendre|hay|habra|va)|no (?:voy a (?:poder )?(?:ir|asistir)|podre (?:ir|asistir)|puedo (?:ir|asistir)|ire|asistire|voy (?:al|a la)))\b/;
// Palabras que no nombran lo que se quita («el evento», «lo del lunes», «mi compromiso de mañana»).
const NO_NOMBRE=new Set(['cancelaron','cancelo','suspendieron','suspendio','ya','no','tengo','tendre','hay','habra','va','tenia','habia','voy','ir','ire','poder','puedo','podre','asistir','asistire',
  'el','la','los','las','lo','un','una','unos','unas','de','del','a','al','en','por','para','con','sin','mi','mis','tu','tus','su','sus','que','y','o','e',
  'evento','eventos','actividad','actividades','cosa','cosas','algo','todo','toda','todos','todas','eso','esto','esa','ese','esta','este','compromiso','compromisos',
  'pendiente','pendientes','plan','planes','rutina','rutinas','horario','agenda','calendario','hoy','manana','pasado','proximo','proxima','siguiente','semana','dia','dias',
  'tarde','noche','madrugada','mediodia','medianoche','am','pm','hr','hrs','hora','horas','lia','oye','porfa','favor','please','nomas','solo','tambien','me','te','nos','le','les','se']);
const esNombreQuitar=t=>{const w=t.n.replace(/[^a-z0-9]/g,'');return w.length>=3&&!QUITAR.test(w)&&!NO_NOMBRE.has(w)&&DAYW[w]===undefined&&!MESN[w]&&!/^\d/.test(w);};
const nombreQuitar=toks=>toks.filter(esNombreQuitar).map(t=>t.n.replace(/[^a-z0-9]/g,''));
// Lo nombrado como lo escribió la persona, para decir «No encontré «cita con el dentista»»: de la primera palabra que
// nombra a la última, con hasta dos palabras de enlace en medio («con mi», «de»).
function nombreQuitarTexto(toks){const i=toks.findIndex(esNombreQuitar);if(i<0)return'';let fin=i;
  for(let j=i+1;j<toks.length;j++){if(esNombreQuitar(toks[j])){fin=j;continue;}if(/^(de|del|con|y|mi|mis|su|sus|la|el|los|las|al|a)$/.test(toks[j].n)&&j-fin<=2)continue;break;}
  return toks.slice(i,fin+1).map(t=>t.o).join(' ').replace(/[¿?¡!.,;:]+/g,'');}
// Cuánto se parece lo nombrado a algo del horario: palabras en común (o abreviadas) y el tipo de la rutina («chamba» → Trabajo).
function puntosNombre(ws,c){const cw=norm(c.label||'').split(/[^a-z0-9]+/).filter(w=>w.length>=3);let p=0;
  for(const w of ws){const tipo=COMMIT_KW[w];
    if(cw.includes(w)||w.length>=4&&cw.some(v=>v.length>=4&&(v.startsWith(w)||w.startsWith(v)))||tipo&&tipo!=='otro'&&(c.t==='rutina'?c.type===tipo:c.t==='evento'&&c.cat===tipo))p++;}
  return p;}
// Lo que hay un día: rutinas y eventos (sin lo ya liberado; de una rutina que viene de anoche, d es el día en que empezó)
// y evaluaciones, en orden.
function cosasDelDia(state,date){const prev=ymd(addDays(fromYmd(date),-1)),out=[];
  for(const b of busyFor(state,date)){const ev=b.kind==='excepcion',o=ev?state.exceptions.find(x=>x.id===b.ref):state.commitments.find(x=>x.id===b.ref);if(!o)continue;
    out.push({t:ev?'evento':'rutina',id:o.id,d:ev?o.date:b.cola?prev:date,s:b.s,e:b.e,cola:!!b.cola,label:ev?o.label:o.name,type:o.type,cat:o.cat});}
  for(const e of state.evals)if(e.date===date&&HHMM.test(e.time||'')){const s=toMin(e.time);out.push({t:'eval',id:e.id,d:date,s,e:s+120,cola:false,label:e.course});}
  return out.sort((a,b)=>a.s-b.s);}
// «hoy», «mañana», «el jueves», «el lunes 2» (dentro de 7 días, para no confundirlo con hoy) o «el lun 9 nov».
function elDia(f,now){const k=dayDiff(ymd(now),f),d=fromYmd(f),w=DIAS[d.getDay()];
  return k===0?'hoy':k===1?'mañana':k>1&&k<7?`el ${w}`:k===7?`el ${w} ${d.getDate()}`:`el ${fechaCorta(f)}`;}
// La hora como la dice la persona: «a la 1:00 p. m.», «a las 8:00 a. m.».
const aLa=m=>{const h=Math.floor(m/60)%24,h12=h%12||12;return `a ${h12===1?'la':'las'} ${h12}:${pad(m%60)} ${h<12?'a. m.':'p. m.'}`;};
const conPunto=t=>/\.$/.test(t)?t:t+'.';   // «…a las 3:00 p. m.» ya termina en punto
// Los días de una rutina: «de lunes a viernes», «los fines de semana», «los martes y jueves».
function diasRutina(days){const s=[...new Set(days||[])].sort((a,b)=>((a+6)%7)-((b+6)%7)),l=s.map(d=>(d+6)%7);
  if(s.length===7)return'todos los días';if(s.join()==='6,0')return'los fines de semana';
  if(s.length>=3&&l.every((v,i)=>!i||v===l[i-1]+1))return`de ${DIAS[s[0]]} a ${DIAS[s[s.length-1]]}`;
  const p=s.map(d=>DIAS[d]+(d===0||d===6?'s':''));return'los '+(p.length>1?p.slice(0,-1).join(', ')+' y '+p[p.length-1]:p[0]||'');}
const avisoQuitarRutina=gs=>({intent:'aviso',texto:gs.length===1?`Para quitar «${gs[0].name}» de tus rutinas, ábrela en Perfil, en «Tus rutinas», y toca «Eliminar rutina». Así ves qué se borra antes de borrarlo.`
  :`Tienes varias rutinas así: ${gs.map(g=>g.name).join(', ')}. Elige cuál quitar en Perfil, en «Tus rutinas».`});
// Devuelve la intención, o null si la frase no pide quitar algo del horario.
function quitarAlgo(toks,ns,state,now){
  const ya=YA_NO_HAY.test(ns)&&EVENTO.test(ns)&&!toks.some(t=>COMMIT_KW[t.n]);   // «ya no tengo clases» lo ve NO_VA
  if(!QUITAR.test(ns)&&!ya)return null;
  if(toks.some((t,j)=>esEvalTok(toks,j))||/\bsac(?:a|ar|o|ame)\s+(?:una\s+)?(?:cita|turno|hora|consulta|ficha)\b/.test(ns))return null;   // «sacar cita» es pedirla
  if(!ya&&/\b(bloques?|estudiar|estudio|sesion|sesiones|repaso|repasar|tiempo)\b/.test(ns))return null;   // «sácame tiempo para estudiar»
  const ws=nombreQuitar(toks),nombre=nombreQuitarTexto(toks),fecha=parseDate(ns,now),tm=parseTimes(ns),hoy=ymd(now);
  // «A las 8» puede ser 08:00 o 20:00: primero la lectura de siempre y, si ahí no hay nada, la otra.
  const h0=tm.range?tm.range[0]:tm.at!=null?tm.at:tm.until!=null?tm.until:null;
  const horas=h0==null?[]:[h0,...(tm.crudo&&!tm.range?horasPosibles(...tm.crudo):[])].filter((v,i,a)=>a.indexOf(v)===i);
  const mejores=l=>{if(!ws.length)return l;const p=l.map(c=>puntosNombre(ws,c)),m=Math.max(0,...p);return m?l.filter((c,k)=>p[k]===m):[];};
  if(!fecha&&!horas.length){if(!ws.length)return null;
    // Sin día ni hora: lo próximo que se llame así. Una rutina por su nombre se quita en Perfil (decisión del 2-nov).
    const evs=state.exceptions.filter(x=>!x.libre&&x.date>=hoy).map(x=>({t:'evento',id:x.id,d:x.date,s:toMin(x.start),label:x.label,cat:x.cat}));
    const vs=state.evals.filter(e=>e.date>=hoy).map(e=>({t:'eval',id:e.id,d:e.date,s:toMin(e.time||'00:00'),label:e.course}));
    const sel=mejores([...evs,...vs]).sort((a,b)=>(a.d+fmt(a.s)).localeCompare(b.d+fmt(b.s)));
    if(sel.length)return propuestaQuitar(sel,'',null,state,now);
    const gs=rutinasNombradas(toks,ns,state);if(gs.length)return avisoQuitarRutina(gs);
    return EVENTO.test(ns)?{intent:'aviso',texto:`No encontré «${nombre}» en tu horario.`}:null;}
  const D=fecha||hoy,todas=cosasDelDia(state,D);let sel=[],T=horas.length?horas[0]:null;
  if(horas.length){
    // Lo que empieza a esa hora va antes que lo que solo la cruza («la reunión de las 10» en medio de las clases).
    for(const h of horas){const empieza=mejores(todas.filter(c=>!c.cola&&c.s===h)),cruza=mejores(todas.filter(c=>c.s<h&&h<c.e));
      const l=empieza.length?empieza:cruza;if(l.length){sel=l;T=h;break;}}
    if(!sel.length&&ws.length)sel=mejores(todas);}   // lo nombrado ese día, aunque la hora no coincida: la propuesta muestra la suya
  else if(tm.part){const [a,b]=FRANJA_EVENTO[tm.part];sel=mejores(todas.filter(c=>c.s<b&&c.e>a));}
  else sel=mejores(todas);
  sel=sel.filter((c,k)=>sel.findIndex(x=>x.t===c.t&&x.id===c.id&&x.d===c.d)===k);
  if(!sel.length){const cuando=elDia(D,now)+(T!=null?' '+aLa(T):'');
    return{intent:'aviso',texto:ws.length?conPunto(`No encontré «${nombre}» ${cuando}`):T!=null?`${cap(cuando)} no tienes nada.`:`${cap(cuando)} no tienes nada en tu horario.`};}
  return propuestaQuitar(sel,D,T,state,now);}
function propuestaQuitar(sel,D,T,state,now){
  const it={kind:'quitar',date:D,hora:T,cands:sel.slice(0,6).map(c=>({t:c.t,id:c.id,d:c.d})),t:'',id:'',d:'',alcance:''};
  if(sel.length===1)Object.assign(it,{t:sel[0].t,id:sel[0].id,d:sel[0].d});
  return continuarBorrador({intent:'quitar',items:[it]},state,now);}
// Lo elegido para quitar (x: {t,id,d}), como opción de una respuesta rápida.
function cosaQuitar(state,x){
  if(x.t==='evento'){const o=state.exceptions.find(y=>y.id===x.id);if(!o)return null;
    return{t:'evento',label:o.label,cat:o.cat,start:o.start,opcion:`${o.label} (${o.start}–${o.end})`,conFecha:`${o.label} (${fechaCorta(o.date)}, ${o.start})`};}
  if(x.t==='eval'){const e=state.evals.find(y=>y.id===x.id);if(!e)return null;const l=`${(EVAL_TYPES[e.type]||EVAL_TYPES.parcial).label} de ${e.course}`;
    return{t:'eval',label:e.course,start:e.time,opcion:`${l} (${e.time})`,conFecha:`${l} (${fechaCorta(e.date)}, ${e.time})`};}
  const c=state.commitments.find(y=>y.id===x.id);if(!c)return null;
  return{t:'rutina',label:c.name,type:c.type,start:c.start,opcion:`${c.name} (${c.start}–${c.end})`,conFecha:`${c.name} (${c.start}–${c.end})`};}
// «¿Cuál quito?» respondido con palabras: por su nombre, por su hora o «la primera».
function cualQuitar(p,toks,tm,state){const cs=(p.cands||[]).map(x=>({x,c:cosaQuitar(state,x)})).filter(o=>o.c),ws=nombreQuitar(toks);
  if(ws.length){const pts=cs.map(o=>puntosNombre(ws,o.c)),m=Math.max(0,...pts),l=cs.filter((o,k)=>m>0&&pts[k]===m);if(l.length===1)return l[0].x;}
  const hs=tm.range?[tm.range[0]]:tm.crudo?horasPosibles(...tm.crudo):tm.at!=null?[tm.at]:[];
  if(hs.length){const l=cs.filter(o=>hs.includes(toMin(o.c.start)));if(l.length===1)return l[0].x;}
  const ord=['primer','primero','primera','segundo','segunda','tercer','tercero','tercera','cuarto','cuarta'].findIndex(w=>toks.some(t=>t.n===w));
  if(ord>=0){const o=cs[[0,0,0,1,1,2,2,2,3,3][ord]];if(o)return o.x;}
  return null;}
// «¿Solo ese día o toda la rutina?» respondido con palabras.
function alcanceDicho(ns){const s=ns.trim();
  if(/\b(toda|todas|todos|siempre|completa|completo|entera|entero|definitivamente)\b/.test(s)||/^(la )?rutina$/.test(s))return'rutina';
  if(/\b(solo|solamente|nomas|unicamente|esa vez|una vez|ese|este|esa|esta)\b/.test(s)||/\b(hoy|manana)\b/.test(s)&&s.split(/\s+/).length<=3)return'dia';
  if(/^(no|nada|ninguno|ninguna)\b|\b(mejor no|dejalo|dejala|deja|asi esta bien|no (?:lo |la )?quites)\b/.test(s))return'nada';
  return null;}
function finQuitar(x,state){
  if(x.t==='evento')return{intent:'quitaEvento',exId:x.id,date:x.d};
  if(x.t==='eval')return{intent:'quitaEval',evalId:x.id};
  if(x.alcance==='nada')return{intent:'aviso',texto:'Listo, lo dejo como está.'};
  const c=state.commitments.find(y=>y.id===x.id);if(!c)return{intent:'aviso',texto:'Esa rutina ya no está en tu horario.'};
  if(x.alcance==='dia'){const ex={date:x.d,start:c.start,end:c.end,label:`Sin ${c.name}`,libre:true,ref:c.id};return{intent:'except',exs:[ex],ex};}
  return{intent:'quitaRutina',ids:c.grupo?state.commitments.filter(y=>y.grupo===c.grupo).map(y=>y.id):[c.id],name:c.name};}
// Para la app: qué se va a quitar («quitar «Reunión de grupo» del jue 29 oct (10:00–11:00)») y el horario sin eso, sin
// tocar el estado. Al quitar algo se quita también lo que se había liberado de eso.
function textoQuitar(state,r){
  if(r.intent==='quitaEvento'){const x=state.exceptions.find(y=>y.id===r.exId);return x?`quitar «${x.label}» del ${fechaCorta(x.date)} (${x.start}–${x.end})`:'';}
  if(r.intent==='quitaRutina'){const cs=state.commitments.filter(c=>(r.ids||[]).includes(c.id));if(!cs.length)return'';
    return`quitar la rutina «${cs[0].name}» (${cs.map(c=>`${diasRutina(c.days)}, ${c.start}–${c.end}`).join('; ')})`;}
  return'';}
function sinLoQuitado(state,r){const fuera=new Set(r.intent==='quitaEvento'?[r.exId]:r.intent==='quitaRutina'?(r.ids||[]):[]);
  return{commitments:state.commitments.filter(c=>!fuera.has(c.id)),exceptions:state.exceptions.filter(x=>!fuera.has(x.id)&&!(x.libre&&fuera.has(x.ref)))};}
// ---------- Lía pide lo que falta (iteración 2) ----------
// Lo que necesita cada cosa para guardarse; nada se guarda sin hora (decisión 4). Si falta algo, Lía lo pregunta, una
// cosa a la vez y con respuestas rápidas, y guarda lo entendido como borrador por 10 minutos (state.borrador).
const BORRADOR_MS=10*60000;
const FRANJA_RUTINA={manana:[480,720],tarde:[840,1080],noche:[1140,1320]};   // las mismas del formulario de rutinas
const FRANJA_EVENTO={manana:[480,720],tarde:[900,1140],noche:[1140,1380]};
const CAT_EVENTO={cumpleanos:'ocio',fiesta:'ocio',matrimonio:'ocio',boda:'ocio',concierto:'ocio',partido:'deporte',velorio:'casa'};
function faltaDe(it){if(!it)return null;
  if(it.kind==='eval')return !it.course?'curso':!it.date?'fecha':!it.time?'hora':null;
  if(it.kind==='commit')return !(it.days&&it.days.length)?'dias':!(it.start&&it.end)?'horario':null;
  if(it.kind==='evento')return it.que&&!it.label?'que':!it.date?'fecha':!(it.start&&it.end)?'horario':null;
  if(it.kind==='log')return !it.evalId?'evaluacion':!it.min?'minutos':null;
  if(it.kind==='cambio')return !it.evalId?'evaluacion':it.accion==='mover'&&!it.date&&!it.time?'fecha':null;
  if(it.kind==='quitar')return !it.id?'cual':it.t==='rutina'&&!it.alcance?'alcance':null;
  return null;}
const minus=s=>s.charAt(0).toLowerCase()+s.slice(1);
// «tu examen de Inglés», «tu informe de Química» (una entrega con nombre propio ya lo dice).
function nombreEval(it){const t=EVAL_TYPES[it.type]||EVAL_TYPES.parcial,propio=it.type==='entrega'&&/^(tareas?|proyecto|monografia|informe|ensayo|trabajo)\b/.test(norm(it.course||''));
  return `tu ${propio?minus(it.course):t.label.toLowerCase()+(it.course?' de '+it.course:'')}`;}
const conArticulo=s=>`${/^(cita|reunion|fiesta|boda|consulta|entrevista|clase|practica|chamba)\b/.test(norm(s))?'la':'el'} ${minus(s)}`;
// «de hoy», «de mañana», «del sábado» (esta semana) o «del jue 5 nov».
function delDia(f,now){const k=dayDiff(ymd(now),f);return k===0?'de hoy':k===1?'de mañana':k>1&&k<7?`del ${DIAS[fromYmd(f).getDay()]}`:`del ${fechaCorta(f)}`;}
const otra=(t,ph)=>({t,otra:true,ph});
// Qué preguntar y qué respuestas rápidas ofrecer. Cada respuesta rápida completa el borrador sin volver a leer el texto.
function preguntaPara(it,falta,state,now){
  const dias=()=>[1,2,3].map(k=>{const f=ymd(addDays(now,k)),d=fromYmd(f);return{t:`${cap(DIAS[d.getDay()].slice(0,3))} ${d.getDate()}`,set:{date:f}};});
  const franja=(F,ls)=>ls.map(([k,l])=>({t:`${l} (${fmt(F[k][0])}–${fmt(F[k][1])})`,set:{start:fmt(F[k][0]),end:fmt(F[k][1])}}));
  if(it.kind==='cambio'){
    if(falta==='evaluacion'){const es=(it.cands||[]).map(id=>state.evals.find(e=>e.id===id)).filter(Boolean);
      return{texto:it.accion==='quitar'?'¿Cuál de estas evaluaciones quito?':'¿Cuál de estas evaluaciones cambió?',
        opciones:es.map(e=>({t:`${(EVAL_TYPES[e.type]||EVAL_TYPES.parcial).label} de ${e.course} · ${fechaCorta(e.date)}`,set:{evalId:e.id,type:e.type,course:e.course}}))};}
    return{texto:`¿Para cuándo es ahora ${nombreEval(it)}?`,opciones:[...dias(),otra('Otra fecha','Escribe la fecha y la hora, por ejemplo: el viernes a las 8')]};}
  if(it.kind==='eval'){const n=nombreEval(it),ent=it.type==='entrega';
    if(falta==='curso')return{texto:`¿De qué curso es ${n}${it.date?' '+delDia(it.date,now):''}?`,opciones:[]};
    if(falta==='fecha')return{texto:ent?`¿Para qué día es ${n}?`:`¿Qué día es ${n}?`,opciones:[...dias(),otra('Otra fecha','Escribe la fecha, por ejemplo: el 12 de noviembre')]};
    return{texto:ent?`¿A qué hora vence ${n}?`:`¿A qué hora es ${n}${it.date?' '+delDia(it.date,now):''}?`,
      opciones:[...(ent?['23:59']:['08:00','14:00','19:00']).map(h=>({t:h,set:{time:h}})),otra('Otra hora','Escribe la hora, por ejemplo: a las 7 de la noche')]};}
  if(it.kind==='quitar'){const cs=(it.cands||[]).map(x=>({x,c:cosaQuitar(state,x)})).filter(o=>o.c);
    if(falta==='cual'){const donde=it.date?`${cap(elDia(it.date,now))}${it.hora!=null?' '+aLa(it.hora):''} tienes varias cosas.`:'Encontré varias cosas con ese nombre.';
      return{texto:`${donde} ¿Cuál quito?`,opciones:cs.map(({x,c})=>({t:it.date?c.opcion:c.conFecha,set:{t:x.t,id:x.id,d:x.d}}))};}
    const c=state.commitments.find(y=>y.id===it.id),k=dayDiff(ymd(now),it.date||it.d),f=fromYmd(it.date||it.d);
    const corto=k===0?'hoy':k===1?'mañana':`el ${DIAS[f.getDay()].slice(0,3)} ${f.getDate()}`,dr=c?diasRutina(c.days):'';
    return{texto:`«${c?c.name:'Esa rutina'}» es una rutina${c?` ${/^de /.test(dr)?dr:'de '+dr}, de ${c.start} a ${c.end}`:''}. ¿La quito solo ${elDia(it.date||it.d,now)} o toda la rutina?`,
      opciones:[{t:`Solo ${corto}`,set:{alcance:'dia'}},{t:'Toda la rutina',set:{alcance:'rutina'}},{t:'Dejarlo así',set:{alcance:'nada'}}]};}
  if(it.kind==='commit'){const n=minus(it.name||'eso');
    if(falta==='dias')return{texto:`¿Qué días tienes ${n}?`,opciones:[{t:'Lun a Vie',set:{days:[1,2,3,4,5]}},{t:'Fines de semana',set:{days:[6,0]}},otra('Otros días','Escribe los días, por ejemplo: martes y jueves')]};
    if(it.start&&!it.end){const s0=toMin(it.start);
      return{texto:`«${it.name||'Tu rutina'}» empieza a las ${it.start}. ¿Hasta qué hora es?`,opciones:[30,60,120].map(m=>({t:`Hasta las ${fmt(s0+m)}`,set:{end:fmt(s0+m)}})).concat(otra('Otra hora','Escribe la hora, por ejemplo: hasta las 9 de la noche'))};}
    return{texto:`¿De qué hora a qué hora tienes ${n}?`,opciones:[...franja(FRANJA_RUTINA,[['manana','Mañana'],['tarde','Tarde'],['noche','Noche']]),otra('Otra hora','Escribe el horario, por ejemplo: de 4 a 8 de la noche')]};}
  if(it.kind==='evento'&&falta==='que'){const k=it.date?dayDiff(ymd(now),it.date):null,cuando=it.date?(k===0?' hoy':k===1?' mañana':` el ${fechaCorta(it.date)}`):'';
    return{texto:`¿Qué quieres que agende${cuando}${it.start?` a las ${it.start}`:''}?`,opciones:[{t:'Una cita',set:{label:'Cita'}},{t:'Una reunión',set:{label:'Reunión'}},otra('Otra cosa','Escribe qué es, por ejemplo: repaso de cálculo')]};}
  if(it.kind==='evento'){const n=conArticulo(it.label||'Evento');
    if(falta==='fecha')return{texto:`¿Qué día es ${n}?`,opciones:[...dias(),otra('Otra fecha','Escribe la fecha, por ejemplo: el sábado')]};
    if(it.start&&!it.end){const s0=toMin(it.start);
      return{texto:it.preg||`Anoto ${n} ${delDia(it.date,now)} a las ${it.start}. ¿Hasta qué hora es?`,opciones:[60,120,180].map(m=>({t:`Hasta las ${fmt(s0+m)}`,set:{end:fmt(s0+m)}})).concat(otra('Otra hora','Escribe la hora, por ejemplo: hasta las 8 de la noche'))};}
    return{texto:`Anoto ${n} ${delDia(it.date,now)}. ¿De qué hora a qué hora es?`,opciones:[...franja(FRANJA_EVENTO,[['tarde','Tarde'],['noche','Noche']]),otra('Otra hora','Escribe el horario, por ejemplo: de 4 a 8 de la noche')]};}
  if(falta==='evaluacion'){const t=ymd(now),pr=state.evals.filter(e=>e.date>=t).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,3);
    return{texto:'¿Para qué evaluación estudiaste?',opciones:pr.map(e=>({t:`${(EVAL_TYPES[e.type]||EVAL_TYPES.parcial).label} de ${e.course}`,set:{evalId:e.id,course:e.course}}))};}
  return{texto:`¿Cuánto tiempo estudiaste${it.course?' para '+it.course:''}?`,opciones:[[30,'30 min'],[60,'1 h'],[120,'2 h']].map(([m,t])=>({t,set:{min:m}})).concat(otra('Otro','Escribe cuánto, por ejemplo: 45 minutos'))};}
// Un borrador sirve por 10 minutos (y si su forma es la de esta versión).
function borradorVigente(b,now){return!!b&&typeof b==='object'&&Array.isArray(b.items)&&!!b.items[b.i]&&Number.isFinite(b.at)&&now.getTime()-b.at<=BORRADOR_MS&&now.getTime()>=b.at-60000;}
// Sigue con un borrador: pregunta lo primero que falte o, si ya está todo, devuelve la intención de siempre.
function continuarBorrador(b,state,now){const i=b.items.findIndex(x=>faltaDe(x));
  if(i>=0){const it=b.items[i],f=faltaDe(it);let q=preguntaPara(it,f,state,now);if(f==='fecha'&&it.semana)q=preguntaSemana(q,it.semana,now);
    return{intent:'pregunta',texto:q.texto,opciones:q.opciones,borrador:{intent:b.intent,items:b.items,i}};}
  b={...b,items:b.items.map(({semana,...x})=>x)};
  if(b.intent==='except'){const exs=b.items.map(x=>({date:x.date,start:x.start,end:x.end,label:x.label,...(x.cat?{cat:x.cat}:{})}));return{intent:'except',exs,ex:exs[0]};}
  if(b.intent==='log'){const x=b.items[0];return{intent:'log',evalId:x.evalId,course:x.course,date:x.date,min:x.min};}
  if(b.intent==='cambio'){const x=b.items[0];return x.accion==='quitar'?{intent:'quitaEval',evalId:x.evalId}:{intent:'cambiaEval',evalId:x.evalId,date:x.date||'',time:x.time||''};}
  if(b.intent==='quitar')return finQuitar(b.items[0],state);
  return{intent:'add',items:b.items};}
// «La próxima semana tengo examen»: Lía pregunta qué día de esa semana, con los días de lunes a sábado.
function preguntaSemana(q,n,now){const cual=n===1?'la próxima semana':'la subsiguiente semana';
  const ops=[1,2,3,4,5,6].map(wd=>{const f=diaEnSemanas(wd,n,now),d=fromYmd(f);return{t:`${cap(DIAS[wd].slice(0,3))} ${d.getDate()}`,set:{date:f}};});
  return{texto:q.texto.replace(/qu[eé] d[ií]a /i,m=>`${m}de ${cual} `),opciones:ops.concat(q.opciones.filter(o=>o.otra))};}
// La respuesta a lo que Lía preguntó: completa el borrador con lo que se entiende, o null si no responde.
// Si el mensaje nombra otra actividad, es otra cosa y el borrador queda de lado.
function respuestaBorrador(b,q,state,now){const it=b&&b.items&&b.items[b.i],falta=faltaDe(it);if(!falta)return null;
  const toks=tokenize(q),ns=toks.map(t=>t.n).join(' ');if(!ns.trim())return null;
  // Para «¿De qué curso?» vale nombrar una entrega («del informe de química»), pero no otro examen.
  const tema=t=>COMMIT_KW[t.n]||(falta==='curso'?EVAL_KW[t.n]&&EVAL_KW[t.n]!=='entrega':EVAL_KW[t.n]||ENTREGA_N.has(t.n));
  // «¿Cuál quito?» se responde nombrando lo que se quita («la reunión», «el almuerzo»): no es otra cosa.
  if(falta!=='evaluacion'&&falta!=='que'&&falta!=='cual'&&(toks.some(tema)||EVENTO.test(ns)||estudie(ns)||NO_VA.test(ns)))return null;
  const p={...it},tm=parseTimes(ns),d=parseDate(ns,now),hora=tm.at!=null?tm.at:tm.range?tm.range[0]:null;
  const rango=tm.range||(tm.at!=null&&p.kind==='evento'?[tm.at,tm.at+60]:null)||(tm.part?(p.kind==='commit'?FRANJA_RUTINA:FRANJA_EVENTO)[tm.part]:null);
  if(falta==='alcance'){const a=alcanceDicho(ns);if(!a)return null;p.alcance=a;}
  else if(falta==='cual'){const c=cualQuitar(p,toks,tm,state);if(!c)return null;Object.assign(p,{t:c.t,id:c.id,d:c.d});}
  else if(falta==='que'){const l=queAgendar(toks,-1);if(!l)return null;p.label=l;if(p.start&&!p.end&&!tm.range){const fin=finDespues(p.start,tm);if(fin!=null)p.end=fin;}}
  else if(falta==='curso'){let j=0;while(j<toks.length&&(SKIPW.has(toks[j].n)||STOPW.has(toks[j].n)))j++;  // «es de estadística»
    const c=extractCourse(toks,j-1,true);if(!c)return null;p.course=cursoParecido(c,state)||c;}
  else if(falta==='fecha'){const wd=p.semana&&!/\d/.test(ns)&&!fechaRelativa(ns,now)&&Object.entries(DAYW).find(([w])=>new RegExp(`\\b${w}\\b`).test(ns));
    if(wd)p.date=diaEnSemanas(wd[1],p.semana,now);else if(d)p.date=d;else if(p.kind==='cambio'&&hora!=null)p.time=fmt(hora);else return null;}  // a una evaluación que cambió le basta la hora
  else if(falta==='hora'){const h=hora!=null?hora:p.type==='entrega'&&/\bmedianoche\b/.test(ns)?1439:null;if(h==null)return null;p.time=fmt(h);}
  else if(falta==='horario'&&(p.kind==='evento'||p.kind==='commit')&&p.start&&!tm.range){const fin=finDespues(p.start,tm);if(fin==null)return null;p.end=fin;}
  else if(falta==='horario'){if(!rango)return null;p.start=fmt(rango[0]);p.end=fmt(rango[1]);}
  else if(falta==='dias'){const ds=parseDays(ns);if(!ds.length)return null;p.days=ds;}
  else if(falta==='evaluacion'&&p.kind==='cambio'){const e=cualDeEstas(p.cands,toks,ns,d,state);if(!e)return null;Object.assign(p,{evalId:e.id,type:e.type,course:e.course});}
  else if(falta==='evaluacion'){const e=evalMencionada(ns,state,now);if(!e)return null;p.evalId=e.id;p.course=e.course;}
  else if(falta==='minutos'){const m=minutosDichos(ns);if(!m)return null;p.min=m;}
  // Lo demás que diga la misma respuesta también cuenta («el jueves a las 9»).
  if(p.kind==='eval'){if(!p.date&&d)p.date=d;if(!p.time&&hora!=null&&falta!=='curso')p.time=fmt(hora);}
  if(p.kind==='evento'){if(!p.date&&d)p.date=d;if(!p.start&&rango){p.start=fmt(rango[0]);p.end=fmt(rango[1]);}}
  if(p.kind==='commit'&&!p.start&&tm.range){p.start=fmt(tm.range[0]);p.end=fmt(tm.range[1]);}
  if(p.kind==='log'&&!p.min){const m=minutosDichos(ns);if(m)p.min=m;}
  if(p.kind==='cambio'&&falta==='fecha'&&!p.time&&hora!=null)p.time=fmt(hora);
  return continuarBorrador({...b,items:b.items.map((x,k)=>k===b.i?p:x)},state,now);}
// «¿Cuál de estas evaluaciones cambió?» respondida con palabras: la única de la lista que coincide por curso, tipo o fecha.
function cualDeEstas(ids,toks,ns,d,state){const es=(ids||[]).map(id=>state.evals.find(e=>e.id===id)).filter(Boolean);
  const tipos=new Set(toks.filter((x,j)=>esEvalTok(toks,j)).map(x=>EVAL_KW[x.n]||'entrega'));
  const nombra=e=>norm(e.course).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).some(w=>w.length>2&&new RegExp(`\\b${w}\\b`).test(ns));
  for(const f of [e=>d&&e.date===d,e=>tipos.has(e.type),nombra]){const c=es.filter(f);if(c.length===1)return c[0];}
  return null;}
// Devuelve una intención: {intent:'add',items}, {intent:'except',exs}, {intent:'log',...}, {intent:'aviso',texto}, {intent:'pregunta',texto,opciones,borrador}, {intent:'help'}…
// «Recuérdame si tengo algo mañana», «y para el domingo tengo algo», «¿estoy ocupado el sábado?»: pregunta por la agenda.
// Sin signo de pregunta y con hora («mañana tengo algo de 3 a 5») cuenta algo, no pregunta; «estoy ocupado el sábado»
// sin signo de pregunta marca el día como ocupado. «Algo pendiente esta semana» no es un día: lo ve la IA.
function preguntaAgenda(text,ns){const preg=/[¿?]/.test(text);
  const algo=/\b(tengo|hay|habra|tendre|tenemos)\s+algo\b|\balgo\s+(que hacer|pendiente)\b|\brecuerdame\s+(si|que|lo que)\b|\bque hay\s+(para|el|este|esta|hoy|manana|pasado)\b/.test(ns);
  // Con signo de pregunta: «¿estoy ocupado el sábado?», «¿tengo clase mañana?», «¿y para el domingo?».
  const ocupado=preg&&(/\b(estoy|estare|ando)\s+(ocupad[oa]|libre)\b/.test(ns)||/^(y\s+)?(tengo|hay|habra|tendre|me toca)\b/.test(ns)
    ||/^y\s+(para\s+)?(el\s+)?(hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s*$/.test(ns.trim()));
  if(!algo&&!ocupado)return false;
  if(/\bsemana\b/.test(ns)&&!/\b(dentro de|en|faltan?)\s+\S+\s+semanas?\b/.test(ns)&&!Object.keys(DAYW).some(w=>new RegExp(`\\b${w}\\b`).test(ns)))return false;
  if(!preg){const tm=parseTimes(ns);if(tm.range||tm.at!=null)return false;}
  return true;}
// Mensajes sociales («hola», «gracias», «ok», «chau», «¿quién eres?», «estoy cansado»): Lía responde corto y sin la IA.
// Solo cuando el mensaje no trae nada más: «hola, tengo examen el viernes a las 9» se lee como siempre.
// El orden decide el tipo cuando hay varios («hola, ¿qué puedes hacer?» es ayuda).
const CHARLA=[
  ['ayuda',/\b(que (puedes|sabes) hacer|que haces|que mas haces|como (funcionas|te uso|se usa|funciona esto|te hablo)|ayuda|ayudame|que te puedo (decir|pedir))\b/g],
  ['quien',/\b(quien eres|que eres|como te llamas|eres (un |una )?(bot|robot|ia|humana?|persona|real))\b/g],
  ['animo',/\b(estoy|ando|me siento|toy) (muy |re |bien |demasiado )?(cansad[oa]|estresad[oa]|agotad[oa]|abrumad[oa]|desmotivad[oa]|sin ganas|con sueno|aburrid[oa])\b|\b(no tengo ganas( de (nada|estudiar))?|que flojera|tengo (mucho )?sueno|que sueno)\b/g],
  ['gracias',/\b((muchas|mil|muchisimas) )?(gracias|grax|thanks|thank you)\b/g],
  ['despedida',/\b(chau+|chao|adios|bye|nos vemos|hasta (luego|manana|pronto|la proxima))\b/g],
  ['saludo',/\b(hola+|holi|holis|buen[oa]s( (dias|tardes|noches))?|hey|alo|que tal|como estas|como vas|como andas)\b/g],
  ['ok',/\b(ok|okey|okay|oki|listo|perfecto|genial|chevere|bacan|ya|dale|entendido|de acuerdo|vale|bien|super|excelente|claro|si|esta bien|ya veo)\b/g]];
const RELLENO=/\b(lia|oye|pues|nomas|no mas|ja(ja)+|je(je)+|xd+|muy|bueno|ah+|eh+|y|tu|a ti|igual(mente)?|tambien|mucho|todo|por todo|nada|que)\b/g;
function charla(ns){let resto=ns,tipo=null;
  for(const [t,re] of CHARLA){const r2=resto.replace(re,' ');if(r2!==resto){tipo=tipo||t;resto=r2;}}
  if(!tipo)return null;
  return resto.replace(RELLENO,' ').replace(/[^a-z0-9]+/g,'').length?null:tipo;}
// «¿Y si trabajo el sábado de 8 a 4?», «¿qué pasa si me quedo hasta las 10 el jueves?»: la frase sin el «y si».
// Devuelve null si no empieza así. Un «sí» suelto (respuesta a una pregunta) no cuenta.
function sinYSi(text){const m=String(text).match(/^\s*¿?\s*(?:y\s+)?(?:qu[eé]\s+pasa(?:r[ií]a)?\s+)?si\s+(.+?)\s*\??\s*$/i);
  if(!m||!/^\s*¿?\s*(?:y\s|qu[eé]\s)/i.test(text))return null;return m[1];}
// Calcula el plan con el cambio sobre una copia, sin tocar nada, y lo compara con el de hoy: cuánto falta por evaluación
// y cuánto estudio hay en los próximos 7 días.
function simular(state,base,now){const copia=JSON.parse(JSON.stringify(state));
  if(base.intent==='except')for(const [i,x] of (base.exs||[]).entries())copia.exceptions.push({id:'sim'+i,...x});
  if(base.intent==='add')for(const [i,it] of (base.items||[]).entries()){
    if(it.kind==='eval')copia.evals.push({id:'sim'+i,type:it.type,course:it.course,date:it.date,time:it.time,hours:it.hours||(EVAL_TYPES[it.type]||EVAL_TYPES.parcial).h});
    else copia.commitments.push({id:'sim'+i,name:it.name,type:it.type,days:it.days,start:it.start,end:it.end});}
  const p0=plan(state,now),p1=plan(copia,now),t=ymd(now),fin=ymd(addDays(now,7));
  const semana=p=>p.blocks.filter(b=>b.date>=t&&b.date<fin).reduce((a,b)=>a+b.e-b.s,0);
  const evs=copia.evals.filter(e=>e.date>=t).map(e=>({e,antes:p0.unmet[e.id]||0,despues:p1.unmet[e.id]||0,nueva:String(e.id).startsWith('sim')}));
  const mueve=p1.blocks.filter(b=>!p0.blocks.some(a=>a.evalId===b.evalId&&a.date===b.date&&a.s===b.s)).length;
  return{peor:evs.filter(x=>x.despues>x.antes),mejor:evs.filter(x=>x.despues<x.antes),nuevas:evs.filter(x=>x.nueva),semanaAntes:semana(p0),semanaDespues:semana(p1),mueve};}
// Lee una frase. Si dice «la próxima semana» sin el día, la pregunta por la fecha ofrece los días de esa semana.
function interpret(text,state,now){
  // «¿Y si…?»: se entiende la frase sin el «y si» y, si es un cambio, se simula en vez de anotarlo.
  const ysi=sinYSi(text);
  if(ysi){const base=interpretFrase(ysi,state,now);
    if(base.intent==='except'||base.intent==='add')return{intent:'simula',base,texto:ysi};
    if(base.intent==='pregunta')return{intent:'aviso',texto:'Para probarlo, dime el día y el horario, por ejemplo: “¿y si trabajo el sábado de 8 a 4?”.'};}
  const r=interpretFrase(text,state,now);
  const n=r.intent==='pregunta'&&r.borrador&&semanaSinDia(tokenize(text).map(t=>t.n).join(' '));
  if(!n)return r;
  const items=r.borrador.items.map(x=>'date' in x&&!x.date&&x.kind!=='rutina'?{...x,semana:n}:x);
  return continuarBorrador({...r.borrador,items},state,now);}
function interpretFrase(text,state,now){
  const toks=tokenize(text);const ns=toks.map(t=>t.n).join(' ');const S=state.settings;
  if(!ns.trim())return{intent:'help'};
  const social=charla(ns);if(social)return{intent:'charla',tipo:social};
  // «Elimina el evento del lunes a la 1:00 pm»: quitar lo que hay (antes se leía como algo nuevo o como la agenda).
  const qa=quitarAlgo(toks,ns,state,now);if(qa)return qa;
  // «Recuérdame que tengo examen de cálculo el viernes» cuenta algo nuevo: no es una pregunta por la agenda.
  const cuenta=!/[¿?]/.test(text)&&toks.some(t=>EVAL_KW[t.n]||COMMIT_KW[t.n]||ENTREGA_N.has(t.n))&&!/\b(mi agenda|como esta mi|estoy libre|tengo libre)\b/.test(ns);
  if(!cuenta&&(/\b(que tengo|que me toca|mi agenda|como esta mi|estoy libre|tengo libre|que hago)\b/.test(ns)||preguntaAgenda(text,ns))){const d=parseDate(ns,now)||ymd(now);return{intent:'agenda',date:d};}
  if(/\b(cuanto me falta|cuantas horas|como voy)\b/.test(ns))return{intent:'progress'};
  const cu=cuandoEsEval(toks,ns,state,now);if(cu)return cu;
  if(/\b(cuando es|proximo examen|siguiente examen)\b/.test(ns))return{intent:'next'};
  // Una evaluación que ya está y cambió o se canceló («me cambiaron el examen de cálculo al viernes»).
  const ce=cambioDeEval(text,state,now);if(ce)return ce;
  const hasEval=toks.some(t=>EVAL_KW[t.n]);
  // «Borra la clase de inglés», «quita mi rutina del gimnasio»: se quita desde Perfil, donde se ve qué se borra. Antes se
  // leía como una rutina nueva y Lía preguntaba sus días. Con fecha («borra la clase de mañana») lo ve la IA.
  if(!hasEval&&QUITAR_RUT.test(ns)&&toks.some(t=>COMMIT_KW[t.n]||/^rutinas?$/.test(t.n))){if(parseDate(ns,now))return{intent:'help'};
    const gs=rutinasNombradas(toks,ns,state);if(gs.length)return avisoQuitarRutina(gs);
    return{intent:'aviso',texto:'No encontré esa rutina. Tus rutinas están en Perfil: desde ahí las editas o las eliminas.'};}
  // Estudio que ya hiciste: "ayer estudié 2 horas de cálculo".
  if(estudie(ns)&&!/\b(voy a|tengo que|debo|quiero)\b/.test(ns)){const min=minutosDichos(ns)||0,date=fechaPasada(ns,now),e=evalMencionada(ns,state,now);
    if(!e&&!state.evals.some(x=>x.date>=ymd(now)))return{intent:'aviso',texto:'Todavía no tienes evaluaciones. Agrega una y luego anotamos lo que estudiaste.'};
    return continuarBorrador({intent:'log',items:[{kind:'log',evalId:e?e.id:'',course:e?e.course:'',date,min}]},state,now);}
  // Un compromiso que ese día no va: "mañana no tengo clases", "cancelaron mi clase", "hoy no voy a trabajar".
  const iC=toks.findIndex(t=>COMMIT_KW[t.n]);
  if(NO_VA.test(ns)&&!hasEval&&iC>=0){const date=parseDate(ns,now)||ymd(now),tipo=COMMIT_KW[toks[iC].n],palabra=toks[iC].n;
    const porTipo=tipo==='clase'||tipo==='trabajo'||tipo==='traslado',cosa=porTipo?COMMIT_TYPES[tipo].toLowerCase():toks[iC].o.toLowerCase();
    if(/\blos (lunes|martes|miercoles|jueves|viernes|sabados|domingos)\b/.test(ns))return{intent:'aviso',texto:`Si ya no tienes ${cosa} esos días, cámbialo en tus rutinas, en Perfil. Si es solo una vez, dime por ejemplo: “este viernes no tengo ${cosa}”.`};
    const wd=fromYmd(date).getDay();
    // Clases, trabajo y traslados se buscan por su tipo; lo demás («no voy al gimnasio»), por su nombre y, si no aparece, por su tipo.
    const delDia=state.commitments.filter(c=>c.days.includes(wd)),porNombre=delDia.filter(c=>norm(c.name).includes(palabra));
    // Una rutina nombrada por su nombre propio va primero («no hay clase de inglés» → Inglés, aunque su tipo no sea clase).
    // No cuenta el nombre que es solo su tipo («Clases», «Trabajo»): esas se buscan por tipo, abajo.
    const nombrada=delDia.filter(c=>norm(c.name).split(/[^a-z0-9]+/).some(w=>w.length>3&&COMMIT_KW[w]!==c.type&&new RegExp(`\\b${w}\\b`).test(ns)));
    // «No voy a trabajar ni a clases»: todas las rutinas que nombra la frase.
    const tipos=[...new Set(toks.filter(t=>COMMIT_KW[t.n]).map(t=>COMMIT_KW[t.n]))];
    const cs=nombrada.length?nombrada:porTipo?delDia.filter(c=>tipos.includes(c.type)):porNombre.length?porNombre:delDia.filter(c=>c.type===tipo);
    if(!cs.length)return{intent:'aviso',texto:`${cap(fechaLarga(date))} no tienes ${cosa} en tu horario, así que no hay nada que liberar.`};
    const exs=cs.map(c=>({date,start:c.start,end:c.end,label:`Sin ${c.name}`,libre:true,ref:c.id}));return{intent:'except',exs,ex:exs[0]};}
  // «Mañana entro a trabajar más temprano, a las 7», «el jueves entro a clases a las 10»: cambia la entrada de ese día.
  if(!hasEval&&ENTRO.test(ns)&&!NO_VA.test(ns)){
    // «Entro a las 10 en vez de las 9»: la hora vieja dice qué rutina cambia y no se confunde con la nueva.
    const vez=ns.match(EN_VEZ),tm=parseTimes(vez?ns.replace(EN_VEZ,' '):ns),dicha=parseDate(ns,now),date=dicha||ymd(now),wd=fromYmd(date).getDay();
    const kind=/\bclase/.test(ns)?'clase':'trabajo',h=tm.at!=null?tm.at:tm.range?tm.range[0]:null;
    // Un cambio para siempre («me cambiaron el horario de clases, ahora entro a las 9») se hace en la rutina.
    if(!dicha&&/\b(ahora|a partir|siempre|todos los|cada|cambiaron el horario|cambiaron mi horario|nuevo horario)\b/.test(ns)){const cosa=kind==='clase'?'clases':'trabajo';
      return{intent:'aviso',texto:`Si tu horario de ${cosa} cambió para siempre, cámbialo en tus rutinas, en Perfil. Si es solo un día, dime por ejemplo: “mañana entro a las ${h!=null?fmt(h):'9'}”.`};}
    let c=state.commitments.filter(x=>x.type===kind&&x.days.includes(wd)).sort((a,b)=>intervalo(a.start,a.end).s-intervalo(b.start,b.end).s)[0];
    if(vez){const viejas=horasPosibles(vez[1],vez[2],vez[3],null),nombra=/\b(clases?|trabajo|trabajar|chamba|turno|oficina)\b/.test(ns);
      const v=state.commitments.find(x=>x.days.includes(wd)&&vigente(x,date)&&viejas.includes(toMin(x.start))&&(!nombra||x.type===kind));
      if(v)c=v;else if(!nombra)return{intent:'aviso',texto:conPunto(`${cap(elDia(date,now))} no tienes nada que empiece ${aLa(adj(vez[1],vez[2],vez[3],null))}`)};}
    if(h==null||!c)return{intent:'help'};
    // «más temprano» o «antes» solo acepta una hora antes de la entrada de siempre; «recién», «más tarde» o «después», una después.
    const dir=/\b(temprano|antes)\b/.test(ns)?-1:/\b(recien|tarde|despues|luego)\b/.test(ns)?1:0,r=intervalo(c.start,c.end);
    const x=(tm.crudo?horasPosibles(...tm.crudo):[h]).filter(v=>v<r.e&&(dir<0?v<r.s:dir>0?v>r.s:true)).sort((a,b)=>Math.abs(a-r.s)-Math.abs(b-r.s))[0];
    if(x==null)return{intent:'help'};
    if(x===r.s)return{intent:'aviso',texto:`${cap(fechaLarga(date))} ya entras a las ${c.start}.`};
    if(x<r.s){const ex={date,start:fmt(x),end:c.start,label:`${c.name} (más temprano)`};return{intent:'except',exs:[ex],ex};}
    const ex={date,start:c.start,end:fmt(x),label:'Entrada más tarde',libre:true,ref:c.id};return{intent:'except',exs:[ex],ex};}
  // «Mi clase de inglés ahora es el sábado de 10 a 12», «cambia mi trabajo de los viernes»: un cambio para siempre de una
  // rutina que ya está se hace en Perfil (antes Lía la leía como una rutina nueva). Un solo día («este viernes», «mañana»,
  // «el lunes 9») lo ven las reglas de siempre.
  const unDiaDicho=/\b(hoy|manana|pasado manana|este|esta|solo)\b/.test(ns.replace(/\b(?:en|por|de|a) (?:la|las) mananas?\b/g,' '))
    ||/\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b|\b\d{1,2}\s*\/\s*\d{1,2}\b|\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+\d{1,2}\b(?!\s*(?::|a\s|am\b|pm\b|-))/.test(ns);
  if(!hasEval&&CAMBIA_RUT.test(ns)&&!unDiaDicho){
    // «Mis clases de los martes»: solo las rutinas de esos días.
    let gs=rutinasNombradas(toks,ns,state);const ds=parseDays(ns),deDias=gs.filter(g=>g.tramos.some(t=>t.days.some(d=>ds.includes(d))));if(deDias.length)gs=deDias;
    if(gs.length===1)return{intent:'aviso',texto:`Para cambiar el horario de «${gs[0].name}» para siempre, ábrela en Perfil, en «Tus rutinas». Si es solo un día, dime por ejemplo: “este viernes salgo a las 8”.`};
    if(gs.length)return{intent:'aviso',texto:`Tienes varias rutinas así: ${gs.map(g=>g.name).join(', ')}. Para cambiar su horario para siempre, ábrela en Perfil, en «Tus rutinas».`};}
  const busyWords=/\b(me quedo|quedarme|salgo|no puedo|ocupad[oa]|me extendieron|turno extra|libera|liberame|tengo un compromiso|cancela|no voy a poder|no podre|no tengo tiempo)\b/;
  // El turno de un día se alarga: «el viernes me toca chamba hasta las 10 de la noche», «me pidió quedarme hasta tarde
  // el jueves». Solo si ese día ya hay trabajo (o clase) en el horario; si no, lo ven las reglas de siempre.
  {const dia=!hasEval&&parseDate(ns,now),kind=/\bclase/.test(ns)?'clase':'trabajo',tm=parseTimes(ns);
    const alarga=dia&&!tm.range&&parseDays(ns).length<2&&!/\b(los|todos|cada|diario)\b/.test(ns)&&(/\bhasta (muy )?tarde\b/.test(ns)&&/\b(trabajo|chamba|chambeo|turno|clase|clases|oficina|jefe|jefa|me pidio|me pidieron)\b/.test(ns)||iC>=0&&COMMIT_KW[toks[iC].n]===kind&&tm.until!=null&&!/\b(salgo|saldre|sali|temprano|antes)\b/.test(ns)&&/\b(me toca|tengo|trabajo|chamba|chambeo|estoy|estare)\b/.test(ns));
    const c=alarga&&state.commitments.filter(x=>x.type===kind&&x.days.includes(fromYmd(dia).getDay())).sort((a,b)=>intervalo(b.start,b.end).e-intervalo(a.start,a.end).e)[0];
    if(c){const r=intervalo(c.start,c.end);
      if(/\bhasta (muy )?tarde\b/.test(ns)&&tm.until==null)  // sin hora: Lía pregunta hasta cuándo, con el fin de siempre como inicio
        return continuarBorrador({intent:'except',items:[{kind:'evento',date:dia,start:fmt(r.e),end:'',label:`${c.name} (más tarde)`,cat:c.type,
          preg:`¿Hasta qué hora te quedas ${(k=>k===0?'hoy':k===1?'mañana':k>1&&k<7?'el '+DIAS[fromYmd(dia).getDay()]:'el '+fechaCorta(dia))(dayDiff(ymd(now),dia))}? Tu ${c.type==='clase'?'clase':'turno'} termina a las ${c.end}.`}]},state,now);
      // Una hora antes del fin de siempre («hasta las 5») no alarga nada; pasar de medianoche solo si lo dice.
      const madrugada=/\b(madrugada|de la manana|medianoche)\b/.test(ns);
      const x=(tm.crudo?horasPosibles(...tm.crudo):[tm.until]).flatMap(v=>madrugada?[v,v+1440]:[v]).filter(v=>v>r.e&&v<=r.e+720).sort((a,b)=>a-b)[0];
      if(x!=null){const ex={date:dia,start:c.end,end:fmt(x),label:`${c.name} (más tarde)`};return{intent:'except',exs:[ex],ex};}}}
  // «Crea un evento semanal de almuerzo, de lunes a viernes de 1 a 2:30», «los lunes tengo reunión de equipo de 9 a 10»:
  // lo que se repite cada semana es una rutina, aunque se diga «evento» o «reunión» (antes se anotaba solo el primer día).
  const sem=!hasEval&&rutinaSemanal(toks,ns,iC);if(sem)return continuarBorrador({intent:'add',items:[sem]},state,now);
  // Un evento con nombre se anota si lo dice como algo que tiene («tengo una cita», «el sábado hay fiesta»), no si pregunta
  // por otra cosa («¿quién ganó el partido?»).
  const ev=!hasEval&&(parseDate(ns,now)||/\d/.test(ns)||/\b(tengo|tendre|hay|habra|voy|ire|me toca)\b/.test(ns))&&EVENTO.exec(ns);
  if((busyWords.test(ns)||ev)&&!hasEval){
    const date=parseDate(ns,now)||(ev&&!busyWords.test(ns)?'':ymd(now));const tm=parseTimes(ns);const wake=toMin(S.wake),sleep=finDelDia(S);
    const nowMin=date===ymd(now)?now.getHours()*60+now.getMinutes():wake,wd=fromYmd(date).getDay();
    let s,e,label=ev?nombreEvento(toks,ev[1]):'No disponible';
    if(tm.range){[s,e]=tm.range;}
    else if(tm.until!=null||(tm.at!=null&&/\b(salgo|me quedo|hasta)\b/.test(ns))){
      // "Salgo del trabajo a las 9": la hora se entiende según el horario de ese día (21:00, no 09:00).
      const kind=/\bclase/.test(ns)?'clase':'trabajo',quedo=/\b(me quedo|quedarme|hasta)\b/.test(ns);
      const c=state.commitments.filter(c=>c.days.includes(wd)&&c.type===kind).sort((a,b)=>intervalo(b.start,b.end).e-intervalo(a.start,a.end).e)[0];
      const cands=(tm.crudo?horasPosibles(...tm.crudo):[tm.until!=null?tm.until:tm.at]).flatMap(x=>[x,x+1440]);
      if(c){const r=intervalo(c.start,c.end);
        const x=cands.filter(v=>v>r.e&&v<=r.e+720||!quedo&&v>r.s&&v<r.e).sort((a,b)=>Math.abs(a-r.e)-Math.abs(b-r.e))[0];
        if(x==null)return{intent:'help'};
        if(x<r.e){const ex={date,start:fmt(x),end:fmt(r.e),label:'Salida temprano',libre:true,ref:c.id};return{intent:'except',exs:[ex],ex};}
        s=r.e;e=x;label=`${c.name} (más tarde)`;}
      else{s=Math.max(nowMin,wake);e=cands.filter(v=>v>s).sort((a,b)=>a-b)[0];label='Ocupado';}}
    else if(tm.at!=null){s=tm.at;e=tm.at+60;}
    else if(tm.part&&ev)[s,e]=FRANJA_EVENTO[tm.part];
    else if(tm.part){[s,e]={manana:[wake,720],tarde:[720,1140],noche:[1140,sleep]}[tm.part];label=`Ocupado (${tm.part==='manana'?'mañana':tm.part})`;}
    else if(!ev){s=wake;e=sleep;label=/\blibera|liberame\b/.test(ns)?'Día libre':'Día ocupado';}
    // Un evento con nombre (cumpleaños, cita…) necesita fecha y horas: si faltan, Lía las pregunta.
    if(ev)return continuarBorrador({intent:'except',items:[{kind:'evento',date,start:s!=null&&e>s?fmt(s):'',end:s!=null&&e>s?fmt(e):'',label,cat:CAT_EVENTO[ev[1]]||'otro'}]},state,now);
    if(!(e>s))return{intent:'help'};
    const ex={date,start:fmt(s),end:fmt(e),label};return{intent:'except',exs:[ex],ex};}  // si e pasa de 1440, termina al día siguiente
  // «Mañana tengo clase a las 4», «el 5 de noviembre tengo taller de 3 a 5»: una rutina con un día concreto (y sin
  // días de la semana como «los lunes») es algo de un solo día, no una rutina semanal.
  const unDia=!hasEval&&iC>=0&&unSoloDia(ns,now);
  if(unDia){const tipo=COMMIT_KW[toks[iC].n],tm=parseTimes(ns),wd=fromYmd(unDia).getDay();
    const label=tipo==='clase'?'Clase':tipo==='trabajo'?'Trabajo':nombreRutina(toks,iC,tipo);
    let s0=tm.range?tm.range[0]:tm.at!=null?tm.at:null,e0=tm.range?tm.range[1]:null;
    if(s0==null&&tm.part)[s0,e0]=FRANJA_EVENTO[tm.part];
    // Si ya está en su horario de ese día (la clase de siempre), no hay nada que anotar. Si se cruza con él pero no cabe
    // dentro, o dice que le cambiaron el turno, ese día cambia de horario: se libera el de siempre y se anota el nuevo.
    const mismos=state.commitments.filter(c=>c.type===tipo&&c.days.includes(wd));
    const cruza=s0!=null&&e0!=null&&mismos.filter(c=>(r=>s0<r.e&&e0>r.s)(intervalo(c.start,c.end)));
    const cambio=s0!=null&&e0!=null&&mismos.length&&(/\b(cambiaron|cambio de turno|me movieron|otro turno|turno nuevo|nuevo turno)\b/.test(ns)||cruza.some(c=>(r=>s0<r.s||e0>r.e)(intervalo(c.start,c.end))));
    if(cambio){const viejos=cruza.length?cruza:mismos,exs=[...viejos.map(c=>({date:unDia,start:c.start,end:c.end,label:`Sin ${c.name}`,libre:true,ref:c.id})),
        {date:unDia,start:fmt(s0),end:fmt(e0),label:`${label} (otro horario)`,cat:tipoRutina(tipo)}];
      return{intent:'except',exs,ex:exs[exs.length-1]};}
    const ya=s0!=null&&mismos.find(c=>(r=>s0>=r.s&&s0<r.e&&(e0==null||e0<=r.e))(intervalo(c.start,c.end)));
    if(ya)return{intent:'aviso',texto:`${cap(fechaLarga(unDia))} ya tienes ${ya.name} de ${ya.start} a ${ya.end} en tu horario.`};
    return continuarBorrador({intent:'except',items:[{kind:'evento',date:unDia,start:s0!=null?fmt(s0):'',end:e0!=null?fmt(e0):'',label,cat:tipoRutina(tipo)}]},state,now);}
  // «Necesito que me agendes para mañana a las 10 de la mañana» (la frase del supervisor, 30-oct-2026), «agéndame un
  // repaso de cálculo el jueves de 4 a 6»: algo de un solo día. Si no dice qué es, Lía lo pregunta y guarda lo demás.
  const iA=toks.findIndex(t=>AGENDAR.test(t.n));
  if(iA>=0&&!hasEval&&iC<0){const tm=parseTimes(ns),date=parseDate(ns,now);
    if(date||tm.at!=null||tm.range){const label=queAgendar(toks,iA);let s0=tm.range?tm.range[0]:tm.at,e0=tm.range?tm.range[1]:null;
      if(s0==null&&tm.part)[s0,e0]=FRANJA_EVENTO[tm.part];
      return continuarBorrador({intent:'except',items:[{kind:'evento',date:date||'',start:s0!=null?fmt(s0):'',end:e0!=null?fmt(e0):'',label,cat:'otro',...(label?{}:{que:true})}]},state,now);}}
  const clauses=splitClauses(toks);let prev=null;const items=[];
  for(const c of clauses){const r=parseClause(c,now,prev,S,state);if(r){items.push(r);prev=r;}}
  // Varias evaluaciones en una frase comparten la fecha si solo una la dice; los horarios de una misma rutina, sus días
  // («trabajo de 8 a 12 y de 2 a 6 de lunes a viernes»).
  const conFecha=items.find(i=>i.kind==='eval'&&i.date);
  if(conFecha)items.forEach((i,k)=>{if(i.kind==='eval'&&!i.date)items[k]={...i,date:conFecha.date};});
  items.forEach((i,k)=>{if(i.kind!=='commit'||i.days.length)return;const d=items.find(x=>x.kind==='commit'&&x.name===i.name&&x.days.length);if(d)items[k]={...i,days:[...d.days]};});
  if(items.length)return continuarBorrador({intent:'add',items},state,now);
  if(/\b(reorganiza|reorganizame|reprograma|reprogramame|arma|armame|rearma|rearmame|planifica|planificame|ordena|ordename)\b/.test(ns))return{intent:'replan'};
  return{intent:'help'};}
// ---------- Lía con IA (docs/ia-con-gemini.md) ----------
// Primero las reglas; la IA solo cuando las reglas no entienden. La evaluación del 29-oct mostró que la IA leía peor
// 20 frases que las reglas ya entendían (74 % frente a 88 %). Así la IA solo suma: entiende lo que las reglas no,
// responde al instante lo demás y gasta cupo solo cuando hace falta. La usan la app (handleText) y evaluar.mjs.
function pideIA(r){return !r||r.intent==='help';}
// Lo que se envía a la función lia-ia: fecha y hora con su zona, horas de dormir, horario fijo y evaluaciones
// de las últimas dos semanas en adelante. Nunca el nombre ni el correo.
function contextoIA(state,now){const off=-now.getTimezoneOffset(),a=Math.abs(off),desde=ymd(addDays(now,-14));
  return{ahora:`${ymd(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:00${off>=0?'+':'-'}${pad(Math.floor(a/60))}:${pad(a%60)}`,
    despierto:state.settings.wake,duermo:state.settings.sleep,
    evaluaciones:state.evals.filter(e=>e.date>=desde).sort((x,y)=>x.date.localeCompare(y.date)).slice(0,30).map(e=>({id:e.id,curso:e.course,tipo:e.type,fecha:e.date,hora:e.time})),
    compromisos:state.commitments.slice(0,30).map(c=>({id:c.id,nombre:c.name,tipo:c.type,dias:c.days,inicio:c.start,fin:c.end}))};}
// Los últimos mensajes del chat, para entender respuestas cortas como "el de Cálculo".
function historialIA(chat){return chat.slice(-6).filter(m=>m&&typeof m.text==='string'&&m.text).map(m=>({de:m.from==='me'?'yo':'lia',texto:m.text.slice(0,300)}));}
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
function fechaIA(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const d=fromYmd(v);return isNaN(d)||ymd(d)!==v?null:v;}
function textoIA(v,n){return typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):'';}
// Revisa la propuesta de la IA y la convierte en la intención que usa responder() (la misma forma que interpret()).
// Lo que no cuadra se descarta; si no queda nada útil devuelve {intent:'help'} y la app usa las reglas.
function validarIA(r,state,now){
  if(!r||typeof r!=='object')return{intent:'help'};
  const texto=textoIA(r.texto,300),entre=(f,a,b)=>!!f&&f>=ymd(addDays(now,a))&&f<=ymd(addDays(now,b)),lista=v=>Array.isArray(v)?v.slice(0,6).filter(x=>x&&typeof x==='object'):[];
  // Un dato que no vino queda vacío y Lía lo pregunta (decisión 4); uno que vino mal o fuera de rango descarta lo suyo.
  const fecha=(v,a,b)=>v===undefined||v===null||v===''?'':entre(fechaIA(v),a,b)?v:null;
  const nuevas=()=>{const items=[];
    for(const e of lista(r.evaluaciones)){const type=EVAL_TYPES[e.tipo]?e.tipo:null,date=fecha(e.fecha,0,400);if(!type||date===null)continue;
      const h=Number(e.horas);
      const curso=cap(textoIA(e.curso,60));   // ligada al curso que ya existe («calculo» → «Cálculo I»)
      items.push({kind:'eval',type,course:(curso&&cursoParecido(curso,state))||curso,date,time:HHMM.test(e.hora)?e.hora:'',hours:h>=0.5&&h<=40?Math.round(h*2)/2:EVAL_TYPES[type].h});}
    for(const c of lista(r.compromisos)){const type=COMMIT_TYPES[c.tipo]?c.tipo:null;if(!type)continue;
      const days=[...new Set((Array.isArray(c.dias)?c.dias:[]).filter(d=>Number.isInteger(d)&&d>=0&&d<=6))].sort((x,y)=>x-y),horas=HHMM.test(c.inicio)&&HHMM.test(c.fin)&&c.inicio!==c.fin;
      items.push({kind:'commit',type,name:cap(textoIA(c.nombre,40))||(type==='otro'?'Otro':COMMIT_TYPES[type]),days,start:horas?c.inicio:'',end:horas?c.fin:''});}
    return items;};
  const cambios=()=>{const exs=[],partes=[];
    for(const x of lista(r.cambios)){const date=fecha(x.fecha,-1,120);if(date===null)continue;
      if(x.libera===true){const c=state.commitments.find(c=>c.id===x.compromisoId);
        if(!date||!c||!c.days.includes(fromYmd(date).getDay())||exs.some(e=>e.ref===c.id&&e.date===date))continue;
        // Sale antes o entra más tarde: solo el tramo libre, si está dentro del compromiso (los de madrugada se liberan enteros).
        const tramo=HHMM.test(x.inicio)&&HHMM.test(x.fin)&&c.start<c.end&&x.inicio<x.fin&&x.inicio>=c.start&&x.fin<=c.end&&(x.inicio!==c.start||x.fin!==c.end);
        exs.push(tramo?{date,start:x.inicio,end:x.fin,label:x.fin===c.end?'Salida temprano':`Sin ${c.name}`,libre:true,ref:c.id}:{date,start:c.start,end:c.end,label:`Sin ${c.name}`,libre:true,ref:c.id});}
      else{const horas=HHMM.test(x.inicio)&&HHMM.test(x.fin)&&x.inicio!==x.fin,label=cap(textoIA(x.motivo,40))||'Ocupado',cat=catEvento(label);
        if(date&&horas)exs.push({date,start:x.inicio,end:x.fin,label,cat});
        else partes.push({kind:'evento',date,start:horas?x.inicio:'',end:horas?x.fin:'',label,cat});}}
    return{exs,partes};};
  const estudio=()=>{const s=r.estudio&&typeof r.estudio==='object'?r.estudio:null;if(!s)return null;
    const e=state.evals.find(x=>x.id===s.evaluacionId),date=fecha(s.fecha,-14,0);if(date===null)return null;
    return{kind:'log',evalId:e?e.id:'',course:e?e.course:'',date:date||ymd(now),min:Number.isInteger(s.minutos)&&s.minutos>=5&&s.minutos<=720?s.minutos:0};};
  const sinEvals='Todavía no tienes evaluaciones. Agrega una y luego anotamos lo que estudiaste.';
  switch(r.intent){
    case 'add':{const items=nuevas();return items.length?continuarBorrador({intent:'add',items},state,now):{intent:'help'};}
    case 'except':{const{exs,partes}=cambios();if(exs.length)return{intent:'except',exs,ex:exs[0]};
      return partes.length?continuarBorrador({intent:'except',items:partes},state,now):{intent:'help'};}
    case 'log':{const l=estudio();if(!l)return{intent:'help'};
      if(!l.evalId&&!state.evals.some(x=>x.date>=ymd(now)))return{intent:'aviso',texto:sinEvals};
      return continuarBorrador({intent:'log',items:[l]},state,now);}
    case 'agenda':{const f=fechaIA(r.fecha);return{intent:'agenda',date:entre(f,-7,60)?f:ymd(now)};}
    case 'progress':case 'next':case 'replan':return{intent:r.intent};
    // Lo que la IA ya entendió queda como borrador y la app ofrece las respuestas rápidas; se usa la pregunta de la IA
    // cuando pregunta lo mismo que falta.
    case 'pregunta':{const items=nuevas(),{partes}=cambios(),l=estudio();
      const b=items.length?{intent:'add',items}:partes.length?{intent:'except',items:partes}:l&&(l.evalId||state.evals.some(x=>x.date>=ymd(now)))?{intent:'log',items:[l]}:null;
      const c=b&&continuarBorrador(b,state,now);
      if(c&&c.intent==='pregunta')return texto&&r.falta===faltaDe(c.borrador.items[c.borrador.i])?{...c,texto}:c;
      return texto?{intent:'aviso',texto}:{intent:'help'};}
    case 'aviso':case 'fuera':return texto?{intent:'aviso',texto}:{intent:'help'};
    default:return{intent:'help'};}}
// ---------- Lía en WhatsApp (docs/whatsapp-lia.md) ----------
// Lo que lia-whatsapp necesita para entender igual que la app: ajustes del plan, evaluaciones desde hace 14 días (con
// lo estudiado y lo que quedó sin hueco) y rutinas. Nunca el nombre, el correo ni lo que vino de Google Calendar.
function contextoWhatsapp(state,p,now){const S=state.settings,desde=ymd(addDays(now,-14)),unmet=(p&&p.unmet)||{};
  return{proximas:state.evals.filter(e=>e.date>=ymd(now)).length,   // como upcomingEvals(): también las de Google (para el límite de Gratis)
    settings:{wake:S.wake,sleep:S.sleep,maxDay:S.maxDay,block:S.block,minBlock:S.minBlock,...(S.cicloInicio?{cicloInicio:S.cicloInicio}:{})},
    evals:state.evals.filter(e=>!e.gcal&&e.date>=desde).sort((x,y)=>(x.date+x.time).localeCompare(y.date+y.time)).slice(0,40)
      .map(e=>({id:e.id,type:e.type,course:e.course,date:e.date,time:e.time,hours:e.hours,hecho:doneFor(state,e.id),sinHueco:unmet[e.id]||0})),
    commitments:state.commitments.filter(c=>!c.gcal).slice(0,40)
      .map(c=>({id:c.id,name:c.name,type:c.type,days:c.days,start:c.start,end:c.end,...(c.desde?{desde:c.desde}:{}),...(c.hasta?{hasta:c.hasta}:{})}))};}
// Antes de guardar lo que la persona confirmó por WhatsApp, se revisa con el estado de ahora: pudo cambiar desde que
// Lía lo propuso. Devuelve {ok:true} o {ok:false,motivo}. room: cuántas evaluaciones próximas caben (Gratis).
function revisarPropuesta(state,it,now,room){const t=ymd(now),HH=/^([01]\d|2[0-3]):[0-5]\d$/,no=motivo=>({ok:false,motivo}),ev=id=>state.evals.find(e=>e.id===id);
  if(!it||typeof it!=='object')return no('rara');
  if(it.intent==='add'){const items=Array.isArray(it.items)?it.items:[];if(!items.length)return no('rara');
    const texto=v=>typeof v==='string'&&v.trim().length>0&&v.length<=60,dias=d=>Array.isArray(d)&&d.length>0&&d.length<=7&&d.every(x=>Number.isInteger(x)&&x>=0&&x<=6);
    for(const i of items){if(i&&i.kind==='eval'){if(!EVAL_TYPES[i.type]||!texto(i.course)||!fechaIA(i.date)||!HH.test(i.time)||(i.hours!==undefined&&!(i.hours>=0.5&&i.hours<=40)))return no('rara');if(i.date<t)return no('pasada');}
      else if(i&&i.kind==='commit'){if(!COMMIT_TYPES[i.type]||!texto(i.name)||!dias(i.days)||!HH.test(i.start)||!HH.test(i.end)||i.start===i.end)return no('rara');}
      else return no('rara');}
    const evs=items.filter(i=>i.kind==='eval'),ya=i=>i.kind==='eval'?state.evals.some(e=>e.type===i.type&&norm(e.course)===norm(i.course)&&e.date===i.date&&e.time===i.time)
      :state.commitments.some(c=>norm(c.name)===norm(i.name)&&c.start===i.start&&c.end===i.end&&[...c.days].sort().join()===[...i.days].sort().join());
    if(items.every(ya))return no('repetida');
    return evs.length>room?no('limite'):{ok:true};}
  if(it.intent==='except'){const exs=Array.isArray(it.exs)?it.exs:[];if(!exs.length)return no('rara');
    for(const x of exs){if(!x||!fechaIA(x.date)||!HH.test(x.start)||!HH.test(x.end)||typeof x.label!=='string'||!x.label||x.label.length>60||(x.cat!==undefined&&typeof x.cat!=='string'))return no('rara');if(x.date<t)return no('pasada');
      if(x.libre&&!state.commitments.some(c=>c.id===x.ref))return no('sin_rutina');}
    return{ok:true};}
  if(it.intent==='log'){if(!ev(it.evalId))return no('sin_eval');if(!fechaIA(it.date)||it.date>t||dayDiff(it.date,t)>14||!(it.min>=5&&it.min<=720))return no('rara');return{ok:true};}
  if(it.intent==='cambiaEval'){if(!ev(it.evalId))return no('sin_eval');if(!fechaIA(it.date)||!HH.test(it.time))return no('rara');return it.date<t?no('pasada'):{ok:true};}
  if(it.intent==='quitaEval')return ev(it.evalId)?{ok:true}:no('sin_eval');
  if(it.intent==='quitaEvento')return state.exceptions.some(x=>x.id===it.exId&&!x.libre)?{ok:true}:no('sin_evento');
  if(it.intent==='quitaRutina'){const ids=Array.isArray(it.ids)?it.ids:[];if(!ids.length||!ids.every(x=>typeof x==='string'))return no('rara');
    return ids.every(id=>state.commitments.some(c=>c.id===id))?{ok:true}:no('sin_rutina');}
  return no('rara');}
// Categoría de algo de un solo día por su nombre («Cumpleaños de Ana» → ocio).
const catEvento=l=>{for(const w of norm(l||'').split(/[^a-z0-9]+/)){if(CAT_EVENTO[w])return CAT_EVENTO[w];if(COMMIT_KW[w])return tipoRutina(COMMIT_KW[w]);}return'otro';};
// ---------- Consolidado de matrícula (PDF) ----------
// Lee los horarios de un consolidado a partir de los trozos de texto del PDF con su posición ({s,x,y}; y crece hacia
// abajo y las páginas van una tras otra). No guarda ni lee el nombre ni el código del alumno: solo cursos y horarios.
// 1) La columna de horarios empieza en el trozo más a la izquierda que trae un día de la semana o una hora.
// 2) Esa columna, leída en orden, da «día … HH:MM-HH:MM aula» (aunque un horario se parta en dos líneas o páginas).
// 3) Cada horario va al curso cuya fila está más cerca; un nombre en dos líneas se junta.
const DIA_CONS={lunes:1,martes:2,miercoles:3,jueves:4,viernes:5,sabado:6,domingo:0};
function leerConsolidado(items){
  const its=(items||[]).filter(t=>t&&typeof t.s==='string'&&t.s.trim()&&Number.isFinite(t.x)&&Number.isFinite(t.y)).map(t=>({s:t.s.replace(/\s+/g,' ').trim(),x:t.x,y:t.y,n:norm(t.s)}));
  const esDia=t=>/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(t.n),esHora=t=>/\b\d{1,2}:\d{2}\b/.test(t.n);
  const cab=its.find(t=>/^horarios?$/.test(t.n)),y0=cab?cab.y-12:-Infinity;
  const conHorario=its.filter(t=>t.y>y0&&(esDia(t)||esHora(t)));if(!conHorario.length)return{cursos:[]};
  const x0=Math.min(...conHorario.map(t=>t.x))-4;
  const col=its.filter(t=>t.x>=x0&&t.y>y0).sort((a,b)=>a.y-b.y||a.x-b.x),izq=its.filter(t=>t.x<x0&&t.y>y0);
  // La columna como un solo texto, recordando la altura de cada trozo.
  let txt='';const pos=[];for(const t of col){const i=txt.length;txt+=(txt?' ':'')+t.n;pos.push([i,t.y]);}
  const yEn=i=>{let y=pos[0][1];for(const[p,v]of pos){if(p>i)break;y=v;}return y;};
  const re=/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b(.*?)(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g,hs=[];let m;
  while((m=re.exec(txt))){const ini=+m[3]*60+ +m[4],fin=+m[5]*60+ +m[6];if(ini>=1440||fin>1440||fin===ini)continue;
    const medio=m[2],tipo=/laborator/.test(medio)?'Laboratorio':/practic/.test(medio)?'Práctica':/teori/.test(medio)?'Teoría':'';
    hs.push({dia:DIA_CONS[m[1]],inicio:fmt(ini),fin:fmt(fin),tipo,virtual:/virtual/.test(medio),y:yEn(m.index+1)});}
  if(!hs.length)return{cursos:[]};
  // Los nombres de curso: texto con letras a la izquierda de los horarios (sin códigos, números, secciones ni encabezados).
  const cabNom=its.find(t=>/^(curso|cursos|asignatura|asignaturas|nombre del curso|materia|experiencia curricular)$/.test(t.n));
  const noNombre=t=>!/[a-z]{3}/.test(t.n)||/^[a-z]{1,5}\s?\d{1,5}[a-z]?$/.test(t.n)||/^(lab|teo|sec|grupo|aula)\b/.test(t.n)||/^(curso|cursos|asignaturas?|codigo|creditos|seccion|grupos?|nivel|vez|nro|horario|academic|presenci|virtuales|ales|os|tipo|docente|ciclo)\b/.test(t.n);
  const cand=izq.filter(t=>!noNombre(t)&&(!cabNom||(t.x>=cabNom.x-80&&t.x<=cabNom.x+120))).sort((a,b)=>a.y-b.y||a.x-b.x);
  const nombres=[];for(const t of cand){const u=nombres[nombres.length-1];
    if(u&&Math.abs(t.x-u.x)<=10&&t.y-u.yf<=14){u.s+=' '+t.s;u.yf=t.y;}else nombres.push({s:t.s,x:t.x,y:t.y,yf:t.y});}
  if(!nombres.length)return{cursos:[]};
  const cursos=nombres.map(n=>({nombre:n.s.replace(/\s*[-–]\s*$/,'').slice(0,40),c:(n.y+n.yf)/2,horarios:[]}));
  for(const h of hs){const c=cursos.reduce((a,b)=>Math.abs(b.c-h.y)<Math.abs(a.c-h.y)?b:a);
    if(!c.horarios.some(x=>x.dia===h.dia&&x.inicio===h.inicio&&x.fin===h.fin)){const{y,...sinY}=h;c.horarios.push(sinY);}}
  // El mismo curso en varias filas (una por horario) queda como uno solo.
  const unidos=[];for(const c of cursos.filter(c=>c.horarios.length)){const u=unidos.find(x=>norm(x.nombre)===norm(c.nombre));
    if(!u){unidos.push({nombre:c.nombre,horarios:[...c.horarios]});continue;}
    for(const h of c.horarios)if(!u.horarios.some(x=>x.dia===h.dia&&x.inicio===h.inicio&&x.fin===h.fin))u.horarios.push(h);}
  return{cursos:unidos};}
// Un curso como rutina de clases: un horario por cada par de horas, con todos sus días.
function rutinaDeCurso(c){const t={};for(const h of c.horarios){const k=h.inicio+'-'+h.fin;(t[k]=t[k]||{days:[],start:h.inicio,end:h.fin}).days.push(h.dia);}
  return{name:c.nombre,type:'clase',tramos:Object.values(t).map(x=>({...x,days:[...new Set(x.days)].sort((a,b)=>a-b)}))};}
// Canales (docs/canales.md y docs/calendario.md): lo de los próximos 14 días, con hora de Lima: sesiones de estudio y
// evaluaciones y, si la persona lo eligió (settings.calTodo), eventos de un día y rutinas (sin las horas que se liberaron
// ese día). Nunca lo que vino de Google Calendar. Con más de 300, se recortan primero eventos y rutinas.
function iso(f,min){const d=min>=1440?ymd(addDays(fromYmd(f),1)):f;return `${d}T${fmt(min%1440)}:00-05:00`;}
function eventosCanales(st,p,n){const hoy=ymd(n),hasta=ymd(addDays(n,14)),out=[],resto=[];
  for(const b of p.blocks){if(b.date<hoy||b.date>hasta)continue;const e=st.evals.find(x=>x.id===b.evalId);
    out.push({inicio:iso(b.date,b.s),fin:iso(b.date,b.e),titulo:`Estudiar ${e?e.course:'para tu evaluación'}`.slice(0,80),tipo:'estudio'});}
  for(const e of st.evals){if(e.gcal||e.date<hoy||e.date>hasta||!e.time)continue;const t=EVAL_TYPES[e.type]||EVAL_TYPES.parcial,s=toMin(e.time);
    out.push({inicio:iso(e.date,s),fin:iso(e.date,s+(e.type==='entrega'?15:60)),titulo:`${t.label} de ${e.course}`.slice(0,80),tipo:'evaluacion'});}
  const libres=(ref,f)=>ref?st.exceptions.filter(x=>x.libre&&x.ref===ref&&x.date===f).map(x=>intervalo(x.start,x.end)):[];
  const poner=(f,r,titulo,tipo,ref)=>{let partes=[r];for(const l of libres(ref,f))partes=subtract(partes,l.s,l.e);
    for(const q of partes)if(q.e-q.s>=15)resto.push({inicio:iso(f,q.s),fin:iso(f,q.e),titulo:String(titulo).slice(0,80),tipo});};
  const orden=(a,b)=>a.inicio.localeCompare(b.inicio);
  if(st.settings.calTodo!==true)return out.sort(orden).slice(0,300);
  // «No disponible» es lo que deja mover un bloque de estudio: no es un evento de la persona.
  for(const x of st.exceptions){if(x.libre||x.gcal||!x.label||x.label==='No disponible'||x.date<hoy||x.date>hasta||!HHMM.test(x.start)||!HHMM.test(x.end))continue;
    poner(x.date,intervalo(x.start,x.end),x.label,x.cat==='clase'?'clase':'otro',x.id);}
  for(let i=0;i<=14;i++){const f=ymd(addDays(n,i)),wd=fromYmd(f).getDay();
    for(const c of st.commitments){if(c.gcal||!c.days.includes(wd)||!vigente(c,f)||!HHMM.test(c.start)||!HHMM.test(c.end)||c.start===c.end)continue;
      poner(f,intervalo(c.start,c.end),c.name,c.type==='clase'?'clase':'otro',c.id);}}
  out.sort(orden);return [...out.slice(0,300),...resto.sort(orden).slice(0,Math.max(0,300-out.length))].sort(orden);}

// «Conectar con Google» (docs/google.md): al calendario «LIA» de la persona va todo lo de LIA de los próximos 14 días
// (estudio, evaluaciones, eventos y rutinas), sin lo que vino de Google. No pasa por agenda_canales.
function eventosGoogle(st,p,n){return eventosCanales({...st,settings:{...st.settings,calTodo:true}},p,n);}

// ---------- Google Calendar → LIA (docs/calendario.md) ----------
// leerIcs() lee el iCal de la «dirección secreta» (Google, Outlook o iCloud) y pasa todas las horas a hora de Lima
// (UTC−5, sin horario de verano). deCalendario() propone rutinas, evaluaciones, eventos de un día y ratos libres;
// fusionarGcal() los junta con lo guardado. Lo traído lleva gcal (su clave) y gh (su huella, para saber si se cambió en LIA).
const GC={ventana:60,ventanaEvals:120,maxDur:16*60};
const ICS_DIA={SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6};
const TZ_WINDOWS={'SA Pacific Standard Time':'America/Bogota','SA Western Standard Time':'America/La_Paz','Pacific SA Standard Time':'America/Santiago',
  'Argentina Standard Time':'America/Argentina/Buenos_Aires','E. South America Standard Time':'America/Sao_Paulo','Central America Standard Time':'America/Guatemala',
  'Pacific Standard Time':'America/Los_Angeles','Mountain Standard Time':'America/Denver','Central Standard Time':'America/Chicago','Eastern Standard Time':'America/New_York',
  'GMT Standard Time':'Europe/London','W. Europe Standard Time':'Europe/Berlin','Romance Standard Time':'Europe/Paris','UTC':'UTC'};
const diaN=f=>Date.UTC(+f.slice(0,4),+f.slice(5,7)-1,+f.slice(8,10))/864e5;
const sumarDias=(f,n)=>ymd(addDays(fromYmd(f),n));
function desfaseTz(tz,ms){const p={};
  for(const x of new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)))p[x.type]=x.value;
  return(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-ms)/6e4;}
// «20261103», «20261103T090000» (con o sin TZID) o «20261103T140000Z» → {f, min, dia} en Lima. corre: cuántos días se
// movió la fecha al pasar a Lima (los días de la semana de una repetición se corren igual).
function horaLima(valor,tzid){const m=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(valor||'').trim());if(!m)return null;
  if(m[4]===undefined)return{f:`${m[1]}-${m[2]}-${m[3]}`,min:0,dia:true,corre:0};
  const pared=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));let ms;
  if(m[7])ms=pared;
  else{let tz=String(tzid||'').replace(/^"|"$/g,'');tz=TZ_WINDOWS[tz]||tz;
    if(!tz||tz==='America/Lima')ms=pared+300*6e4;   // sin zona: la hora de quien lo anotó, que está en Lima
    else{try{const o=desfaseTz(tz,pared);ms=pared-o*6e4;const o2=desfaseTz(tz,ms);if(o2!==o)ms=pared-o2*6e4;}catch(e){ms=pared+300*6e4;}}}
  const l=new Date(ms-300*6e4),f=`${l.getUTCFullYear()}-${pad(l.getUTCMonth()+1)}-${pad(l.getUTCDate())}`;
  return{f,min:l.getUTCHours()*60+l.getUTCMinutes(),dia:false,corre:diaN(f)-diaN(`${m[1]}-${m[2]}-${m[3]}`)};}
function duracionIcs(v){const m=/^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v||'').trim());
  return m?(+m[1]||0)*10080+(+m[2]||0)*1440+(+m[3]||0)*60+(+m[4]||0):null;}
const textoIcs=v=>String(v||'').replace(/\\([\;,nN])/g,(x,c)=>c==='n'||c==='N'?' ':c).replace(/\s+/g,' ').trim();
function lineaIcs(l){let q=false,i=0;for(;i<l.length;i++){if(l[i]==='"')q=!q;else if(l[i]===':'&&!q)break;}if(i>=l.length)return null;
  const cab=l.slice(0,i).split(';'),p={};for(const x of cab.slice(1)){const k=x.indexOf('=');if(k>0)p[x.slice(0,k).toUpperCase()]=x.slice(k+1).replace(/^"|"$/g,'');}
  return{n:cab[0].trim().toUpperCase(),p,v:l.slice(i+1).trim()};}
function leerIcs(texto){const out=[];if(!/BEGIN:VCALENDAR/i.test(String(texto||'')))return out;let ev=null,prof=0;
  for(const l of String(texto).replace(/\r?\n[ \t]/g,'').split(/\r?\n/)){const x=lineaIcs(l);if(!x)continue;
    if(x.n==='BEGIN'){if(x.v.toUpperCase()==='VEVENT'&&!ev){ev={exdates:[],P:{}};prof=0;}else if(ev)prof++;continue;}
    if(x.n==='END'){if(ev&&prof){prof--;continue;}if(ev&&x.v.toUpperCase()==='VEVENT'){const e=cerrarVevento(ev);if(e)out.push(e);ev=null;}continue;}
    if(!ev||prof)continue;   // lo de una alarma (VALARM) no es del evento
    if(x.n==='EXDATE'){for(const s of x.v.split(',')){const h=horaLima(s,x.p.TZID);if(h)ev.exdates.push({f:h.f,min:h.min});}continue;}
    if(!(x.n in ev.P))ev.P[x.n]=x;}
  return out;}
function cerrarVevento({P,exdates}){const ini=P.DTSTART&&horaLima(P.DTSTART.v,P.DTSTART.p.TZID);if(!ini)return null;
  const fin=P.DTEND&&horaLima(P.DTEND.v,P.DTEND.p.TZID),dd=P.DURATION?duracionIcs(P.DURATION.v):null;
  const dur=fin?(diaN(fin.f)*1440+fin.min)-(diaN(ini.f)*1440+ini.min):dd!=null?dd:ini.dia?1440:60;
  let rrule=null;
  if(P.RRULE){const r={};for(const kv of P.RRULE.v.split(';')){const i=kv.indexOf('=');if(i>0)r[kv.slice(0,i).toUpperCase()]=kv.slice(i+1);}
    const freq=(r.FREQ||'').toUpperCase(),dias=(r.BYDAY||'').split(',').filter(Boolean),simples=dias.filter(d=>d in ICS_DIA);
    rrule={freq,interval:Math.max(1,parseInt(r.INTERVAL,10)||1),count:r.COUNT?parseInt(r.COUNT,10):null,until:r.UNTIL?horaLima(r.UNTIL,P.DTSTART.p.TZID):null,
      byday:[...new Set(simples.map(d=>(ICS_DIA[d]+ini.corre+7)%7))].sort((a,b)=>a-b),bymonthday:(r.BYMONTHDAY||'').split(',').filter(Boolean).map(Number),
      compleja:simples.length<dias.length||!!(r.BYSETPOS||r.BYWEEKNO||r.BYYEARDAY||r.BYHOUR||r.BYMINUTE||r.BYMONTH)||(dias.length>0&&(freq==='MONTHLY'||freq==='YEARLY'))};}
  const rid=P['RECURRENCE-ID']&&horaLima(P['RECURRENCE-ID'].v,P['RECURRENCE-ID'].p.TZID);
  return{uid:P.UID?P.UID.v:`sin-uid-${ini.f}-${ini.min}`,titulo:P.SUMMARY?textoIcs(P.SUMMARY.v):'',inicio:{f:ini.f,min:ini.min,dia:ini.dia},dur,rrule,exdates,
    rid:rid?{f:rid.f,min:rid.min}:null,cancelado:!!P.STATUS&&P.STATUS.v.toUpperCase()==='CANCELLED',libre:!!P.TRANSP&&P.TRANSP.v.toUpperCase()==='TRANSPARENT'};}
// Fechas (en Lima) en que se repite un evento entre desde y hasta. mas: si sigue después de hasta.
function ocurrencias(e,desde,hasta){const r=e.rrule,f0=e.inicio.f,d0=fromYmd(f0),out=[];let n=0,mas=false,pasos=0;
  const tope=r.until?(r.until.dia?diaN(r.until.f)*1440+1439:diaN(r.until.f)*1440+r.until.min):Infinity;
  const tomar=f=>{if(f<f0)return true;if(diaN(f)*1440+e.inicio.min>tope||(r.count!=null&&n>=r.count))return false;n++;if(f>hasta){mas=true;return false;}if(f>=desde)out.push(f);return true;};
  if(r.freq==='DAILY'){for(let k=0;pasos++<20000;k+=r.interval){const f=ymd(addDays(d0,k));if(r.byday.length&&!r.byday.includes(fromYmd(f).getDay()))continue;if(!tomar(f))break;}}
  else if(r.freq==='WEEKLY'){const dias=(r.byday.length?r.byday:[d0.getDay()]).slice().sort((a,b)=>((a+6)%7)-((b+6)%7)),lunes=addDays(d0,-((d0.getDay()+6)%7));
    semanas:for(let k=0;pasos++<5000;k+=r.interval)for(const d of dias){if(!tomar(ymd(addDays(lunes,k*7+(d+6)%7))))break semanas;}}
  else if(r.freq==='MONTHLY'||r.freq==='YEARLY'){const paso=r.freq==='MONTHLY'?r.interval:12*r.interval,dias=r.freq==='MONTHLY'&&r.bymonthday.length?r.bymonthday:[d0.getDate()];
    meses:for(let k=0;pasos++<3000;k+=paso){const a=d0.getFullYear(),m=d0.getMonth()+k,ult=new Date(a,m+1,0).getDate();
      for(const x of dias.map(x=>x<0?ult+1+x:x).filter(x=>x>=1&&x<=ult).sort((p,q)=>p-q)){if(!tomar(ymd(new Date(a,m,x))))break meses;}}}
  else return null;
  if(r.until==null&&r.count==null)mas=true;
  return{fechas:out,mas};}
// Tipo de evaluación y curso por el título («Parcial de Física 1», «PC2 - Estadística», «Examen final de Química»).
const GC_EVAL={parcial:'parcial',parciales:'parcial',examen:'examen',final:'final',practica:'practica',pc:'practica',pc1:'practica',pc2:'practica',pc3:'practica',pc4:'practica',pc5:'practica',
  control:'control',quiz:'control',entrega:'entrega',entregable:'entrega',exposicion:'exposicion',sustentacion:'exposicion',evaluacion:'examen'};
const GC_RELLENO=new Set(['','de','del','la','el','los','las','al','a','y','en','n','no','nro','n°','calificada','calificado']);
const palabrasIcs=t=>String(t||'').split(/\s+/).filter(Boolean);
const normPal=p=>norm(p).replace(/[^a-z0-9ñ°]/g,'');
function evalDeTitulo(t){const pal=palabrasIcs(t),n=pal.map(normPal),tipos=n.map(x=>GC_EVAL[x]).filter(Boolean);if(!tipos.length)return null;
  let i=0;while(i<pal.length&&(GC_EVAL[n[i]]||GC_RELLENO.has(n[i])||/^\d+$/.test(n[i])))i++;
  const c=pal.slice(i).join(' ').trim()||String(t).trim();return{type:tipos.includes('final')?'final':tipos[0],course:cap(c).slice(0,40)};}
function catDeTitulo(t){for(const p of palabrasIcs(t).map(normPal)){const c=CAT_EVENTO[p]||COMMIT_KW[p];if(c)return c;}return 'otro';}
function deCalendario(evs,hoy){const c={rutinas:[],evals:[],eventos:[],libres:[],omitidos:{todoElDia:0,largos:0,repeticiones:0,disponibles:0}},o=c.omitidos;
  const hasta=sumarDias(hoy,GC.ventana),hastaE=sumarDias(hoy,GC.ventanaEvals),enV=f=>f>=hoy&&f<=hasta,cambios={};
  const nombre=e=>(e.titulo||'Ocupado').slice(0,40),hora=(min,dur)=>({start:fmt(min),end:fmt((min+dur)%1440)});
  const evento=(k,x,base)=>{if(x.cancelado||x.libre||x.inicio.dia||x.dur<=0||x.dur>GC.maxDur||!enV(x.inicio.f))return;
    c.eventos.push({gcal:k,date:x.inicio.f,...hora(x.inicio.min,x.dur),label:nombre(x.titulo?x:base),cat:catDeTitulo(x.titulo||base.titulo)});};
  for(const e of evs)if(e.rid)(cambios[e.uid]=cambios[e.uid]||[]).push(e);
  for(const e of evs){if(e.rid||e.cancelado)continue;const cuenta=e.rrule||enV(e.inicio.f);
    if(e.libre){if(cuenta)o.disponibles++;continue;}
    const ev=!e.rrule&&evalDeTitulo(e.titulo);
    if(e.inicio.dia){if(ev&&ev.type==='entrega'&&e.inicio.f>=hoy&&e.inicio.f<=hastaE)c.evals.push({gcal:'v:'+e.uid,type:'entrega',course:ev.course,date:e.inicio.f,time:'23:59'});
      else if(cuenta)o.todoElDia++;continue;}
    if(e.dur<=0)continue;
    if(e.dur>GC.maxDur){if(cuenta)o.largos++;continue;}
    if(!e.rrule){if(ev&&e.inicio.f>=hoy&&e.inicio.f<=hastaE)c.evals.push({gcal:'v:'+e.uid,type:ev.type,course:ev.course,date:e.inicio.f,time:fmt(e.inicio.min)});
      else evento('e:'+e.uid,e,e);continue;}
    const r=e.rrule,oc=r.compleja?null:ocurrencias(e,hoy,hasta);
    if(!oc){o.repeticiones++;continue;}
    if(!oc.fechas.length&&!oc.mas)continue;   // ya terminó
    const movidas=new Map((cambios[e.uid]||[]).map(x=>[x.rid.f,x]));
    if(r.interval===1&&(r.freq==='WEEKLY'||r.freq==='DAILY')){
      if(!oc.fechas.length)continue;   // empieza después de los próximos 60 días: llega en otra sincronización
      // Empieza o termina en una fecha: la rutina la lleva (desde/hasta) y no ocupa horas fuera de ella.
      const k='r:'+e.uid,h=hora(e.inicio.min,e.dur),fin=r.until?r.until.f:!oc.mas?oc.fechas[oc.fechas.length-1]:null;
      c.rutinas.push({gcal:k,name:nombre(e),type:catDeTitulo(e.titulo),days:r.freq==='DAILY'&&!r.byday.length?[0,1,2,3,4,5,6]:r.byday.length?r.byday:[fromYmd(e.inicio.f).getDay()],...h,
        ...(e.inicio.f>hoy?{desde:e.inicio.f}:{}),...(fin?{hasta:fin}:{})});
      // Ese día no hay (EXDATE) o se movió (RECURRENCE-ID): queda libre; si se movió, el nuevo horario es de un día.
      const libre=(f,min)=>{if(enV(f)&&!c.libres.some(l=>l.gcal===`l:${e.uid}:${f}`))c.libres.push({gcal:`l:${e.uid}:${f}`,rutina:k,date:f,...hora(min,e.dur)});};
      for(const x of e.exdates)libre(x.f,x.min);
      for(const [f,x] of movidas){libre(f,x.rid.min);evento(`e:${e.uid}:${f}`,x,e);}
      continue;}
    const ex=new Set(e.exdates.map(x=>x.f));
    for(const f of oc.fechas){if(ex.has(f))continue;const x=movidas.get(f);if(x)evento(`e:${e.uid}:${f}`,x,e);else evento(`e:${e.uid}:${f}`,{...e,inicio:{...e.inicio,f}},e);}}
  c.eventos.sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));c.eventos=c.eventos.slice(0,300);
  c.evals.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return c;}
// Lo que ya está en LIA (escrito a mano o del consolidado) no se propone dos veces.
function yaEnLia(st,x){const n=s=>norm(String(s||'')).replace(/\s+/g,' ').trim(),k=x.gcal[0];
  if(k==='r')return st.commitments.some(c=>!c.gcal&&n(c.name)===n(x.name)&&c.start===x.start&&c.end===x.end&&x.days.some(d=>c.days.includes(d)));
  if(k==='v')return st.evals.some(e=>!e.gcal&&n(e.course)===n(x.course)&&e.date===x.date);
  if(k==='e')return st.exceptions.some(e=>!e.gcal&&!e.libre&&e.date===x.date&&e.start===x.start&&e.end===x.end&&n(e.label)===n(x.label));
  return false;}
function huellaGcal(o){const k=String(o.gcal||'')[0];
  return k==='r'?[o.name,o.type,(o.days||[]).join(','),o.start,o.end,o.desde||'',o.hasta||''].join('|'):k==='v'?[o.type,o.course,o.date,o.time].join('|')
    :[o.date,o.start,o.end,o.label,o.cat||'',o.libre?1:0].join('|');}
// Junta lo que trae Google con lo guardado, sin mutar st. Lo nuevo entra; lo que cambió en Google se actualiza; lo que
// se borró en Google se quita si aún no pasó. Lo que la persona cambió o borró en LIA (o no eligió) queda en ignorar, y
// también lo nuevo que ya tenía en LIA (escrito a mano o del consolidado). op: {elegidos (la primera vez), cupoEvals, nuevoId}.
function fusionarGcal(st,cand,hoy,op={}){const g=st.gcal||{},nuevoId=op.nuevoId||(()=>Math.random().toString(36).slice(2,10));
  const ign=new Set(g.ignorar||[]),cambios={nuevos:0,cambiados:0,quitados:0},rutinas=cand.rutinas||[],libresC=cand.libres||[],eventos=cand.eventos||[],evals=cand.evals||[];
  if(op.elegidos)for(const x of [...rutinas,...libresC,...eventos,...evals])if(!op.elegidos.has(x.gcal))ign.add(x.gcal);
  let cs=st.commitments.map(c=>({...c})),xs=st.exceptions.map(x=>({...x})),es=st.evals.map(e=>({...e})),done=[...st.done];
  const presentes=new Set([...cs,...xs,...es].filter(o=>o.gcal).map(o=>o.gcal));
  for(const k of g.traidos||[])if(!presentes.has(k))ign.add(k);
  for(const o of [...cs,...xs,...es])if(o.gcal&&o.gh&&o.gh!==huellaGcal(o))ign.add(o.gcal);
  const vivo=o=>o.gcal&&!ign.has(o.gcal),repetido=x=>{if(op.elegidos||!yaEnLia(st,x))return false;ign.add(x.gcal);return true;};
  const actualizar=(lista,M,campos)=>{for(const o of lista){if(!vivo(o)||!M.has(o.gcal))continue;const v=campos(M.get(o.gcal));
    if(huellaGcal({...o,...v})!==o.gh){Object.assign(o,v);o.gh=huellaGcal(o);cambios.cambiados++;}}};
  // Rutinas
  const R=new Map(rutinas.map(r=>[r.gcal,r])),fuera=new Set(),campoR=r=>({name:r.name,type:r.type,days:[...r.days],start:r.start,end:r.end,...(r.desde?{desde:r.desde}:{}),...(r.hasta?{hasta:r.hasta}:{})});
  cs=cs.filter(c=>{if(!vivo(c)||R.has(c.gcal))return true;fuera.add(c.id);cambios.quitados++;return false;});
  actualizar(cs,R,r=>({desde:undefined,hasta:undefined,...campoR(r)}));
  for(const c of cs){if(c.desde===undefined)delete c.desde;if(c.hasta===undefined)delete c.hasta;}
  for(const r of rutinas){if(ign.has(r.gcal)||cs.some(c=>c.gcal===r.gcal)||repetido(r))continue;const c={id:nuevoId(),...campoR(r),gcal:r.gcal};c.gh=huellaGcal(c);cs.push(c);cambios.nuevos++;}
  const porClave=new Map(cs.filter(c=>c.gcal).map(c=>[c.gcal,c])),suelta=id=>{const c=cs.find(x=>x.id===id);return !!(c&&c.gcal&&ign.has(c.gcal));};
  // Ratos libres de las rutinas y eventos de un día
  const X=new Map();
  for(const l of libresC){const c=porClave.get(l.rutina);if(c&&!ign.has(l.rutina))X.set(l.gcal,{date:l.date,start:l.start,end:l.end,label:`Sin ${c.name}`.slice(0,40),libre:true,ref:c.id});}
  for(const e of eventos)if(!xs.some(x=>x.gcal===e.gcal)&&!ign.has(e.gcal)&&repetido(e))continue;else X.set(e.gcal,{date:e.date,start:e.start,end:e.end,label:e.label,cat:e.cat});
  xs=xs.filter(x=>{if(x.libre&&fuera.has(x.ref))return false;if(!vivo(x)||X.has(x.gcal)||x.date<hoy||(x.libre&&suelta(x.ref)))return true;cambios.quitados++;return false;});
  actualizar(xs,X,o=>o);
  for(const [k,o] of X){if(ign.has(k)||xs.some(x=>x.gcal===k))continue;const x={id:nuevoId(),...o,gcal:k};x.gh=huellaGcal(x);xs.push(x);cambios.nuevos++;}
  // Evaluaciones (en Gratis, hasta el cupo; las demás esperan sin ignorarse)
  const V=new Map(evals.map(v=>[v.gcal,v])),sinEval=new Set(),campoV=v=>({type:v.type,course:v.course,date:v.date,time:v.time});
  es=es.filter(e=>{if(!vivo(e)||V.has(e.gcal)||e.date<hoy)return true;sinEval.add(e.id);cambios.quitados++;return false;});
  if(sinEval.size)done=done.filter(d=>!sinEval.has(d.evalId));
  actualizar(es,V,campoV);
  let cupo=op.cupoEvals===undefined?Infinity:op.cupoEvals,sinCupo=0;const nuevasEvals=[];
  for(const v of evals){if(ign.has(v.gcal)||es.some(e=>e.gcal===v.gcal)||repetido(v))continue;
    if(v.date>=hoy){if(cupo<=0){sinCupo++;continue;}cupo--;}
    const e={id:nuevoId(),...campoV(v),hours:(EVAL_TYPES[v.type]||EVAL_TYPES.parcial).h,gcal:v.gcal};e.gh=huellaGcal(e);es.push(e);nuevasEvals.push(e.id);cambios.nuevos++;}
  const ignorar=[...ign].filter(k=>{const m=/:(\d{4}-\d{2}-\d{2})$/.exec(k);return !m||m[1]>=hoy;}).slice(-2000);
  return{commitments:cs,exceptions:xs,evals:es,done,gcal:{...g,ignorar,traidos:[...cs,...xs,...es].filter(o=>o.gcal).map(o=>o.gcal)},cambios,nuevasEvals,sinCupo};}
// ---- Iteración 3: cruces y duplicados ----
// Cruces lado a lado (docs/iteracion-3.md, §5), con el algoritmo de columnas de Google Calendar: lo que se toca, aunque sea
// en cadena, forma un grupo; dentro del grupo, cada actividad va en la primera columna donde lo anterior ya terminó (a la
// misma hora, la más larga primero) y todas comparten el número de columnas (cols), así ninguna caja pisa a otra.
// span: cuántas columnas ocupa hacia la derecha sin pisar a nadie. items: [{s,e,…}] en minutos.
// Devuelve copias en orden de inicio, con {col, cols, span, grupo}.
function columnasCruces(items){
  const xs=(Array.isArray(items)?items:[]).map((x,i)=>({x,i})).filter(({x})=>x&&Number.isFinite(x.s)&&Number.isFinite(x.e))
    .sort((a,b)=>a.x.s-b.x.s||(b.x.e-b.x.s)-(a.x.e-a.x.s)||a.i-b.i);
  const out=[];let grupo=[],fines=[],hasta=-Infinity,g=0;
  const cerrar=()=>{for(const o of grupo){let k=o.col+1;while(k<fines.length&&!grupo.some(q=>q.col===k&&q.s<o.e&&o.s<q.e))k++;o.cols=fines.length;o.span=k-o.col;}
    grupo=[];fines=[];g++;};
  for(const {x} of xs){const e=Math.max(x.s,x.e);if(grupo.length&&x.s>=hasta)cerrar();
    let c=fines.findIndex(f=>f<=x.s);if(c<0){c=fines.length;fines.push(e);}else fines[c]=e;
    const o={...x,col:c,grupo:g};grupo.push(o);out.push(o);hasta=grupo.length===1?e:Math.max(hasta,e);}
  if(grupo.length)cerrar();
  return out;}
// Los grupos, para las listas: {s, e, cols, items}. Con cols de 2 o más, hay actividades a la vez.
function gruposCruce(items){const out=[];
  for(const o of columnasCruces(items)){const g=out[o.grupo]||(out[o.grupo]={s:o.s,e:o.e,cols:o.cols,items:[]});g.items.push(o);if(o.e>g.e)g.e=o.e;}
  return out;}
// Lo de un día del calendario (de 0:00 a 24:00), para la cuadrícula de Semana: lo que pasa la medianoche se corta y sigue
// al día siguiente. Las rutinas y lo de un día ya llegan así desde busyFor; el estudio y las evaluaciones se pasan aquí.
const SIGUE_DE_NOCHE=new Set(['estudio','hecho','examen']);
function itemsCalendario(state,P,date){const ayer=ymd(addDays(fromYmd(date),-1));
  const deAnoche=agendaFor(state,P,ayer).filter(x=>SIGUE_DE_NOCHE.has(x.kind)&&x.e>1440).map(x=>({...x,s:Math.max(0,x.s-1440),e:x.e-1440,deAnoche:true}));
  const hoy=agendaFor(state,P,date).filter(x=>x.s<1440).map(x=>x.e>1440?{...x,e:1440,sigue:true}:x);
  return [...deAnoche,...hoy].sort((a,b)=>a.s-b.s);}
// Duplicados y cruces antes de guardar (docs/iteracion-3.md, §5). item, lo que se va a guardar:
//   {kind:'commit', name, days, start, end}  un horario de una rutina (con varios horarios, choquesTramos)
//   {kind:'evento', label, date, start, end}  algo de un solo día
//   {kind:'eval', type, course, date, time}   una evaluación: ocupa 2 horas, como se ve en «Tu día»
// excluir: ids que no cuentan (lo que se está editando). Duplicado: lo mismo con el mismo nombre (sin tildes ni mayúsculas),
// el mismo día y las mismas horas. Cruces: rutinas, eventos de un día y evaluaciones que se pisan con él; el estudio no
// cuenta, ni lo liberado ese día, ni lo que ya pasó. Una evaluación y una clase tampoco: los exámenes suelen ser en horas
// de clase (type o cat 'clase'). Devuelve {duplicado, cruces}, cada uno {ref, kind, nombre, s, e} con dias (una rutina:
// los días en que empieza lo que se cruza) o date (algo de un día o una evaluación).
const DUR_EVAL=120;
const nombreN=s=>norm(String(s||'')).replace(/\s+/g,' ').trim();
function choques(state,item,now,excluir){const nada={duplicado:null,cruces:[]},fuera=new Set(excluir||[]),hoy=ymd(now),ok=v=>typeof v==='string'&&HHMM.test(v);
  if(!item||typeof item!=='object')return nada;
  const semanal=item.kind==='commit',esEval=item.kind==='eval',esClase=tipoRutina(semanal?item.type:item.kind==='evento'?item.cat:'')==='clase';
  // Un examen suele ser en su propia clase: una evaluación no cruza con la rutina de clases de su mismo curso (sí con la
  // de otro curso), ni con clases que no dicen de qué curso son (una de un día, o «Clases», «Universidad»).
  const generico=n=>/^(clases?|universidad|facultad|cursos?|la u|u|estudios?)$/.test(n);
  const deClase=o=>tipoRutina(o.type||o.cat||'')==='clase',mismoCurso=o=>o.label!==undefined||generico(nombreN(o.name))||nombreN(o.name)===nombre;
  const cuenta=o=>esEval?!(deClase(o)&&mismoCurso(o)):true,cuentaE=e=>!esClase||(item.kind!=='evento'&&!generico(nombre)&&nombreN(e.course)!==nombre);
  if(semanal&&!(Array.isArray(item.days)&&item.days.length&&ok(item.start)&&ok(item.end)&&item.start!==item.end))return nada;
  if(item.kind==='evento'&&!(fechaIA(item.date)&&ok(item.start)&&ok(item.end)&&item.start!==item.end))return nada;
  if(esEval&&!(fechaIA(item.date)&&ok(item.time)&&EVAL_TYPES[item.type]))return nada;
  if(!semanal&&!esEval&&item.kind!=='evento')return nada;
  const N=esEval?{s:toMin(item.time),e:toMin(item.time)+DUR_EVAL}:intervalo(item.start,item.end),nombre=nombreN(esEval?item.course:semanal?item.name:item.label);
  const pisa=(a,b,o)=>a.s<b.e+o&&b.s+o<a.e;
  const rut=state.commitments.filter(c=>!fuera.has(c.id)&&(!c.hasta||c.hasta>=hoy)&&Array.isArray(c.days));
  const evs=state.exceptions.filter(x=>!x.libre&&!fuera.has(x.id)&&fechaIA(x.date));
  const evals=state.evals.filter(e=>!fuera.has(e.id)&&fechaIA(e.date)&&HHMM.test(e.time||''));
  const deRut=(c,dias)=>({ref:c.id,kind:'commit',nombre:c.name,dias,...intervalo(c.start,c.end)});
  const deEv=x=>({ref:x.id,kind:'evento',nombre:x.label,date:x.date,...intervalo(x.start,x.end)});
  const deEval=e=>({ref:e.id,kind:'eval',nombre:`${(EVAL_TYPES[e.type]||EVAL_TYPES.parcial).label} de ${e.course}`,date:e.date,s:toMin(e.time),e:toMin(e.time)+DUR_EVAL});
  let duplicado=null;const cruces=[];
  if(semanal){const dias=[...new Set(item.days)];
    // Desfase de un día cd respecto de un día nd de lo nuevo: el mismo día, el siguiente (+1440) o el anterior (-1440).
    const desfase=(nd,cd)=>cd===nd?0:cd===(nd+1)%7?1440:cd===(nd+6)%7?-1440:null;
    for(const c of rut){const C=intervalo(c.start,c.end),comunes=dias.filter(d=>c.days.includes(d));
      if(!duplicado&&!esEval&&comunes.length&&nombreN(c.name)===nombre&&C.s===N.s&&C.e===N.e){duplicado=deRut(c,comunes);continue;}
      const en=new Set();for(const nd of dias)for(const cd of c.days){const o=desfase(nd,cd);if(o!==null&&pisa(N,C,o))en.add(cd);}
      if(en.size)cruces.push(deRut(c,[...en]));}
    for(const D of [...evs.filter(x=>x.date>=hoy).map(deEv),...evals.filter(e=>e.date>=hoy&&cuentaE(e)).map(deEval)]){const wd=fromYmd(D.date).getDay();
      if(!duplicado&&D.kind==='evento'&&dias.includes(wd)&&nombreN(D.nombre)===nombre&&D.s===N.s&&D.e===N.e){duplicado=D;continue;}
      if(dias.some(nd=>{const o=desfase(nd,wd);return o!==null&&pisa(N,D,o);}))cruces.push(D);}}
  else{const f=item.date,wd=fromYmd(f).getDay(),sig=ymd(addDays(fromYmd(f),1));
    if(!esEval){for(const c of rut)if(!duplicado&&c.days.includes(wd)&&vigente(c,f)&&nombreN(c.name)===nombre&&c.start===item.start&&c.end===item.end)duplicado=deRut(c,[wd]);
      for(const x of evs)if(!duplicado&&x.date===f&&nombreN(x.label)===nombre&&x.start===item.start&&x.end===item.end)duplicado=deEv(x);}
    else for(const e of evals)if(!duplicado&&e.date===f&&e.time===item.time&&nombreN(e.course)===nombre)duplicado=deEval(e);
    // Lo ocupado ese día (sin lo liberado), y lo de temprano al día siguiente si pasa la medianoche.
    const ocup=[...busyFor(state,f).map(b=>({b,o:0,dia:b.cola?(wd+6)%7:wd})),...(N.e>1440?busyFor(state,sig).filter(b=>!b.cola).map(b=>({b,o:1440,dia:(wd+1)%7})):[])];
    const vistos=new Set(duplicado?[duplicado.ref]:[]);
    for(const {b,o,dia} of ocup){if(fuera.has(b.ref)||vistos.has(b.ref)||!pisa(N,b,o))continue;vistos.add(b.ref);
      const c=state.commitments.find(y=>y.id===b.ref),x=!c&&state.exceptions.find(y=>y.id===b.ref);
      if(c&&cuenta(c))cruces.push(deRut(c,[dia]));else if(x&&cuenta(x))cruces.push(deEv(x));}
    for(const e of evals.filter(cuentaE)){const k=dayDiff(f,e.date);if(Math.abs(k)>1||vistos.has(e.id))continue;const E=deEval(e);if(pisa(N,E,k*1440)){vistos.add(e.id);cruces.push(E);}}}
  const clave=c=>(c.date?'1'+c.date:'0')+String(c.s+10000);
  return{duplicado,cruces:cruces.filter(c=>!duplicado||c.ref!==duplicado.ref).sort((a,b)=>clave(a).localeCompare(clave(b)))};}
// Una rutina con varios horarios: se revisa cada uno y un mismo cruce se nombra una vez, con todos sus días.
function choquesTramos(state,r,now,excluir){let duplicado=null;const cruces=[];
  for(const t of (r&&Array.isArray(r.tramos)?r.tramos:[])){const x=choques(state,{kind:'commit',name:r.name,type:r.type,days:t.days,start:t.start,end:t.end},now,excluir);
    if(!duplicado&&x.duplicado)duplicado=x.duplicado;
    for(const c of x.cruces){const y=cruces.find(z=>z.ref===c.ref);if(!y)cruces.push(c.dias?{...c,dias:[...c.dias]}:c);else if(y.dias&&c.dias)y.dias=[...new Set([...y.dias,...c.dias])];}}
  return{duplicado,cruces:cruces.filter(c=>!duplicado||c.ref!==duplicado.ref)};}
// «9:00», «13:30»: como se dice la hora en el aviso.
const horaC=m=>{m=((Math.round(m)%1440)+1440)%1440;return `${Math.floor(m/60)}:${pad(m%60)}`;};
function diasFrase(ds,art){const s=[...new Set(ds)].sort((a,b)=>((a+6)%7)-((b+6)%7)),k=s.join();
  if(k==='1,2,3,4,5')return 'de lunes a viernes';if(k==='1,2,3,4,5,6')return 'de lunes a sábado';if(s.length===7)return 'todos los días';
  const n=s.map(d=>(art?'el ':'')+DIAS[d]);return n.length>1?n.slice(0,-1).join(', ')+' y '+n[n.length-1]:n[0]||'';}
function cuandoChoque(c,dup){const h=dup?(c.kind==='eval'?`a las ${horaC(c.s)}`:`de ${horaC(c.s)} a ${horaC(c.e)}`):`${horaC(c.s)}–${horaC(c.e)}`;
  if(c.date)return dup?`el ${fechaLarga(c.date)} ${h}`:`${fechaLarga(c.date)}, ${h}`;
  return dup?`${diasFrase(c.dias,true)} ${h}`:`${diasFrase(c.dias)}, ${h}`;}
// «Ya tienes «Almuerzo» el lunes de 13:00 a 14:30.» o «Se cruza con «Trabajo» (lunes, 9:00–18:00).» Vacío si no hay nada.
function textoChoques(r){if(!r)return '';
  if(r.duplicado)return `Ya tienes «${r.duplicado.nombre}» ${cuandoChoque(r.duplicado,true)}.`;
  const cs=r.cruces||[],q=c=>`«${c.nombre}» (${cuandoChoque(c,false)})`;
  if(!cs.length)return '';if(cs.length===1)return `Se cruza con ${q(cs[0])}.`;if(cs.length===2)return `Se cruza con ${q(cs[0])} y con ${q(cs[1])}.`;
  return `Se cruza con ${q(cs[0])}, ${q(cs[1])} y ${cs.length-2} más.`;}
// Evaluación ligada a un curso (§5): los cursos son las rutinas de clases, sin repetir y sin el nombre genérico «Clases».
// Una evaluación queda ligada a la clase que tiene su mismo nombre (sin tildes ni mayúsculas).
const esGenerico=n=>/^clases?$/.test(nombreN(n));
function cursosClase(state){const out=[],vistos=new Set();
  for(const c of state.commitments||[]){const k=nombreN(c.name);if(tipoRutina(c.type)!=='clase'||!k||esGenerico(k)||vistos.has(k))continue;vistos.add(k);out.push(c.name);}
  return out;}
function claseDeEval(state,e){const k=nombreN(e&&e.course);if(!k||esGenerico(k))return null;
  return (state.commitments||[]).find(c=>tipoRutina(c.type)==='clase'&&nombreN(c.name)===k)||null;}

return { pad, toMin, fmt, ymd, fromYmd, addDays, dayDiff, DIAS, DIAS_C, MESES, EVAL_TYPES, COMMIT_TYPES, tipoRutina, uid, hrs, fechaLarga, fechaCorta, subtract, MARGEN_DESPERTAR, finDelDia, intervalo, vigente, busyFor, reacomodar, resumenSemana, mondayDe, agruparRutinas, crucesTramo, ocupadoMarco, evalDeadline, MADRUGADA, nochesDeEstudio, doneFor, plan, claveBloque, estudiado, finBloque, planCongelado, bloquesQueChocan, sumarAlCongelado, SEMANAS_CICLO, lunesDe, inicioCiclo, cargaCiclo, semanaPesada, agendaFor, esEstudio, tramosDia, resumenDia, huecosDia, esOcio, ocioParaEstudio, reubicarCongelado, norm, DAYW, EVAL_KW, COMMIT_KW, NUMW, MESN, TIMECTX, tokenize, H, partOf, Q, HQ, adj, horasPosibles, rangoProbable, parseTimes, nextWeekday, NUM_REL, RE_REL, semanaSinDia, diaEnSemanas, fechaRelativa, parseDate, unSoloDia, finDespues, diaDelMes, diaConNumero, parseDays, STOPW, SKIPW, cap, extractCourse, hasTime, splitClauses, ENTREGA_N, TRABAJO_ENTREGA, evalDe, NOMBRE_KW, nombreRutina, tipoPorNombre, ROMANOS, palCurso, cursosConocidos, cursoParecido, parseClause, rutinaDicha, EVENTO, nombreEvento, REPITE, RANGO_DIAS, frasePropia, rutinaSemanal, NO_VA, ESTUDIE, AVANCE_SUST, estudie, QUITAR_RUT, ENTRO, EN_VEZ, CAMBIA_RUT, AGENDAR, rutinasNombradas, queAgendar, minutosDichos, fechaPasada, evalMencionada, MUEVE_FIRME, MUEVE_DEBIL, QUITA_EVAL, JUNTO_PASA, JUNTO_CORTA, esEvalTok, evalJunto, disparadores, fechaHoraNueva, evalesAludidas, cambioDeEval, cuandoEsEval, QUITAR, YA_NO_HAY, NO_NOMBRE, esNombreQuitar, nombreQuitar, nombreQuitarTexto, puntosNombre, cosasDelDia, elDia, aLa, conPunto, diasRutina, avisoQuitarRutina, quitarAlgo, propuestaQuitar, cosaQuitar, cualQuitar, alcanceDicho, finQuitar, textoQuitar, sinLoQuitado, BORRADOR_MS, FRANJA_RUTINA, FRANJA_EVENTO, CAT_EVENTO, faltaDe, minus, nombreEval, conArticulo, delDia, otra, preguntaPara, borradorVigente, continuarBorrador, preguntaSemana, respuestaBorrador, cualDeEstas, preguntaAgenda, CHARLA, RELLENO, charla, sinYSi, simular, interpret, interpretFrase, pideIA, contextoIA, historialIA, HHMM, fechaIA, textoIA, validarIA, contextoWhatsapp, revisarPropuesta, catEvento, DIA_CONS, leerConsolidado, rutinaDeCurso, iso, eventosCanales, eventosGoogle, GC, ICS_DIA, TZ_WINDOWS, diaN, sumarDias, desfaseTz, horaLima, duracionIcs, textoIcs, lineaIcs, leerIcs, cerrarVevento, ocurrencias, GC_EVAL, GC_RELLENO, palabrasIcs, normPal, evalDeTitulo, catDeTitulo, deCalendario, yaEnLia, huellaGcal, fusionarGcal, columnasCruces, gruposCruce, SIGUE_DE_NOCHE, itemsCalendario, DUR_EVAL, nombreN, choques, choquesTramos, horaC, diasFrase, cuandoChoque, textoChoques, esGenerico, cursosClase, claseDeEval };
}
export const L = crear();
