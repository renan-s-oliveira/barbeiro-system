const main = $('#main'), modal = $('#modal'), mBody = $('#mBody');
const closeModal = () => modal.classList.remove('open');
$('#mClose').onclick = closeModal;
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');

const TABS = [
  ['dash', '📊 Dashboard'], ['appts', '📅 Agenda'], ['clients', '👥 Clientes'], ['subs', '💎 Assinaturas'], ['pays', '💳 Pagamentos'],
  ['services', '✂ Serviços'], ['barbers', '💈 Barbeiros'], ['plans', '🏷 Planos'], ['products', '🧴 Produtos'], ['orders', '🛍 Pedidos'],
  ['rewards', '🎁 Recompensas'], ['redemptions', '⭐ Resgates'], ['reviews', '💬 Avaliações'], ['amenities', '☕ Comodidades'], ['settings', '⚙ Configurações'],
];
$('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab" data-v="${k}">${l}</button>`).join('') + '<button class="tab" id="logout">🚪 Sair</button>';
$('#logout').onclick = async () => { await api('POST', '/api/auth/logout'); location.href = '/'; };
$('#tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-v]'); if (t) go(t.dataset.v); });

const table = (cols, rows, empty = 'Nada por aqui ainda.') => rows.length
  ? `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : `<div class="empty">${empty}</div>`;

// ---------- CRUD genérico ----------
const CRUD = {
  services: { title: 'Serviços', fields: [['name', 'Nome', 'text'], ['description', 'Descrição', 'text'], ['price', 'Preço (R$)', 'number'], ['duration', 'Duração (min)', 'number'],
    ['kind', 'Tipo (conta no plano)', 'select', { cut: 'Corte', beard: 'Barba', combo: 'Corte + Barba', other: 'Outro' }], ['active', 'Ativo', 'bool']],
    cols: [['Nome', (r) => esc(r.name)], ['Tipo', (r) => esc(r.kind)], ['Preço', (r) => brl(r.price)], ['Min', (r) => r.duration], ['Ativo', (r) => (r.active ? 'Sim' : 'Não')]] },
  barbers: { title: 'Barbeiros', fields: [['name', 'Nome', 'text'], ['specialty', 'Especialidade', 'text'], ['active', 'Ativo', 'bool']],
    cols: [['Nome', (r) => esc(r.name)], ['Especialidade', (r) => esc(r.specialty)], ['Ativo', (r) => (r.active ? 'Sim' : 'Não')]] },
  plans: { title: 'Planos', fields: [['name', 'Nome', 'text'], ['description', 'Descrição', 'text'], ['price', 'Preço mensal (R$)', 'number'], ['cuts', 'Cortes/mês', 'number'], ['beards', 'Barbas/mês', 'number'], ['highlight', 'Destacar', 'bool'], ['active', 'Ativo', 'bool']],
    cols: [['Nome', (r) => esc(r.name)], ['Preço', (r) => brl(r.price)], ['Cortes', (r) => r.cuts], ['Barbas', (r) => r.beards], ['Ativo', (r) => (r.active ? 'Sim' : 'Não')]] },
  products: { title: 'Produtos', fields: [['name', 'Nome', 'text'], ['description', 'Descrição', 'text'], ['icon', 'Ícone (emoji)', 'text'], ['price', 'Preço (R$)', 'number'], ['stock', 'Estoque', 'number'], ['active', 'Ativo', 'bool']],
    cols: [['Produto', (r) => `${esc(r.icon)} ${esc(r.name)}`], ['Preço', (r) => brl(r.price)], ['Estoque', (r) => r.stock], ['Ativo', (r) => (r.active ? 'Sim' : 'Não')]] },
  rewards: { title: 'Recompensas de fidelidade', fields: [['name', 'Nome', 'text'], ['cost', 'Custo (pontos)', 'number'], ['active', 'Ativo', 'bool']],
    cols: [['Nome', (r) => esc(r.name)], ['Pontos', (r) => r.cost], ['Ativo', (r) => (r.active ? 'Sim' : 'Não')]] },
  amenities: { title: 'Comodidades', fields: [['name', 'Nome', 'text'], ['icon', 'Ícone (emoji)', 'text'], ['description', 'Descrição', 'text']],
    cols: [['Comodidade', (r) => `${esc(r.icon)} ${esc(r.name)}`], ['Descrição', (r) => esc(r.description)]] },
};

async function crudView(key) {
  const c = CRUD[key], rows = await api('GET', `/api/admin/${key}`);
  const accounts = key === 'barbers' ? await api('GET', '/api/admin/barber-accounts') : [];
  const cols = key === 'barbers' ? [...c.cols, ['Login', (r) => esc(accounts.find((a) => a.barber_id === r.id)?.email || 'sem conta')]] : c.cols;
  main.innerHTML = `<div class="top"><h1>${c.title}</h1><button class="btn" id="new">+ Novo</button></div>` +
    table([...cols, ['', (r) => `${key === 'barbers' ? `<button class="btn sm" data-a="${r.id}">Conta de login</button> ` : ''}<button class="btn ghost sm" data-e="${r.id}">Editar</button> <button class="btn danger sm" data-d="${r.id}">Excluir</button>`]], rows);
  $$('[data-a]').forEach((b) => (b.onclick = () => accountForm(rows.find((r) => r.id == b.dataset.a), accounts.find((a) => a.barber_id == b.dataset.a))));
  $('#new').onclick = () => form(c, key, null);
  $$('[data-e]').forEach((b) => (b.onclick = () => form(c, key, rows.find((r) => r.id == b.dataset.e))));
  $$('[data-d]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Excluir este item? Se estiver em uso, ele será apenas desativado.')) return;
    try { const r = await api('DELETE', `/api/admin/${key}/${b.dataset.d}`); toast(r.deactivated ? 'Item em uso: foi desativado' : 'Excluído'); go(key); } catch (e) { toast(e.message, true); }
  }));
}
function accountForm(barber, acc) {
  mBody.innerHTML = `<h2>Conta de login · ${esc(barber.name)}</h2><p style="color:var(--muted)">O barbeiro entra em /barbeiro com este e-mail e vê só a própria agenda.</p>
    <form id="af"><label for="ae">E-mail</label><input class="input" id="ae" type="email" value="${esc(acc?.email || '')}" required>
    <label for="ap">${acc ? 'Nova senha (deixe vazio para manter)' : 'Senha'}</label><input class="input" id="ap" type="password" minlength="6" autocomplete="new-password" ${acc ? '' : 'required'}>
    <div class="err" id="ae2" role="alert"></div><button class="btn" style="width:100%">Salvar conta</button></form>`;
  modal.classList.add('open');
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', `/api/admin/barbers/${barber.id}/account`, { email: $('#ae').value, password: $('#ap').value }); closeModal(); toast('Conta salva'); go('barbers'); }
    catch (er) { $('#ae2').textContent = er.message; }
  };
}
function form(c, key, row) {
  mBody.innerHTML = `<h2>${row ? 'Editar' : 'Novo'} · ${esc(c.title)}</h2><form id="f">${c.fields.map(([k, l, t, opts]) => {
    const v = row ? row[k] : t === 'bool' ? 1 : '';
    if (t === 'bool') return `<label style="display:flex;gap:10px;align-items:center;color:var(--text)"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}> ${l}</label>`;
    if (t === 'select') return `<label for="f_${k}">${l}</label><select class="input" id="f_${k}" name="${k}">${Object.entries(opts).map(([ov, ol]) => `<option value="${ov}" ${v === ov ? 'selected' : ''}>${ol}</option>`).join('')}</select>`;
    return `<label for="f_${k}">${l}</label><input class="input" id="f_${k}" name="${k}" type="${t}" ${t === 'number' ? 'step="any" min="0"' : ''} value="${esc(v)}">`;
  }).join('')}<div class="err" id="fe" role="alert"></div><button class="btn" style="width:100%">Salvar</button></form>`;
  modal.classList.add('open');
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    for (const [k, , t] of c.fields) { const el = $(`[name=${k}]`, mBody); body[k] = t === 'bool' ? el.checked : t === 'number' ? Number(el.value) : el.value; }
    try { await api(row ? 'PUT' : 'POST', `/api/admin/${key}${row ? '/' + row.id : ''}`, body); closeModal(); toast('Salvo'); go(key); }
    catch (er) { $('#fe').textContent = er.message; }
  };
}

// ---------- Views ----------
const STATUS_OPTS = ['scheduled', 'confirmed', 'done', 'no_show', 'cancelled'];
const VIEWS = {
  async dash() {
    const d = await api('GET', '/api/admin/dashboard');
    const k = (l, v) => `<div class="kpi"><small>${l}</small><b>${v}</b></div>`;
    main.innerHTML = `<h1>Dashboard</h1><div class="kpis">${k('Atendimentos hoje', d.today)}${k('Próximos agendamentos', d.upcoming)}${k('Clientes', d.clients)}${k('Assinantes ativos', d.subscribers)}
      ${k('Receita serviços (mês)', brl(d.revenueServices))}${k('Receita planos (mês)', brl(d.revenuePlans))}${k('Receita produtos (mês)', brl(d.revenueProducts))}${k('Pedidos a retirar', d.pendingOrders)}${k('Nota média', d.avgRating ? '★ ' + d.avgRating : '—')}</div>
      <div class="grid g3" style="grid-template-columns:2fr 1fr"><div><h3 style="margin-bottom:12px">Agenda de hoje</h3>${table([['Hora', (r) => esc(r.time)], ['Cliente', (r) => esc(r.client)], ['Serviço', (r) => esc(r.service)], ['Barbeiro', (r) => esc(r.barber)], ['Status', (r) => stBadge(r.status)],
        ['', (r) => waBtn(r.phone, `Olá ${r.client.split(' ')[0]}! Lembrete: seu horário de ${r.service} é hoje às ${r.time}. Podemos confirmar?`)]], d.agenda, 'Sem atendimentos hoje.')}</div>
      <div><h3 style="margin-bottom:12px">Serviços mais pedidos</h3>${table([['Serviço', (r) => esc(r.name)], ['Qtd', (r) => r.c]], d.topServices)}</div></div>`;
  },
  async appts() {
    main.innerHTML = `<div class="top"><h1>Agenda</h1><div class="row" style="flex:0 1 420px"><input class="input" type="date" id="fd" aria-label="Filtrar por data"><select class="input" id="fs" aria-label="Filtrar por status"><option value="">Todos os status</option>${STATUS_OPTS.map((s) => `<option value="${s}">${STATUS[s]}</option>`).join('')}</select></div></div><div id="list"></div>`;
    const draw = async () => {
      const q = new URLSearchParams(); if ($('#fd').value) q.set('date', $('#fd').value); if ($('#fs').value) q.set('status', $('#fs').value);
      const rows = await api('GET', '/api/admin/appointments?' + q);
      $('#list').innerHTML = table([['Data', (r) => `${fmtDate(r.date)} ${esc(r.time)}`], ['Cliente', (r) => esc(r.client_name)], ['Serviço', (r) => esc(r.service_name)], ['Barbeiro', (r) => esc(r.barber_name)],
        ['Valor', (r) => (r.subscription_id ? 'Plano' : brl(r.price))],
        ['Status', (r) => `<select class="input" style="padding:5px 8px;width:auto" data-st="${r.id}" ${r.status === 'cancelled' ? 'disabled' : ''} aria-label="Status">${STATUS_OPTS.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>`],
        ['Lembrete', (r) => waBtn(r.client_phone, `Olá ${r.client_name.split(' ')[0]}! Lembrete do seu horário de ${r.service_name} em ${fmtDate(r.date)} às ${r.time} com ${r.barber_name}. Podemos confirmar?`)]], rows, 'Nenhum agendamento encontrado.');
      $$('[data-st]').forEach((s) => (s.onchange = async () => { if (await act(() => api('POST', `/api/admin/appointments/${s.dataset.st}/status`, { status: s.value }), 'Status atualizado')) draw(); }));
    };
    $('#fd').onchange = draw; $('#fs').onchange = draw; draw();
  },
  async clients() {
    const rows = await api('GET', '/api/admin/clients');
    main.innerHTML = `<h1>Clientes</h1>` + table([['Nome', (r) => esc(r.name)], ['E-mail', (r) => esc(r.email)], ['Telefone', (r) => esc(r.phone)], ['Plano', (r) => esc(r.plan || '—')], ['Visitas', (r) => r.visits], ['Pontos', (r) => r.points], ['Desde', (r) => fmtDate(r.created_at)],
      ['', (r) => waBtn(r.phone, `Olá ${r.name.split(' ')[0]}! Aqui é da barbearia.`)]], rows);
  },
  async subs() {
    const rows = await api('GET', '/api/admin/subscriptions');
    main.innerHTML = `<h1>Assinaturas</h1>` + table([['Cliente', (r) => esc(r.client_name)], ['Plano', (r) => esc(r.plan_name)], ['Período', (r) => `${fmtDate(r.period_start)} → ${fmtDate(r.period_end)}`],
      ['Cortes', (r) => `${r.cuts_used}/${r.cuts}`], ['Barbas', (r) => `${r.beards_used}/${r.beards}`], ['Status', (r) => stBadge(r.status)]], rows);
  },
  async pays() {
    const rows = await api('GET', '/api/admin/payments');
    main.innerHTML = `<h1>Pagamentos</h1><p style="color:var(--muted);margin-bottom:14px">Pagamentos de planos (simulados nesta versão).</p>` + table([['Data', (r) => fmtDate(r.created_at)], ['Cliente', (r) => esc(r.client_name)], ['Valor', (r) => brl(r.amount)], ['Forma', (r) => (r.method === 'pix' ? 'Pix' : 'Cartão')], ['Status', (r) => stBadge(r.status)]], rows);
  },
  async orders() {
    const rows = await api('GET', '/api/admin/orders');
    main.innerHTML = `<h1>Pedidos da loja</h1>` + table([['Data', (r) => fmtDate(r.created_at)], ['Cliente', (r) => esc(r.client_name)], ['Itens', (r) => esc(r.items)], ['Total', (r) => brl(r.total)], ['Status', (r) => stBadge(r.status)],
      ['', (r) => (r.status === 'reserved' ? `<button class="btn sm" data-o="delivered" data-id="${r.id}">Entregue/pago</button> <button class="btn danger sm" data-o="cancelled" data-id="${r.id}">Cancelar</button>` : '')]], rows);
    $$('[data-o]').forEach((b) => (b.onclick = async () => { if (await act(() => api('POST', `/api/admin/orders/${b.dataset.id}/status`, { status: b.dataset.o }), 'Pedido atualizado')) go('orders'); }));
  },
  async redemptions() {
    const rows = await api('GET', '/api/admin/redemptions');
    main.innerHTML = `<h1>Resgates de fidelidade</h1>` + table([['Data', (r) => fmtDate(r.created_at)], ['Cliente', (r) => esc(r.client_name)], ['Recompensa', (r) => esc(r.reward_name)], ['Pontos', (r) => r.cost], ['Status', (r) => stBadge(r.status)],
      ['', (r) => (r.status === 'open' ? `<button class="btn sm" data-use="${r.id}">Marcar como usado</button>` : '')]], rows);
    $$('[data-use]').forEach((b) => (b.onclick = async () => { if (await act(() => api('POST', `/api/admin/redemptions/${b.dataset.use}/use`), 'Resgate utilizado')) go('redemptions'); }));
  },
  async reviews() {
    const rows = await api('GET', '/api/admin/reviews');
    main.innerHTML = `<h1>Avaliações</h1>` + table([['Data', (r) => fmtDate(r.created_at)], ['Cliente', (r) => esc(r.client_name)], ['Barbeiro', (r) => esc(r.barber_name)], ['Nota', (r) => `<span class="stars">${stars(r.rating)}</span>`], ['Comentário', (r) => esc(r.comment)]], rows);
  },
  async settings() {
    const s = await api('GET', '/api/admin/settings');
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], on = s.days.split(',');
    main.innerHTML = `<h1>Configurações</h1><div class="card" style="max-width:560px"><form id="sf">
      <label for="s1">Nome da barbearia</label><input class="input" id="s1" value="${esc(s.shop_name)}"><label for="s2">Endereço</label><input class="input" id="s2" value="${esc(s.address)}">
      <label for="s3">Telefone</label><input class="input" id="s3" value="${esc(s.phone)}"><label for="s4">WhatsApp da barbearia (só dígitos, com DDI)</label><input class="input" id="s4" value="${esc(s.whatsapp)}" inputmode="numeric">
      <div class="row"><div><label for="s5">Abre</label><input class="input" id="s5" type="time" value="${esc(s.open)}"></div><div><label for="s6">Fecha</label><input class="input" id="s6" type="time" value="${esc(s.close)}"></div>
      <div><label for="s8">Pontos por visita</label><input class="input" id="s8" type="number" min="0" value="${esc(s.points_per_visit)}"></div></div>
      <label>Dias de atendimento</label><div class="row" style="gap:8px">${days.map((d, i) => `<label style="display:flex;gap:6px;align-items:center;margin:0;color:var(--text);flex:0"><input type="checkbox" data-day="${i}" ${on.includes(String(i)) ? 'checked' : ''}>${d}</label>`).join('')}</div>
      <div class="err" id="se" role="alert"></div><button class="btn">Salvar</button></form></div>`;
    $('#sf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/settings', { shop_name: $('#s1').value, address: $('#s2').value, phone: $('#s3').value, whatsapp: $('#s4').value, open: $('#s5').value, close: $('#s6').value,
          points_per_visit: $('#s8').value, days: $$('[data-day]').filter((c) => c.checked).map((c) => c.dataset.day).join(',') });
        toast('Configurações salvas');
      } catch (er) { $('#se').textContent = er.message; }
    };
  },
};
for (const k of Object.keys(CRUD)) VIEWS[k] = () => crudView(k);

const waBtn = (phone, msg) => { const l = waLink(phone, msg); return l ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${esc(l)}">WhatsApp</a>` : '<small style="color:var(--muted)">sem telefone</small>'; };

async function go(v) {
  $('#side').classList.remove('open');
  $$('.tab[data-v]').forEach((t) => t.classList.toggle('on', t.dataset.v === v));
  try { await VIEWS[v](); } catch (e) { if (e.status === 401 || e.status === 403) location.href = '/'; else main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
go('dash');
