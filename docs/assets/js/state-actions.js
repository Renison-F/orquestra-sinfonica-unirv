/* Regras de alteração preservadas na versão estática. O PostgreSQL é a fonte da verdade. */
(() => {
  'use strict';
  const valid = new Set(['presente', 'parcial', 'justificada', 'falta', 'pendente']);
  const clone = value => JSON.parse(JSON.stringify(value));
  const must = (value, label, max = 160) => {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) throw Error(`${label}: informe um texto de até ${max} caracteres.`);
    return value.trim().replace(/\s+/g, ' ');
  };
  const optional = (value, label, max) => {
    if (typeof value !== 'string' || [...value.trim()].length > max) throw Error(`${label}: máximo de ${max} caracteres.`);
    return value.trim();
  };
  function apply(current, action, payload) {
    const state = clone(current);
    const members = state.members;
    const rehearsals = state.rehearsals;
    let event = '';
    if (action === 'rehearsal.save') {
      const date = must(payload.date, 'Data', 10);
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw Error('Data de ensaio inválida.');
      const time = must(payload.time, 'Horário', 5);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Horário inválido.');
      const location = must(payload.location, 'Local', 160);
      const notes = optional(payload.notes ?? '', 'Observações', 1200);
      const old = payload.id ? rehearsals.find(r => r.id === payload.id) : null;
      if (payload.id && !old) throw Error('Ensaio não encontrado. Atualize o painel.');
      const expected = (old ? Object.keys(old.attendance) : members.filter(m => m.active).map(m => m.id)).sort();
      if (!expected.length) throw Error('Não existem integrantes disponíveis para o ensaio.');
      const provided = Object.keys(payload.attendance || {}).sort();
      if (JSON.stringify(expected) !== JSON.stringify(provided)) throw Error('A chamada não corresponde à lista de integrantes.');
      const attendance = {};
      for (const id of expected) {
        const a = payload.attendance[id];
        if (!a || !valid.has(a.status)) throw Error('Situação de frequência inválida.');
        attendance[id] = {status:a.status, reason:['falta','justificada','parcial'].includes(a.status) ? optional(a.reason ?? '', 'Justificativa', 220) : ''};
      }
      const record = {id: old?.id || `ensaio-${crypto.randomUUID()}`, date, time, location, notes, attendance};
      if (old) Object.assign(old, record); else rehearsals.push(record);
      event = `${old ? 'Ensaio atualizado' : 'Ensaio criado'}: ${date} às ${time}`;
    } else if (action === 'rehearsal.delete') {
      const index = rehearsals.findIndex(r => r.id === payload.id);
      if (index < 0) throw Error('Ensaio não encontrado.');
      const r = rehearsals.splice(index, 1)[0];
      event = `Ensaio excluído: ${r.date} às ${r.time}`;
    } else if (action === 'member.add') {
      const name = must(payload.name, 'Nome', 80);
      if (members.some(m => m.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) throw Error('Este integrante já está cadastrado.');
      members.push({id: `musico-${crypto.randomUUID().slice(0,18)}`, name, active:true});
      event = `Integrante adicionado: ${name}`;
    } else if (action === 'member.update') {
      const member = members.find(m => m.id === payload.id);
      if (!member) throw Error('Integrante não encontrado.');
      const name = must(payload.name, 'Nome', 80);
      if (members.some(m => m.id !== member.id && m.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) throw Error('Já existe um integrante com este nome.');
      if (typeof payload.active !== 'boolean') throw Error('Situação do integrante inválida.');
      member.name = name; member.active = payload.active;
      event = `Integrante atualizado: ${name}`;
    } else throw Error('Operação desconhecida.');
    state.audit = Array.isArray(state.audit) ? state.audit : [];
    state.audit.push({at: new Date().toISOString(), event});
    state.audit = state.audit.slice(-500);
    return state;
  }
  function markdown(state) {
    const names = Object.fromEntries(state.members.map(m => [m.id,m.name]));
    const lines = ['# Frequência — Orquestra Sinfônica da Universidade de Rio Verde (UniRV)', '', `**Revisão:** ${state.revision}`, `**Atualizado em:** ${state.updatedAt || '—'}`, '', '## Histórico de ensaios', ''];
    [...state.rehearsals].sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time)).forEach(r => {
      lines.push(`### ${r.date} às ${r.time}`, `**Local:** ${r.location.replace(/[\r\n]/g,' ')}`, r.notes ? `**Observações:** ${r.notes.replace(/[\r\n]/g,' ')}` : '', '', '| Integrante | Situação | Justificativa |', '|---|---|---|');
      Object.entries(r.attendance).forEach(([id,a]) => lines.push(`| ${(names[id]||id).replace(/\|/g,'\\|')} | ${a.status} | ${(a.reason||'').replace(/[\r\n]/g,' ').replace(/\|/g,'\\|')} |`));
      lines.push('');
    });
    return lines.join('\n');
  }
  window.OrchestraActions = Object.freeze({apply, markdown});
})();
