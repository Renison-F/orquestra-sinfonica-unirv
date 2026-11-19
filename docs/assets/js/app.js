/* Orquestra Sinfônica UniRV — painel administrativo protegido pelo Supabase. */
(() => {
  'use strict';
  const db = () => window.OrchestraDB?.client;
  const $id = (id) => document.getElementById(id);
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const colorToken = (key) => getComputedStyle(document.documentElement).getPropertyValue(`--ocg-${key}`).trim();
  const one = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;
  const pct = (numerator, denominator) => denominator ? Math.round(numerator * 100 / denominator) : 0;
  const statuses = {
    presente: {label: 'Presente', className: 'is-present', icon: 'fa-circle-check'},
    parcial: {label: 'Presença parcial (50%)', className: 'is-partial', icon: 'fa-circle-half-stroke'},
    justificada: {label: 'Justificada', className: 'is-justified', icon: 'fa-notes-medical'},
    abonada: {label: 'Falta abonada', className: 'is-excused', icon: 'fa-file-circle-check'},
    falta: {label: 'Falta', className: 'is-absent', icon: 'fa-circle-xmark'},
    pendente: {label: 'Pendente', className: 'is-pending', icon: 'fa-clock'}
  };
  /* Falta abonada conta como presença integral; parcial vale meia presença. */
  const credit = (c) => c.presente + c.abonada + c.parcial * 0.5;
  /* Atestados: bucket privado do Supabase Storage, acessível só a administradores. */
  const ATTACHMENT_BUCKET = 'atestados';
  const ATTACHMENT_MAX = 5 * 1024 * 1024;
  const ATTACHMENT_EXT = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};
  const attachmentDrafts = new Map(); // memberId -> {current, file, remove}
  let database = null;
  let dataTable = null;
  let editingRehearsal = null;
  let editingMember = null;
  let pendingDelete = null;
  let isBusy = false;

  function toast(message, error = false) {
    $id('toastMessage').textContent = message;
    $id('feedbackToast').classList.toggle('is-error', error);
    $id('toastIcon').className = error ? 'fa-solid fa-circle-exclamation me-2' : 'fa-solid fa-circle-info me-2';
    bootstrap.Toast.getOrCreateInstance($id('feedbackToast'), {delay: 3800}).show();
  }
  function saving(label, kind = '') {
    $id('saveIndicator').classList.toggle('is-saving', kind === 'saving');
    $id('saveIndicator').classList.toggle('is-error', kind === 'error');
    $id('saveIndicator').lastChild.textContent = ` ${label}`;
  }
  function modal(name) { return bootstrap.Modal.getOrCreateInstance($id(name)); }
  async function load() {
    saving('Carregando dados...', 'saving');
    try {
      const {data, error} = await db().from('app_state').select('state,revision,updated_at').eq('id',1).single();
      if (error) throw error;
      database = {...data.state, revision: data.revision, updatedAt: data.updated_at};
      render();
      saving('Dados protegidos no Supabase');
    } catch (err) {
      saving('Falha ao consultar o Supabase', 'error');
      toast(err.message || 'Não foi possível buscar os dados.', true);
    }
  }
  async function persistState(next) {
    if (!database) throw Error('Dados não carregados.');
    // Controle otimista de concorrência: impedir gravação sobre revisão mais recente.
    const {data,error} = await db().from('app_state')
      .update({state: next, revision: database.revision + 1})
      .eq('id',1).eq('revision',database.revision)
      .select('state,revision,updated_at').maybeSingle();
    if (error) throw error;
    if (!data) throw Error('Outro administrador alterou os registros. Atualize o painel antes de salvar.');
    database = {...data.state, revision: data.revision, updatedAt:data.updated_at};
    render();
  }
  async function save(action, payload) {
    if (isBusy) return false;
    isBusy = true;
    saving('Salvando alterações...', 'saving');
    try {
      const next = window.OrchestraActions.apply(database, action, payload);
      await persistState(next);
      saving('Dados gravados no Supabase');
      toast('Alteração salva com sucesso no Supabase.');
      return true;
    } catch (err) {
      saving('Não foi possível salvar', 'error');
      toast(err.message || 'Não foi possível gravar os dados.', true);
      return false;
    } finally { isBusy = false; }
  }
  function sortedRehearsals() {
    return [...database.rehearsals].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }
  function dateText(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '—';
    const [year, month, day] = date.split('-');
    return `${day}/${month}/${year}`;
  }
  function dateShort(date) {
    if (!date || date.length < 10) return '—';
    return date.slice(8,10) + '/' + date.slice(5,7);
  }
  function counts(attendance) {
    const result = {presente: 0, parcial: 0, justificada: 0, abonada: 0, falta: 0, pendente: 0};
    Object.values(attendance || {}).forEach((item) => { if (item.status in result) result[item.status]++; });
    result.ausencias = result.justificada + result.falta + result.parcial * 0.5;
    result.registradas = result.presente + result.parcial + result.justificada + result.abonada + result.falta;
    result.total = result.registradas + result.pendente;
    return result;
  }
  function totals() {
    const total = {presente: 0, parcial: 0, justificada: 0, abonada: 0, falta: 0, pendente: 0};
    database.rehearsals.forEach((r) => {
      const c = counts(r.attendance);
      Object.keys(total).forEach((key) => { total[key] += c[key]; });
    });
    total.ausencias = total.justificada + total.falta + total.parcial * 0.5;
    total.registradas = total.presente + total.parcial + total.justificada + total.abonada + total.falta;
    return total;
  }
  function memberStats(id) {
    const memberAttendance = sortedRehearsals().filter((r) => r.attendance[id]).map((r) => r.attendance[id]);
    const c = counts(Object.fromEntries(memberAttendance.map((a, i) => [i, a])));
    const latest = memberAttendance[0] || null;
    return {...c, latest};
  }
  function badge(status) {
    const item = statuses[status] || statuses.pendente;
    return `<span class="status-badge ${item.className}"><i class="fa-solid ${item.icon}" aria-hidden="true"></i>${item.label}</span>`;
  }
  function initials(name) {
    return name.trim().split(/\s+/u).slice(0, 2).map((w) => w.slice(0, 1).toUpperCase()).join('');
  }
  function person(member, caption = '') {
    return `<div class="person-cell"><span class="avatar ${member.active ? '' : 'is-inactive'}">${html(initials(member.name))}</span><span><span class="person-name">${html(member.name)}</span><span class="person-caption">${html(caption || (member.active ? 'Integrante do naipe' : 'Inativo'))}</span></span></div>`;
  }
  function renderOverview() {
    const t = totals();
    const latest = sortedRehearsals()[0] || null;
    const active = database.members.filter((member) => member.active).length;
    $id('kpiMembers').textContent = active;
    $id('kpiRehearsals').textContent = database.rehearsals.length;
    $id('kpiPresence').textContent = `${pct(credit(t), t.registradas)}%`;
    $id('kpiAbsence').textContent = `${pct(t.ausencias, t.registradas)}%`;
    $id('kpiPresenceDetail').textContent = `${t.presente} presenças integrais + ${t.parcial} parciais (50%)${t.abonada ? ` + ${one(t.abonada, 'abonada', 'abonadas')}` : ''}`;
    $id('kpiAbsenceDetail').textContent = `${t.falta + t.justificada} faltas integrais e ${t.parcial} parciais`;
    $id('heroLastDate').textContent = latest ? `${dateText(latest.date)} · ${latest.time}` : '—';
    $id('heroLastPlace').textContent = latest ? latest.location : 'Nenhum ensaio';
    $id('updatedAt').textContent = `Atualizado: ${database.updatedAt ? new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'}).format(new Date(database.updatedAt)) : '—'}`;
    $id('donutPercent').textContent = `${pct(credit(t), t.registradas)}%`;
    $id('legendPresent').textContent = t.presente;
    $id('legendPartial').textContent = t.parcial;
    $id('legendExcused').textContent = t.abonada;
    $id('legendJustified').textContent = t.justificada;
    $id('legendAbsent').textContent = t.falta;
    $id('legendTotal').textContent = t.registradas;
    $id('distributionCanvas').setAttribute('aria-label', `${t.presente} presenças integrais, ${t.parcial} parciais, ${t.abonada} faltas abonadas, ${t.justificada} faltas justificadas e ${t.falta} faltas não justificadas.`);
    drawCharts();
  }
  function renderMembers() {
    $id('membersTbody').innerHTML = database.members.map((m) => {
      const c = memberStats(m.id);
      const p = pct(c.ausencias, c.registradas);
      return `<tr><td>${person(m)}</td><td><span class="table-number text-present">${c.presente}</span></td><td><span class="table-number text-partial">${c.parcial}</span></td><td><span class="table-number text-excused">${c.abonada}</span></td><td><span class="table-number text-justified">${c.justificada}</span></td><td><span class="table-number text-absent">${c.falta}</span></td><td><span class="rate-track"><meter min="0" max="100" low="0" high="100" optimum="0" value="${p}" title="${p}% de faltas"></meter></span><span class="rate-text">${c.registradas ? `${p}%` : '—'}</span></td><td>${badge(c.latest?.status || 'pendente')}${c.latest?.reason ? `<small class="reason-small">${html(c.latest.reason)}</small>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="text-center">Nenhum integrante cadastrado.</td></tr>';
  }
  function renderRehearsals() {
    const search = $id('rehearsalSearch').value;
    const filter = $id('rehearsalFilter').value;
    if (dataTable) { dataTable.destroy(); dataTable = null; }
    const body = document.querySelector('#rehearsalsTable tbody');
    body.innerHTML = sortedRehearsals().map((r) => {
      const c = counts(r.attendance);
      const rate = pct(credit(c), c.registradas);
      const flags = ['todos', c.ausencias > 0 ? 'com-faltas' : 'sem-faltas', c.pendente > 0 ? 'pendentes' : 'sem-pendentes'].join(' ');
      return `<tr><td data-order="${html(r.date + r.time)}"><span class="date-strong">${html(dateText(r.date))}</span><span class="date-sub"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${html(r.time)}</span></td><td><span class="location-text"><i class="fa-solid fa-location-dot" aria-hidden="true"></i>${html(r.location)}</span></td><td><span class="table-number text-present">${c.presente}</span> <span class="text-secondary">+ ${c.parcial} parcial${c.abonada ? ` + ${c.abonada} abonada` : ''} / ${c.total}</span></td><td><span class="table-number text-absent">${c.ausencias}</span><span class="date-sub">${one(c.justificada, 'justificada', 'justificadas')}</span></td><td><span class="frequency-badge">${rate}%</span></td><td><span class="row-actions"><button type="button" class="action-icon" data-action="edit-rehearsal" data-id="${html(r.id)}" title="Editar chamada de ${html(dateText(r.date))}" aria-label="Editar ensaio de ${html(dateText(r.date))}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button type="button" class="action-icon is-danger" data-action="delete-rehearsal" data-id="${html(r.id)}" title="Excluir ensaio" aria-label="Excluir ensaio de ${html(dateText(r.date))}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></span></td><td class="filter-only">${flags}</td></tr>`;
    }).join('');
    if (typeof DataTable !== 'undefined') {
      dataTable = new DataTable('#rehearsalsTable', {
        pageLength: 5,
        lengthChange: false,
        ordering: true,
        searching: true,
        autoWidth: false,
        order: [[0, 'desc']],
        pagingType: 'simple_numbers',
        columnDefs: [{targets: 5, orderable: false, searchable: false}, {targets: 6, visible: false, searchable: true, orderable: false}],
        layout: {topStart: null, topEnd: null, bottomStart: 'info', bottomEnd: 'paging'},
        language: {
          emptyTable: 'Ainda não existem ensaios cadastrados.',
          zeroRecords: 'Nenhum ensaio corresponde aos filtros.',
          info: 'Exibindo _START_ a _END_ de _TOTAL_ ensaios',
          infoEmpty: 'Nenhum ensaio cadastrado',
          infoFiltered: '(filtrados de _MAX_ registros)',
          paginate: {previous: '<', next: '>'}
        }
      });
      if (search) dataTable.search(search);
      if (filter !== 'todos') dataTable.column(6).search(filter);
      dataTable.draw();
    } else if (!document.documentElement.dataset.dataTableWarned) {
      document.documentElement.dataset.dataTableWarned = 'true';
      toast('DataTables não foi carregado. Confira sua conexão com a internet; a tabela básica continua disponível.', true);
    }
  }
  function renderManagedMembers() {
    $id('memberManageList').innerHTML = database.members.map((m) => `<li class="${m.active ? '' : 'is-inactive'}">${person(m)}<button type="button" class="action-icon" data-action="edit-member" data-id="${html(m.id)}" aria-label="Editar ${html(m.name)}"><i class="fa-solid fa-pen" aria-hidden="true"></i></button></li>`).join('');
  }
  function render() {
    if (!database) return;
    renderOverview();
    renderMembers();
    renderRehearsals();
    renderManagedMembers();
  }

  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.round(rect.width || Number(canvas.getAttribute('width')));
    const height = Math.round(rect.height || Number(canvas.getAttribute('height')));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {ctx, width, height};
  }
  function drawDistribution() {
    const {ctx, width, height} = setupCanvas($id('distributionCanvas'));
    const t = totals();
    const centerX = width / 2, centerY = height / 2;
    const radius = Math.min(width, height) * .385;
    const thickness = Math.max(15, Math.min(width, height) * .11);
    const values = [t.presente, t.parcial, t.abonada, t.justificada, t.falta];
    const colors = [colorToken('success'), '#4888bd', '#7b5ea7', colorToken('gold-600'), colorToken('danger')];
    let angle = -Math.PI / 2;
    const length = Math.PI * 2;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = colorToken('chart-grid');
    ctx.lineWidth = thickness;
    ctx.beginPath(); ctx.arc(centerX, centerY, radius, 0, length); ctx.stroke();
    if (!t.registradas) return;
    values.forEach((v, i) => {
      if (!v) return;
      const sweep = v / t.registradas * length;
      ctx.strokeStyle = colors[i];
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(centerX, centerY, radius, angle + .018, angle + sweep - .018); ctx.stroke();
      angle += sweep;
    });
  }
  function drawTrend() {
    const canvas = $id('trendCanvas');
    const {ctx, width, height} = setupCanvas(canvas);
    const list = sortedRehearsals().slice(0, 8).reverse();
    ctx.clearRect(0, 0, width, height);
    if (!list.length) { ctx.fillStyle = colorToken('chart-empty'); ctx.font = '12px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Registre um ensaio para visualizar o gráfico.', width / 2, height / 2); return; }
    const left = 38, right = 13, top = 17, bottom = 36;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const guide = [0, 25, 50, 75, 100];
    ctx.font = '10px Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    guide.forEach((v) => {
      const y = top + plotH * (1 - v / 100);
      ctx.beginPath(); ctx.strokeStyle = colorToken('chart-grid'); ctx.lineWidth = 1; ctx.moveTo(left, y); ctx.lineTo(left + plotW, y); ctx.stroke();
      ctx.fillStyle = colorToken('chart-tick'); ctx.fillText(v + '%', left - 8, y + 4);
    });
    const slot = plotW / list.length;
    const barW = Math.max(20, Math.min(41, slot * .45));
    list.forEach((r, index) => {
      const c = counts(r.attendance);
      const p = pct(credit(c), c.registradas);
      const x = left + slot * index + slot / 2;
      const barH = plotH * p / 100;
      const y = top + plotH - barH;
      ctx.fillStyle = colorToken('chart-track');
      ctx.fillRect(x - barW / 2, top, barW, plotH);
      if (p) {
        ctx.fillStyle = colorToken('success');
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x - barW / 2, y, barW, barH, [5, 5, 0, 0]);
        else ctx.rect(x - barW / 2, y, barW, barH);
        ctx.fill();
      }
      ctx.fillStyle = colorToken('chart-ink');
      ctx.textAlign = 'center';
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      ctx.fillText(`${p}%`, x, Math.max(top + 10, y - 8));
      ctx.fillStyle = colorToken('chart-date');
      ctx.font = '10px Segoe UI, sans-serif';
      ctx.fillText(dateShort(r.date), x, height - 12);
    });
  }
  function drawCharts() { drawDistribution(); drawTrend(); }
  function openRehearsal(id = null) {
    editingRehearsal = id;
    const record = id ? database.rehearsals.find((r) => r.id === id) : null;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    $id('rehearsalModalTitle').textContent = record ? 'Editar ensaio' : 'Novo ensaio';
    $id('rehearsalDate').value = record?.date || today;
    $id('rehearsalTime').value = record?.time || '19:30';
    $id('rehearsalLocation').value = record?.location || 'Centro Universitário de Convenções';
    $id('rehearsalNotes').value = record?.notes || '';
    $id('deleteRehearsalButton').classList.toggle('d-none', !record);
    const members = record
      ? Object.keys(record.attendance).map((mid) => database.members.find((m) => m.id === mid) || {id: mid, name: 'Integrante anterior', active: false})
      : database.members.filter((m) => m.active);
    $id('attendanceCount').textContent = one(members.length, 'integrante', 'integrantes');
    attachmentDrafts.clear();
    $id('attendanceFields').innerHTML = members.map((m) => {
      const a = record?.attendance[m.id] || {status: 'pendente', reason: ''};
      attachmentDrafts.set(m.id, {current: a.attachment || null, file: null, remove: false});
      const options = Object.entries(statuses).map(([key, item]) => `<option value="${key}" ${a.status === key ? 'selected' : ''}>${item.label === 'Justificada' ? 'Falta justificada' : item.label === 'Falta' ? 'Falta não justificada' : item.label}</option>`).join('');
      const idSafe = html(m.id);
      return `<div class="attendance-row" data-member-id="${idSafe}">${person(m)}<div><label class="visually-hidden" for="s-${idSafe}">Situação de ${html(m.name)}</label><select id="s-${idSafe}" class="form-select attendance-status">${options}</select></div><div class="attendance-reason"><label class="visually-hidden" for="m-${idSafe}">Motivo ou justificativa de ${html(m.name)}</label><input id="m-${idSafe}" type="text" class="form-control attendance-reason-input" maxlength="220" placeholder="Motivo ou justificativa (opcional)" value="${html(a.reason)}" ${a.status === 'presente' || a.status === 'pendente' ? 'disabled' : ''}></div><div class="attendance-attachment" ${a.status === 'abonada' ? '' : 'hidden'}>${attachmentBox(m)}</div></div>`;
    }).join('') || '<p class="muted-text">Nenhum integrante ativo. Cadastre um integrante antes de lançar ensaios.</p>';
    modal('rehearsalModal').show();
  }
  /* ---------- Atestado médico da falta abonada ---------- */
  function fileSize(bytes) {
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  function attachmentBox(member) {
    const draft = attachmentDrafts.get(member.id);
    const idSafe = html(member.id);
    const input = `<input id="f-${idSafe}" type="file" class="visually-hidden attendance-file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Anexar atestado médico de ${html(member.name)}"><label class="btn btn-ui btn-outline-ui attachment-pick" for="f-${idSafe}"><i class="fa-solid fa-paperclip" aria-hidden="true"></i> ${draft.file || (draft.current && !draft.remove) ? 'Trocar atestado' : 'Anexar atestado'}</label>`;
    let info = '<span class="attachment-empty">Nenhum atestado anexado · JPG, PNG, WEBP ou PDF até 5 MB</span>';
    if (draft.file) {
      info = `<span class="attachment-file is-new"><i class="fa-solid ${draft.file.type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-image'}" aria-hidden="true"></i><span class="attachment-name">${html(draft.file.name)}</span><small>${fileSize(draft.file.size)} · será enviado ao salvar</small></span><button type="button" class="action-icon is-danger" data-action="discard-attachment" aria-label="Descartar arquivo selecionado"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
    } else if (draft.current && !draft.remove) {
      info = `<span class="attachment-file"><i class="fa-solid ${draft.current.type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-image'}" aria-hidden="true"></i><span class="attachment-name">${html(draft.current.name)}</span>${draft.current.size ? `<small>${fileSize(draft.current.size)}</small>` : ''}</span><button type="button" class="action-icon" data-action="view-attachment" aria-label="Abrir atestado de ${html(member.name)}" title="Abrir atestado"><i class="fa-solid fa-eye" aria-hidden="true"></i></button><button type="button" class="action-icon is-danger" data-action="remove-attachment" aria-label="Remover atestado de ${html(member.name)}" title="Remover atestado"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>`;
    } else if (draft.current && draft.remove) {
      info = `<span class="attachment-empty">Atestado será removido ao salvar.</span><button type="button" class="btn btn-link btn-sm p-0" data-action="undo-remove-attachment">Desfazer</button>`;
    }
    return `<span class="attachment-title"><i class="fa-solid fa-file-medical" aria-hidden="true"></i> Atestado médico</span><div class="attachment-body">${info}</div>${input}`;
  }
  function refreshAttachment(row) {
    const member = database.members.find((m) => m.id === row.dataset.memberId) || {id: row.dataset.memberId, name: 'integrante'};
    row.querySelector('.attendance-attachment').innerHTML = attachmentBox(member);
  }
  function storagePath(memberId, type) {
    return `${memberId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'integrante'}/${crypto.randomUUID()}.${ATTACHMENT_EXT[type]}`;
  }
  async function uploadAttachment(memberId, file) {
    const path = storagePath(memberId, file.type);
    const {error} = await db().storage.from(ATTACHMENT_BUCKET).upload(path, file, {contentType: file.type, upsert: false, cacheControl: '0'});
    if (error) throw Error(`Não foi possível enviar o atestado "${file.name}": ${error.message}`);
    return {path, type: file.type, name: file.name.slice(0, 200), size: file.size, uploadedAt: new Date().toISOString()};
  }
  async function removeFiles(paths) {
    const list = [...new Set(paths.filter(Boolean))];
    if (!list.length) return;
    const {error} = await db().storage.from(ATTACHMENT_BUCKET).remove(list);
    if (error) console.warn('Atestados não removidos do Storage:', list, error.message);
  }
  async function viewAttachment(attachment) {
    // Abre a aba antes da chamada assíncrona para não ser bloqueada como pop-up.
    const tab = window.open('', '_blank');
    try {
      const {data, error} = await db().storage.from(ATTACHMENT_BUCKET).createSignedUrl(attachment.path, 60);
      if (error) throw error;
      if (tab) { tab.opener = null; tab.location.href = data.signedUrl; } else window.location.assign(data.signedUrl);
    } catch (err) {
      tab?.close();
      toast(`Não foi possível abrir o atestado: ${err.message || 'erro desconhecido'}`, true);
    }
  }
  function askDelete(id) {
    const record = database.rehearsals.find((r) => r.id === id);
    if (!record) return;
    pendingDelete = id;
    $id('confirmModalText').textContent = `Confirma a exclusão do ensaio de ${dateText(record.date)} às ${record.time}? As chamadas relacionadas também serão removidas. Esta ação não poderá ser desfeita.`;
    modal('rehearsalModal').hide();
    modal('confirmModal').show();
  }
  function openMemberEditor(id) {
    const member = database.members.find((m) => m.id === id);
    if (!member) return;
    editingMember = id;
    $id('editMemberName').value = member.name;
    $id('editMemberActive').checked = member.active;
    modal('membersModal').hide();
    $id('membersModal').addEventListener('hidden.bs.modal', () => modal('editMemberModal').show(), {once: true});
  }
  function download(url) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  function downloadText(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], {type:`${type};charset=utf-8`}));
    const link = document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function csvSafe(text) {
    const v = String(text ?? '');
    // Protege o Excel contra interpretação de fórmulas em conteúdo fornecido por usuários.
    const escaped = /^[\s]*[=+@\-\t\r]/.test(v) ? `'${v}` : v;
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  function exportCsv() {
    if (!database) return;
    const headers = ['Data', 'Horário', 'Local', 'Integrante', 'Situação', 'Motivo', 'Atestado', 'Observações'];
    const names = Object.fromEntries(database.members.map((m) => [m.id, m.name]));
    const rows = [headers];
    sortedRehearsals().forEach((r) => Object.entries(r.attendance).forEach(([id, a]) => rows.push([dateText(r.date), r.time, r.location, names[id] || 'Integrante anterior', statuses[a.status]?.label || 'Pendente', a.reason, a.attachment ? `Sim (${a.attachment.name})` : '', r.notes])));
    const text = '\ufeff' + rows.map((row) => row.map(csvSafe).join(';')).join('\r\n');
    downloadText(text, 'frequencia-ensaios.csv', 'text/csv');
    toast('Relatório CSV exportado.');
  }
  function registerListeners() {
    $id('refreshButton').addEventListener('click', load);
    $id('newRehearsalButton').addEventListener('click', () => { if (database) openRehearsal(); });
    $id('manageMembersButton').addEventListener('click', () => { if (database) modal('membersModal').show(); });
    $id('exportCsvButton').addEventListener('click', exportCsv);
    $id('downloadJsonButton').addEventListener('click', () => downloadText(JSON.stringify(database,null,2), 'frequencia-backup.json', 'application/json'));
    $id('downloadMdButton').addEventListener('click', () => downloadText(window.OrchestraActions.markdown(database), 'relatorio_frequencia.md', 'text/markdown'));
    $id('importJsonInput').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (!window.confirm('Importar um JSON SUBSTITUIRÁ todos os registros atuais. Confirma?')) {event.target.value=''; return;}
      if (isBusy) return;
      isBusy = true;
      try {
        if (file.size > 2_000_000) throw Error('O arquivo não pode exceder 2 MB.');
        const next = JSON.parse(await file.text());
        if (!Array.isArray(next.members) || !Array.isArray(next.rehearsals) || !next.members.every(m => typeof m.id === 'string' && typeof m.name === 'string') || !next.rehearsals.every(r => r.attendance && typeof r.date === 'string' && typeof r.time === 'string' && typeof r.location === 'string')) throw Error('Formato de backup incompatível.');
        const allowed = new Set(['presente','parcial','justificada','abonada','falta','pendente']);
        if (!next.rehearsals.every(r => Object.values(r.attendance).every(a => a && allowed.has(a.status)))) throw Error('O backup contém situações inválidas.');
        next.audit = Array.isArray(next.audit) ? next.audit : [];
        next.audit.push({at:new Date().toISOString(),event:'Importação manual de backup JSON'});
        await persistState(next);
        toast('Backup importado e publicado com sucesso.');
      } catch(err) { toast(err.message || 'Não foi possível importar o JSON.',true); }
      finally {isBusy = false;event.target.value='';}
    });
    $id('rehearsalSearch').addEventListener('input', (e) => dataTable?.search(e.target.value).draw());
    $id('rehearsalFilter').addEventListener('change', (e) => dataTable?.column(6).search(e.target.value === 'todos' ? '' : e.target.value).draw());
    $id('attendanceFields').addEventListener('change', (e) => {
      const row = e.target.closest('.attendance-row');
      if (!row) return;
      if (e.target.matches('.attendance-status')) {
        const reason = row.querySelector('.attendance-reason-input');
        reason.disabled = e.target.value === 'presente' || e.target.value === 'pendente';
        if (reason.disabled) reason.value = '';
        row.querySelector('.attendance-attachment').hidden = e.target.value !== 'abonada';
        return;
      }
      if (e.target.matches('.attendance-file')) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!ATTACHMENT_EXT[file.type]) { toast('Formato não aceito. Envie o atestado em JPG, PNG, WEBP ou PDF.', true); return; }
        if (file.size > ATTACHMENT_MAX) { toast(`O atestado tem ${fileSize(file.size)}; o máximo é 5 MB.`, true); return; }
        attachmentDrafts.get(row.dataset.memberId).file = file;
        refreshAttachment(row);
      }
    });
    $id('attendanceFields').addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      const row = e.target.closest('.attendance-row');
      if (!button || !row) return;
      const draft = attachmentDrafts.get(row.dataset.memberId);
      if (button.dataset.action === 'view-attachment' && draft.current) { viewAttachment(draft.current); return; }
      if (button.dataset.action === 'remove-attachment') draft.remove = true;
      if (button.dataset.action === 'undo-remove-attachment') draft.remove = false;
      if (button.dataset.action === 'discard-attachment') draft.file = null;
      refreshAttachment(row);
    });
    $id('rehearsalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!database || isBusy) return;
      const submit = $id('saveRehearsalButton');
      const rows = [...$id('attendanceFields').querySelectorAll('.attendance-row')];
      const attendance = {};
      const uploaded = [];   // enviados agora: apagados se a gravação falhar
      const obsolete = [];   // substituídos/removidos: apagados depois de gravar
      submit.disabled = true;
      try {
        for (const row of rows) {
          const memberId = row.dataset.memberId;
          const status = row.querySelector('.attendance-status').value;
          const draft = attachmentDrafts.get(memberId) || {current: null, file: null, remove: false};
          const entry = {status, reason: row.querySelector('.attendance-reason-input').value.trim()};
          let keep = draft.remove ? null : draft.current;
          if (status === 'abonada' && draft.file) {
            saving('Enviando atestado...', 'saving');
            const sent = await uploadAttachment(memberId, draft.file);
            uploaded.push(sent.path);
            keep = sent;
          }
          if (status !== 'abonada') keep = null;
          if (draft.current && draft.current.path !== keep?.path) obsolete.push(draft.current.path);
          if (keep) entry.attachment = keep;
          attendance[memberId] = entry;
        }
      } catch (err) {
        await removeFiles(uploaded);
        saving('Não foi possível salvar', 'error');
        toast(err.message || 'Falha ao enviar o atestado.', true);
        submit.disabled = false;
        return;
      }
      const success = await save('rehearsal.save', {
        id: editingRehearsal,
        date: $id('rehearsalDate').value,
        time: $id('rehearsalTime').value,
        location: $id('rehearsalLocation').value.trim(),
        notes: $id('rehearsalNotes').value.trim(),
        attendance
      });
      submit.disabled = false;
      if (success) { await removeFiles(obsolete); modal('rehearsalModal').hide(); }
      else await removeFiles(uploaded);
    });
    $id('rehearsalsTable').addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;
      if (button.dataset.action === 'edit-rehearsal') openRehearsal(button.dataset.id);
      if (button.dataset.action === 'delete-rehearsal') askDelete(button.dataset.id);
    });
    $id('deleteRehearsalButton').addEventListener('click', () => { if (editingRehearsal) askDelete(editingRehearsal); });
    $id('confirmDeleteButton').addEventListener('click', async () => {
      if (!pendingDelete) return;
      const files = Object.values(database.rehearsals.find((r) => r.id === pendingDelete)?.attendance || {}).map((a) => a.attachment?.path);
      if (await save('rehearsal.delete', {id: pendingDelete})) { pendingDelete = null; modal('confirmModal').hide(); await removeFiles(files); }
    });
    $id('addMemberForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $id('newMemberName').value.trim();
      if (await save('member.add', {name})) $id('newMemberName').value = '';
    });
    $id('memberManageList').addEventListener('click', (e) => {
      const button = e.target.closest('[data-action="edit-member"]');
      if (button) openMemberEditor(button.dataset.id);
    });
    $id('editMemberForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = await save('member.update', {id: editingMember, name: $id('editMemberName').value.trim(), active: $id('editMemberActive').checked});
      if (ok) modal('editMemberModal').hide();
    });
    // Controles exclusivos da apresentação Studio: não alteram registros nem persistência.
    const sidebarToggle = $id('toggleSidebarButton');
    sidebarToggle?.addEventListener('click', () => {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
      sidebarToggle.setAttribute('aria-label', collapsed ? 'Mostrar painel lateral' : 'Recolher painel lateral');
      sidebarToggle.title = collapsed ? 'Mostrar painel lateral' : 'Recolher painel lateral';
      window.dispatchEvent(new Event('resize'));
    });
    $id('sidebarNewRehearsal')?.addEventListener('click', () => { if (database) openRehearsal(); });
    $id('sidebarManageMembers')?.addEventListener('click', () => { if (database) modal('membersModal').show(); });
    document.querySelectorAll('[data-nav-target]').forEach((link) => {
      link.addEventListener('click', () => {
        const target = link.dataset.navTarget;
        document.querySelectorAll('[data-nav-target]').forEach((item) =>
          item.classList.toggle('is-current', item.dataset.navTarget === target));
      });
    });
    const debouncedResize = (() => {
      let job = null;
      return () => { window.clearTimeout(job); job = window.setTimeout(() => {if (database) drawCharts();}, 140); };
    })();
    window.addEventListener('resize', debouncedResize, {passive: true});
  }
  function initialize() {
    if (typeof bootstrap === 'undefined') {
      saving('Bibliotecas ausentes', 'error');
      // Alerta de falha na carga: a página pode precisar de internet para Bootstrap.
      window.alert('Bootstrap não carregou. Conecte-se à internet e atualize a página.');
      return;
    }
    registerListeners();
    load();
  }
  document.addEventListener('orchestra:authorized', initialize, {once:true});
})();
