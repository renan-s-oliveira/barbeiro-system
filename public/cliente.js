let O = null, view = 'home', PUB = null;
const main = $('#main');
const modal = $('#modal'), mBody = $('#mBody');
const closeModal = () => modal.classList.remove('open');
$('#mClose').onclick = closeModal;
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');

async function load() {
  try { O = await api('GET', '/api/me/overview'); }
  catch (e) {
    if (e.status === 401) return (location.href = '/');
    if (e.status === 403) { // conta de outro perfil: leva ao painel certo
      const { user } = await api('GET', '/api/auth/me');
      return (location.href = { admin: '/admin', barber: '/barbeiro' }[user?.role] || '/');
    }
    throw e;
  }
  PUB = PUB || (await api('GET', '/api/public'));
  show(view);
}
function show(v) {
  view = v; $('#side').classList.remove('open');
  $$('.tab[data-v]').forEach((t) => t.classList.toggle('on', t.dataset.v === v));
  main.innerHTML = VIEWS[v]();
  bind();
}
$('#tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-v]'); if (t) show(t.dataset.v); });
$('#logout').onclick = async () => { await api('POST', '/api/auth/logout'); location.href = '/'; };

const upcoming = () => O.appointments.filter((a) => ['scheduled', 'confirmed'].includes(a.status) && a.date >= today());
const bar = (used, total) => `<div class="bar"><i style="width:${total ? Math.min(100, (used / total) * 100) : 0}%"></i></div>`;

