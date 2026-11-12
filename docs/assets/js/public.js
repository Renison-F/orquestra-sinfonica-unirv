/* Consulta exclusivamente o resumo público; justificativas não são baixadas. */
(() => {
  'use strict';
  const ABSENCE_LIMIT = 25;   // % máximo de faltas aceito
  const ABSENCE_WARNING = 20; // % a partir do qual o músico recebe alerta de atenção

  const el = id => document.getElementById(id);
  const nf = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1});
  const format = n => n == null ? '—' : `${nf.format(Number(n))}%`;
  const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const set = (id, val) => { el(id).textContent = String(val); };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const dayMonth = date => { const [, m, d] = String(date).split('-'); return `${d}/${m}`; };
  const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  const LABEL = {presente:'Presença integral', parcial:'Presença parcial', justificada:'Falta justificada', falta:'Falta não justificada', pendente:'Chamada pendente'};
  const ICON = {presente:'fa-solid fa-check', parcial:'fa-solid fa-circle-half-stroke', justificada:'fa-solid fa-file-lines', falta:'fa-solid fa-xmark', pendente:'fa-regular fa-clock'};
  /* Ícones dos pontos de situação (Font Awesome Free 7.3.1 em SVG, ver icons.js). */
  const DOT_ICON = {presente: 'check', parcial: 'circle-half-stroke', justificada: 'file-lines', falta: 'xmark', pendente: 'regular/clock'};
  const dotIcon = status => DOT_ICON[status] ? window.OrchestraIcons.svg(DOT_ICON[status], 'st-ico') : '';
  const CHIP = {falta:'Falta', justificada:'Justificada', parcial:'Parcial'};
  const isMiss = s => s === 'falta' || s === 'justificada' || s === 'parcial';

  /* Taxa de faltas = complemento da frequência (parcial conta meia falta). */
  function absenceOf(member) {
    if (!member.recorded) return null;
    return Math.round((100 - Number(member.frequency ?? 0)) * 10) / 10;
  }
  /* Quantas faltas integrais ainda cabem no limite, considerando as chamadas já concluídas. */
  function marginOf(member) {
    const missUnits = member.justified + member.absent + member.partial * 0.5;
    const limit = ABSENCE_LIMIT / 100;
    return Math.floor((limit * member.recorded - missUnits) / (1 - limit) + 1e-9);
  }
  /* Quantas presenças integrais seguidas trazem a taxa de faltas de volta ao limite. */
  function presencesToRecover(member) {
    const missUnits = member.justified + member.absent + member.partial * 0.5;
    return Math.max(0, Math.ceil(missUnits / (ABSENCE_LIMIT / 100) - member.recorded - 1e-9));
  }
  function levelOf(member) {
    const rate = absenceOf(member);
    if (rate == null) return 'none';
    if (rate > ABSENCE_LIMIT) return 'over';
    if (rate >= ABSENCE_WARNING) return 'warn';
    return 'ok';
  }

  function chart(totals) {
    const canvas = el('publicDistribution'); const box = canvas.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
    const width = Math.round(box.width || 220), height = Math.round(box.height || 220); canvas.width = width * dpr; canvas.height = height * dpr;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = width / 2, cy = height / 2, r = Math.min(width, height) * .37, thick = Math.min(width, height) * .12;
    ctx.lineWidth = thick; ctx.strokeStyle = '#e5e9ec'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const values = [totals.present, totals.partial, totals.justified, totals.absent].map(Number);
    const total = values.reduce((a, b) => a + b, 0); if (!total) return;
    const colors = ['#248975', '#4888bd', '#c99b59', '#cf6667']; let angle = -Math.PI / 2;
    values.forEach((count, i) => {
      if (!count) return; const sweep = Math.PI * 2 * count / total;
      ctx.beginPath(); ctx.strokeStyle = colors[i]; ctx.arc(cx, cy, r, angle + 0.014, angle + sweep - 0.014); ctx.stroke(); angle += sweep;
    });
  }

  function statusBadge(level) {
    if (level === 'over') return '<span class="limit-badge over"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Acima do limite</span>';
    if (level === 'warn') return '<span class="limit-badge warn"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Atenção</span>';
    if (level === 'ok') return '<span class="limit-badge ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Regular</span>';
    return '';
  }
  function marginText(member, level) {
    if (level === 'none') return '';
    const rate = absenceOf(member);
    if (level === 'over') {
      const need = presencesToRecover(member);
      return `<div class="limit-note over"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> <span>Faltou em <b>${format(rate)}</b> das chamadas, acima do limite de ${ABSENCE_LIMIT}%. Precisa de <b>${plural(need, 'presença seguida', 'presenças seguidas')}</b> para voltar ao limite.</span></div>`;
    }
    const k = marginOf(member);
    const tail = k <= 0 ? 'Nenhuma nova falta cabe no limite.' : `Pode faltar mais ${plural(k, 'ensaio', 'ensaios')} sem ultrapassar ${ABSENCE_LIMIT}%.`;
    return `<div class="limit-note ${level}"><i class="fa-solid ${level === 'warn' ? 'fa-circle-exclamation' : 'fa-shield-halved'}" aria-hidden="true"></i> ${tail}</div>`;
  }

  function card(member) {
    const name = escapeHtml(member.name);
    const initials = escapeHtml(member.name.trim().split(/\s+/).slice(0, 2).map(v => v[0]?.toUpperCase()).join(''));
    /* Ensaios futuros não entram na linha do tempo, exceto o próximo. */
    const history = (Array.isArray(member.history) ? member.history : []).filter(h => startsAt(h) <= new Date() || `${h.date} ${h.time}` === nextKey);
    const level = levelOf(member);
    const faults = member.justified + member.absent;
    const segments = [['presente', member.present], ['parcial', member.partial], ['justificada', member.justified], ['falta', member.absent]]
      .filter(([, c]) => c).map(([s, c]) => `<span class="s-${s}" style="flex:${c}" title="${LABEL[s]}: ${c}"></span>`).join('');
    const misses = history.filter(h => isMiss(h.status));
    const timeline = history.length ? `<div class="timeline"><div class="timeline-head"><span>LINHA DO TEMPO</span><span>${plural(history.length, 'ensaio', 'ensaios')}</span></div>
      <div class="tl-row">${history.map(h => { const miss = isMiss(h.status); const d = dayMonth(h.date); return `<div class="tl-item${miss ? ' miss' : ''}" title="${d} · ${LABEL[h.status] || h.status}"><span class="tl-dot s-${escapeHtml(h.status)}">${dotIcon(h.status)}</span><span class="tl-date">${d}</span></div>`; }).join('')}</div>
      ${misses.length ? `<div class="miss-list">${misses.map(h => `<span class="miss-chip ${h.status}"><i class="${ICON[h.status]}" aria-hidden="true"></i>${dayMonth(h.date)} · ${CHIP[h.status]}</span>`).join('')}</div>` : '<div class="no-miss"><i class="fa-solid fa-medal" aria-hidden="true"></i> Nenhuma falta registrada</div>'}</div>` : '';
    return `<article class="musician-card level-${level}" id="musico-${escapeHtml(member.id)}" data-name="${escapeHtml(fold(member.name))}">
      <div class="musician-top"><span class="musician-avatar">${initials}</span><span class="musician-title"><strong>${name}</strong><small>${member.active ? 'Integrante do naipe' : 'Inativo'} ${statusBadge(level)}</small></span>
      <span class="mc-rates"><span class="mc-rate ok"><b>${format(member.frequency)}</b><small>PRESENÇA</small></span><span class="mc-rate bad"><b>${format(absenceOf(member))}</b><small>FALTAS</small></span></span></div>
      <div class="split-wrap"><div class="split-track" role="img" aria-label="Presença ${format(member.frequency)}, faltas ${format(absenceOf(member))}">${segments}</div><span class="limit-marker" style="left:${100 - ABSENCE_LIMIT}%" title="Limite de ${ABSENCE_LIMIT}% de faltas"></span></div>
      <div class="musician-stats"><span><i class="fa-solid fa-check" aria-hidden="true"></i> ${plural(member.present, 'integral', 'integrais')}</span><span><i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i> ${plural(member.partial, 'parcial', 'parciais')}</span><span><i class="fa-solid fa-xmark" aria-hidden="true"></i> ${plural(faults, 'falta', 'faltas')} <small>(${member.justified} just. · ${member.absent} não just.)</small></span></div>
      ${marginText(member, level)}
      ${timeline}
      <div class="musician-caption">${member.recorded} chamada(s) concluída(s)${member.pending ? ` · ${member.pending} pendente(s)` : ''}</div></article>`;
  }

  function limitAlert(members) {
    const box = el('limitAlert');
    const over = members.filter(m => m.active && levelOf(m) === 'over');
    const warn = members.filter(m => m.active && levelOf(m) === 'warn');
    if (!over.length && !warn.length) { box.hidden = true; return; }
    const link = m => `<a href="#musico-${escapeHtml(m.id)}" class="alert-person">${escapeHtml(m.name)} <b>${format(absenceOf(m))}</b></a>`;
    box.className = `limit-alert ${over.length ? 'over' : 'warn'}`;
    box.innerHTML = `<span class="limit-alert-icon"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></span>
      <div class="limit-alert-body"><strong>${over.length ? `${plural(over.length, 'músico acima', 'músicos acima')} do limite de ${ABSENCE_LIMIT}% de faltas` : `${plural(warn.length, 'músico próximo', 'músicos próximos')} do limite de ${ABSENCE_LIMIT}% de faltas`}</strong>
      ${over.length ? `<div class="alert-row"><span class="alert-tag over">Acima do limite</span>${over.map(link).join('')}</div>` : ''}
      ${warn.length ? `<div class="alert-row"><span class="alert-tag warn">Atenção</span>${warn.map(link).join('')}</div>` : ''}</div>`;
    box.hidden = false;
  }

  /* Agenda: o último ensaio realizado e o próximo são decididos pelo relógio de quem abre a página. */
  const WEEKDAY = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const MONTH = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const startsAt = e => new Date(`${e.date}T${e.time || '00:00'}:00`);
  let agenda = [];
  let agendaTimer = null;
  let nextKey = null;
  function countdown(e, now) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const day = startsAt(e); day.setHours(0, 0, 0, 0);
    const days = Math.round((day - today) / 864e5);
    if (days > 1) return `Em ${days} dias`;
    if (days === 1) return 'Amanhã';
    const ms = startsAt(e) - now; const h = Math.floor(ms / 36e5); const m = Math.max(1, Math.ceil(ms % 36e5 / 6e4));
    return `Hoje · em ${h ? `${h}h ` : ''}${m}min`;
  }
  function paintAgenda() {
    const now = new Date();
    const past = agenda.filter(e => startsAt(e) <= now);
    const next = agenda.find(e => startsAt(e) > now);
    const last = past.at(-1);
    const key = next ? `${next.date} ${next.time}` : null;
    const changed = key !== nextKey; nextKey = key;
    set('statRehearsals', past.length);
    if (changed && members.length) renderGrid();
    if (last) { const [y, mo, d] = last.date.split('-'); set('lastDate', `${d}/${mo}/${y}${last.time ? ` · ${last.time}` : ''}`); set('lastPlace', last.location || '—'); }
    set('statRehearsalsDetail', agenda.length - past.length ? `Realizados · ${plural(agenda.length - past.length, 'agendado', 'agendados')}` : 'Realizados · nenhum agendado');
    el('nextCard').classList.toggle('is-empty', !next);
    el('nextInfo').hidden = !next; el('nextCount').hidden = !next;
    if (!next) { set('nextDay', '—'); set('nextMonth', ''); set('nextWeekday', 'Nenhum ensaio agendado'); el('nextCard').setAttribute('aria-label', 'Próximo ensaio: nenhum agendado'); return; }
    const [, mo, d] = next.date.split('-');
    const weekday = WEEKDAY[startsAt(next).getDay()];
    set('nextDay', d); set('nextMonth', MONTH[Number(mo) - 1]); set('nextWeekday', weekday);
    set('nextTime', next.time || '—'); set('nextPlace', next.location || '—'); set('nextCount', countdown(next, now));
    el('nextCard').setAttribute('aria-label', `Próximo ensaio: ${weekday}, ${d}/${mo} às ${next.time}, ${next.location || ''}`);
  }
  function renderAgenda(list) {
    agenda = list.filter(e => e?.date).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    paintAgenda();
    clearInterval(agendaTimer); agendaTimer = setInterval(paintAgenda, 60000);
  }

  let members = [];
  let sortMode = 'name';
  function renderGrid() {
    const grid = el('musicianGrid');
    if (!members.length) { grid.innerHTML = '<p class="empty-message">Nenhum integrante publicado ainda.</p>'; return; }
    const rank = {over: 0, warn: 1, ok: 2, none: 3};
    const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
    const sorted = [...members].sort((a, b) =>
      sortMode === 'freq' ? (Number(b.frequency ?? -1) - Number(a.frequency ?? -1)) || byName(a, b)
      : sortMode === 'miss' ? (Number(absenceOf(b) ?? -1) - Number(absenceOf(a) ?? -1)) || byName(a, b)
      : sortMode === 'alert' ? (rank[levelOf(a)] - rank[levelOf(b)]) || (Number(absenceOf(b) ?? -1) - Number(absenceOf(a) ?? -1)) || byName(a, b)
      : byName(a, b));
    const list = sortMode === 'alert' ? sorted.filter(m => ['over', 'warn'].includes(levelOf(m))) : sorted;
    grid.innerHTML = list.length ? list.map(card).join('') : '<p class="empty-message"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Nenhum músico em alerta no momento.</p>';
    /* Com muitos ensaios a linha do tempo rola: começa mostrando os mais recentes. */
    fitTimelines();
    applySearch();
  }
  function fitTimelines() {
    el('musicianGrid').querySelectorAll('.tl-row').forEach(row => {
      const scrolls = row.scrollWidth > row.clientWidth + 1;
      row.classList.toggle('is-scroll', scrolls);
      if (scrolls) row.scrollLeft = row.scrollWidth;
    });
  }
  function applySearch() {
    const q = fold(el('memberSearch').value.trim());
    el('musicianGrid').querySelectorAll('.musician-card').forEach(c => { c.hidden = Boolean(q) && !c.dataset.name.includes(q); });
  }

  function view(data) {
    const {rehearsalCount = 0, lastRehearsal, schedule, totals = {}} = data;
    members = data.members || [];
    const absence = totals.recorded ? Math.round((100 - Number(totals.frequency ?? 0)) * 10) / 10 : null;
    const active = members.filter(m => m.active);
    const overCount = active.filter(m => levelOf(m) === 'over').length;
    set('statFrequency', format(totals.frequency));
    set('statFrequencyDetail', `${totals.recorded || 0} chamadas concluídas`);
    el('statFrequencyBar').style.width = `${Math.max(0, Math.min(100, Number(totals.frequency ?? 0)))}%`;
    set('statAbsence', format(absence));
    set('statAbsenceDetail', `${plural((totals.justified || 0) + (totals.absent || 0), 'falta', 'faltas')} · ${plural(totals.partial || 0, 'parcial', 'parciais')}`);
    set('statMembers', active.length);
    set('statMembersDetail', overCount ? `${overCount} acima do limite de ${ABSENCE_LIMIT}%` : 'Todos dentro do limite');
    el('statMembersDetail').classList.toggle('is-over', overCount > 0);
    set('memberCounter', plural(members.length, 'músico', 'músicos'));
    set('donutRate', format(totals.frequency));
    for (const [id, key] of [['countPresent', 'present'], ['countPartial', 'partial'], ['countJustified', 'justified'], ['countAbsent', 'absent'], ['countRecorded', 'recorded']]) set(id, totals[key] ?? 0);
    renderAgenda(Array.isArray(schedule) ? schedule : (lastRehearsal?.date ? [lastRehearsal] : []));
    limitAlert(members);
    renderGrid();
    chart(totals); window.addEventListener('resize', () => { chart(totals); fitTimelines(); }, {passive: true});
  }

  function bindControls() {
    el('memberSearch').addEventListener('input', applySearch);
    document.querySelector('.seg').addEventListener('click', e => {
      const btn = e.target.closest('button[data-sort]'); if (!btn) return;
      sortMode = btn.dataset.sort;
      document.querySelectorAll('.seg button').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      renderGrid();
    });
    /* Destaca no menu a seção visível. */
    const links = [...document.querySelectorAll('.top-links a')];
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
    }), {rootMargin: '-40% 0px -55% 0px'});
    links.forEach(a => { const t = document.querySelector(a.getAttribute('href')); if (t) io.observe(t); });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindControls();
    const alert = el('appAlert'); const pill = el('syncPill'); const db = window.OrchestraDB;
    const fail = msg => { alert.hidden = false; alert.classList.add('is-error'); alert.textContent = msg; pill.className = 'sync-pill is-error'; pill.innerHTML = '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Sem conexão'; };
    if (!db?.ready) { fail(db?.error || 'Configure o Supabase antes de publicar o painel.'); return; }
    try {
      const {data, error} = await db.client.from('public_snapshot').select('payload').eq('id', 1).single();
      if (error) throw error;
      view(data.payload);
      pill.innerHTML = '<span class="live-dot" aria-hidden="true"></span> Sincronizado';
    } catch (err) { fail(`Não foi possível consultar os indicadores: ${err.message}`); }
  });
})();
