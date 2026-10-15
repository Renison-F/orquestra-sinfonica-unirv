/* Consulta exclusivamente o resumo público; justificativas não são baixadas. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const format = n => n == null ? '—' : `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(n))}%`;
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const set = (id,val) => {el(id).textContent=String(val);};
  function chart(totals) {
    const canvas=el('publicDistribution');const box=canvas.getBoundingClientRect();const dpr=Math.min(2,devicePixelRatio||1);
    const width=Math.round(box.width||220),height=Math.round(box.height||220);canvas.width=width*dpr;canvas.height=height*dpr;
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
    const cx=width/2,cy=height/2,r=Math.min(width,height)*.37,thick=Math.min(width,height)*.12;
    ctx.lineWidth=thick;ctx.strokeStyle='#e5e9ec';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
    const values=[totals.present,totals.partial,totals.justified,totals.absent].map(Number);
    const total=values.reduce((a,b)=>a+b,0);if(!total)return;
    const colors=['#248975','#4888bd','#c99b59','#cf6667'];let angle=-Math.PI/2;
    values.forEach((count,i)=>{if(!count)return;const sweep=Math.PI*2*count/total;
      ctx.beginPath();ctx.strokeStyle=colors[i];ctx.arc(cx,cy,r,angle+0.014,angle+sweep-0.014);ctx.stroke();angle+=sweep;
    });
  }
  function view(data) {
    const {members=[],rehearsalCount=0,lastRehearsal,totals={}}=data;
    set('statFrequency',format(totals.frequency));set('statMembers',members.filter(m=>m.active).length);
    set('statRehearsals',rehearsalCount);set('statPartial',totals.partial??0);
    set('statFrequencyDetail',`${totals.recorded||0} chamadas concluídas`);
    set('memberCounter',`${members.length} músicos`);set('donutRate',format(totals.frequency));
    for(const [id,key] of [['countPresent','present'],['countPartial','partial'],['countJustified','justified'],['countAbsent','absent'],['countRecorded','recorded']]) set(id,totals[key]??0);
    if(lastRehearsal?.date){const [year,month,day]=lastRehearsal.date.split('-');set('lastDate',`${day}/${month}/${year} · ${lastRehearsal.time||''}`);set('lastPlace',lastRehearsal.location||'—');}
    const grid=el('musicianGrid');
    grid.innerHTML=members.length ? [...members].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(member=>{
      const f=Number(member.frequency??0);const name=escapeHtml(member.name);const initials=escapeHtml(member.name.trim().split(/\s+/).slice(0,2).map(v=>v[0]?.toUpperCase()).join(''));
      const width=Math.max(0,Math.min(100,f));
      return `<article class="musician-card"><div class="musician-top"><span class="musician-avatar">${initials}</span><span class="musician-title"><strong>${name}</strong><small>${member.active?'Integrante do naipe':'Inativo'}</small></span><span class="musician-rate">${format(member.frequency)}</span></div><progress class="frequency-track" max="100" value="${width}" aria-label="Frequência de ${name}">${Math.round(width)}%</progress><div class="musician-stats"><span><i class="fa-solid fa-check" aria-hidden="true"></i> ${member.present} integrais</span><span><i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i> ${member.partial} parciais</span><span><i class="fa-solid fa-xmark" aria-hidden="true"></i> ${member.justified+member.absent} faltas</span></div><div class="musician-caption">${member.recorded} chamada(s) concluída(s)${member.pending?` · ${member.pending} pendente(s)`:''}</div></article>`;
    }).join('') : '<p class="empty-message">Nenhum integrante publicado ainda.</p>';
    chart(totals);window.addEventListener('resize',()=>chart(totals),{passive:true});
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    const alert=el('appAlert');const db=window.OrchestraDB;
    if(!db?.ready){alert.classList.add('is-error');alert.textContent=db?.error||'Configure o Supabase antes de publicar o painel.';return;}
    try{
      const {data,error}=await db.client.from('public_snapshot').select('payload').eq('id',1).single();
      if(error)throw error;view(data.payload);alert.classList.add('is-success');alert.innerHTML='<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Indicadores sincronizados com o banco de dados.';
    }catch(err){alert.classList.add('is-error');alert.textContent=`Não foi possível consultar os indicadores: ${err.message}`;}
  });
})();