function apptTable(list) {
  if (!list.length) return '<div class="empty">Nenhum agendamento ainda. <a href="/#servicos">Agendar agora</a></div>';
  return `<div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Serviço</th><th>Barbeiro</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>${list.map((a) => {
    const canCancel = ['scheduled', 'confirmed'].includes(a.status);
    const msg = `Olá! Confirmo meu horário de ${a.service_name} em ${fmtDate(a.date)} às ${a.time}.`;
    return `<tr><td>${fmtDate(a.date)} ${esc(a.time)}</td><td>${esc(a.service_name)}</td><td>${esc(a.barber_name)}</td>
    <td>${a.subscription_id ? 'Plano' : brl(a.price)}</td><td>${stBadge(a.status)}</td><td>
    ${canCancel ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${esc(waLink(O.whatsapp, msg))}">WhatsApp</a> <button class="btn danger sm" data-cancel="${a.id}">Cancelar</button>` : ''}
    ${a.status === 'done' ? (a.rating ? `<span class="stars">${stars(a.rating)}</span>` : `<button class="btn sm" data-review="${a.id}">Avaliar</button>`) : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

const VIEWS = {
  home() {
    const s = O.subscription, nx = upcoming().slice().reverse()[0];
    return `<div class="top"><h1>Olá, ${esc(O.user.name.split(' ')[0])} 👋</h1><a class="btn" href="/#servicos">Novo agendamento</a></div>
    <div class="kpis"><div class="kpi"><small>Próximo horário</small><b style="font-size:1.1rem">${nx ? `${fmtDate(nx.date)} ${esc(nx.time)}` : '—'}</b></div>
    <div class="kpi"><small>Pontos de fidelidade</small><b>${O.points}</b></div>
    <div class="kpi"><small>Plano</small><b style="font-size:1.1rem">${s ? esc(s.plan_name) : 'Sem plano'}</b></div>
    <div class="kpi"><small>Visitas concluídas</small><b>${O.appointments.filter((a) => a.status === 'done').length}</b></div></div>
    <h3 style="margin-bottom:12px">Próximos agendamentos</h3>${apptTable(upcoming().slice().reverse())}`;
  },
  appts() { return `<div class="top"><h1>Meus agendamentos</h1><a class="btn" href="/#servicos">Novo agendamento</a></div>${apptTable(O.appointments)}`; },
  plan() {
    const s = O.subscription;
    const pay = O.payments.length ? `<h3 style="margin:26px 0 12px">Pagamentos</h3><div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Valor</th><th>Forma</th><th>Status</th></tr></thead><tbody>${O.payments.map((p) =>
      `<tr><td>${fmtDate(p.created_at)}</td><td>${brl(p.amount)}</td><td>${p.method === 'pix' ? 'Pix' : 'Cartão'}</td><td>${stBadge(p.status)}</td></tr>`).join('')}</tbody></table></div>` : '';
    if (!s) return `<h1>Meu plano</h1><div class="card"><h3>Você ainda não tem um plano</h3><p>Assine e tenha cortes e barbas todo mês com preço fixo.</p><p style="margin-top:14px"><a class="btn" href="/#planos">Ver planos</a></p></div>${pay}`;
    return `<h1>Meu plano</h1><div class="card"><div class="top"><h3>${esc(s.plan_name)}</h3>${stBadge('active')}</div><p>Válido de ${fmtDate(s.period_start)} até ${fmtDate(s.period_end)} · ${brl(s.price)}/mês</p>
      ${s.cuts ? `<p style="margin-top:16px">Cortes usados: <b>${s.cuts_used}/${s.cuts}</b></p>${bar(s.cuts_used, s.cuts)}` : ''}
      ${s.beards ? `<p>Barbas usadas: <b>${s.beards_used}/${s.beards}</b></p>${bar(s.beards_used, s.beards)}` : ''}
      <button class="btn danger sm" id="cancelPlan">Cancelar plano</button></div>${pay}`;
  },
  loyalty() {
    const rw = PUB.rewards.map((r) => `<div class="card amen"><div class="price">${r.cost} pts</div><h3 style="margin:6px 0 12px">${esc(r.name)}</h3>
      <button class="btn sm" data-redeem="${r.id}" ${O.points < r.cost ? 'disabled' : ''}>Resgatar</button></div>`).join('');
    const mine = O.redemptions.length ? `<h3 style="margin:26px 0 12px">Meus resgates</h3><div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Recompensa</th><th>Status</th></tr></thead><tbody>${O.redemptions.map((d) =>
      `<tr><td>${fmtDate(d.created_at)}</td><td>${esc(d.name)}</td><td>${stBadge(d.status)}</td></tr>`).join('')}</tbody></table></div><p style="color:var(--muted);margin-top:8px;font-size:.85rem">Apresente o resgate disponível na barbearia para utilizar.</p>` : '';
    const hist = O.loyalty.length ? `<h3 style="margin:26px 0 12px">Extrato</h3><div class="tbl-wrap"><table><tbody>${O.loyalty.map((l) =>
      `<tr><td>${fmtDate(l.created_at)}</td><td>${esc(l.reason)}</td><td style="color:var(${l.points > 0 ? '--ok' : '--bad'})">${l.points > 0 ? '+' : ''}${l.points}</td></tr>`).join('')}</tbody></table></div>` : '';
    return `<div class="top"><h1>Fidelidade</h1><div class="kpi"><small>Seu saldo</small><b>${O.points} pts</b></div></div>
      <p style="color:var(--muted);margin-bottom:18px">Ganhe pontos a cada visita concluída e ao avaliar o atendimento.</p><div class="grid g3">${rw}</div>${mine}${hist}`;
  },
  orders() {
    if (!O.orders.length) return '<h1>Pedidos</h1><div class="empty">Nenhum pedido. <a href="/#loja">Ver a loja</a></div>';
    return `<h1>Pedidos da loja</h1><div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Itens</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${O.orders.map((o) =>
      `<tr><td>${fmtDate(o.created_at)}</td><td class="wrap">${esc(o.items)}</td><td>${brl(o.total)}</td><td>${stBadge(o.status)}</td>
      <td>${o.status === 'reserved' ? `<button class="btn danger sm" data-ocancel="${o.id}">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  },
  profile() {
    return `<h1>Meu perfil</h1><div class="card" style="max-width:480px"><form id="pf"><label for="pn">Nome</label><input class="input" id="pn" value="${esc(O.user.name)}" required>
      <label for="pp">WhatsApp</label><input class="input" id="pp" value="${esc(O.user.phone)}"><label>E-mail</label><input class="input" value="${esc(O.user.email)}" disabled>
      <label for="ps">Nova senha (opcional)</label><input class="input" id="ps" type="password" minlength="6" autocomplete="new-password">
      <p class="err" id="pe" role="alert"></p><button class="btn">Salvar</button></form></div>`;
  },
};

function bind() {
  $$('[data-cancel]').forEach((b) => (b.onclick = async () => { if (confirm('Cancelar este agendamento?')) if (await act(() => api('POST', `/api/appointments/${b.dataset.cancel}/cancel`), 'Agendamento cancelado')) load(); }));
  $$('[data-ocancel]').forEach((b) => (b.onclick = async () => { if (confirm('Cancelar este pedido?')) if (await act(() => api('POST', `/api/orders/${b.dataset.ocancel}/cancel`), 'Pedido cancelado')) load(); }));
  $$('[data-redeem]').forEach((b) => (b.onclick = async () => { if (confirm('Resgatar esta recompensa?')) if (await act(() => api('POST', `/api/rewards/${b.dataset.redeem}/redeem`), 'Recompensa resgatada! 🎁')) load(); }));
  $$('[data-review]').forEach((b) => (b.onclick = () => reviewModal(b.dataset.review)));
  const cp = $('#cancelPlan'); if (cp) cp.onclick = async () => { if (confirm('Cancelar seu plano? Os créditos restantes serão perdidos.')) if (await act(() => api('POST', '/api/subscriptions/cancel'), 'Plano cancelado')) load(); };
  const pf = $('#pf'); if (pf) pf.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/me/profile', { name: $('#pn').value, phone: $('#pp').value, password: $('#ps').value || undefined }); toast('Perfil atualizado'); load(); }
    catch (er) { $('#pe').textContent = er.message; }
  };
}

function reviewModal(id) {
  let rating = 5;
  mBody.innerHTML = `<h2>Avaliar atendimento</h2><p style="color:var(--muted)">Você ganha +5 pontos ao avaliar.</p>
    <div class="row" id="rs" style="margin-top:14px;flex-wrap:nowrap">${[1, 2, 3, 4, 5].map((n) => `<button class="chip" data-r="${n}" aria-label="${n} estrelas">${'★'.repeat(n)}</button>`).join('')}</div>
    <label for="rc">Comentário (opcional)</label><input class="input" id="rc" maxlength="300"><div class="err" id="re" role="alert"></div><button class="btn" id="rsend" style="width:100%">Enviar avaliação</button>`;
  modal.classList.add('open');
  const paint = () => $$('[data-r]', mBody).forEach((c) => c.classList.toggle('sel', +c.dataset.r === rating));
  $$('[data-r]', mBody).forEach((c) => (c.onclick = () => { rating = +c.dataset.r; paint(); })); paint();
  $('#rsend').onclick = async () => {
    try { await api('POST', `/api/appointments/${id}/review`, { rating, comment: $('#rc').value }); closeModal(); toast('Obrigado pela avaliação!'); load(); }
    catch (e) { $('#re').textContent = e.message; }
  };
}

load();
