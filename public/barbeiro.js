const main = $('#main');
let S = null, date = today(), view = 'agenda', whatsapp = '';
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');
$('#logout').onclick = async () => { await api('POST', '/api/auth/logout'); location.href = '/'; };
$('#tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-v]'); if (t) { view = t.dataset.v; show(); } });

const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
const weekday = (d) => ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(d + 'T12:00:00').getDay()];

async function boot() {
  try { S = await api('GET', '/api/barber/summary'); }
  catch (e) {
    if (e.status === 401) return (location.href = '/');
    if (e.status === 403) { const { user } = await api('GET', '/api/auth/me'); return (location.href = { admin: '/admin', client: '/cliente' }[user?.role] || '/'); }
    throw e;
  }
  try { whatsapp = (await api('GET', '/api/public')).settings.whatsapp; } catch {}
  show();
}

function show() {
  $('#side').classList.remove('open');
  $$('.tab[data-v]').forEach((t) => t.classList.toggle('on', t.dataset.v === view));
  if (view === 'agenda') agendaView(); else if (view === 'reviews') reviewsView(); else profileView();
}

async function agendaView() {
  const k = (l, v) => `<div class="kpi"><small>${l}</small><b>${v}</b></div>`;
  main.innerHTML = `<h1>Olá, ${esc(S.barber.name.split(' ')[0])} 💈</h1>
    <div class="kpis">${k('Atendimentos hoje', esc(S.today))}${k('Próximos agendamentos', esc(S.upcoming))}${k('Concluídos no mês', esc(S.doneMonth))}${k('Minha nota', S.avgRating ? '★ ' + esc(S.avgRating) : '—')}</div>
    <div class="top"><h3>${fmtDate(date)} · ${esc(weekday(date))}${date === today() ? ' (hoje)' : ''}</h3>
    <div class="row" style="flex:0 1 auto;flex-wrap:nowrap"><button class="btn ghost sm" id="prev" aria-label="Dia anterior">‹</button><input class="input" type="date" id="dt" value="${esc(date)}" aria-label="Escolher data" style="width:auto"><button class="btn ghost sm" id="next" aria-label="Próximo dia">›</button><button class="btn sm" id="tod">Hoje</button></div></div>
    <div id="list"></div>`;
  $('#prev').onclick = () => { date = addDays(date, -1); agendaView(); };
  $('#next').onclick = () => { date = addDays(date, 1); agendaView(); };
  $('#tod').onclick = () => { date = today(); agendaView(); };
  $('#dt').onchange = (e) => { if (e.target.value) { date = e.target.value; agendaView(); } };
  await drawList();
}

async function drawList() {
  let rows;
  try { rows = await api('GET', `/api/barber/agenda?date=${encodeURIComponent(date)}`); } catch (e) { return ($('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`); }
  if (!rows.length) return ($('#list').innerHTML = '<div class="empty">Nenhum atendimento neste dia. ☕</div>');
  $('#list').innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Hora</th><th>Cliente</th><th>Serviço</th><th>Obs.</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.map((r) => {
    const msg = `Olá ${r.client_name.split(' ')[0]}! Lembrete do seu horário de ${r.service_name} em ${fmtDate(r.date)} às ${r.time}. Podemos confirmar?`;
    const l = waLink(r.client_phone, msg);
    return `<tr><td><b>${esc(r.time)}</b> <small style="color:var(--muted)">${esc(r.duration)}min</small></td><td>${esc(r.client_name)}</td><td>${esc(r.service_name)}${r.subscription_id ? ' <span class="pill">plano</span>' : ''}</td>
      <td class="wrap">${esc(r.notes)}</td><td>${stBadge(r.status)}</td><td>
      ${r.status === 'scheduled' ? `<button class="btn ghost sm" data-s="confirmed" data-id="${r.id}">Confirmar</button> ` : ''}
      ${['scheduled', 'confirmed'].includes(r.status) ? `<button class="btn sm" data-s="done" data-id="${r.id}">Concluir</button> <button class="btn danger sm" data-s="no_show" data-id="${r.id}">Faltou</button> ` : ''}
      ${l ? `<a class="btn wa sm" target="_blank" rel="noopener" href="${esc(l)}">WhatsApp</a>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  $$('[data-s]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.s === 'no_show' && !confirm('Marcar que o cliente não compareceu?')) return;
    if (await act(() => api('POST', `/api/barber/appointments/${b.dataset.id}/status`, { status: b.dataset.s }), 'Status atualizado')) { S = await api('GET', '/api/barber/summary'); agendaView(); }
  }));
}

function reviewsView() {
  main.innerHTML = `<div class="top"><h1>Minhas avaliações</h1><div class="kpi"><small>Nota média</small><b>${S.avgRating ? '★ ' + esc(S.avgRating) : '—'}</b></div></div>` +
    (S.reviews.length ? `<div class="grid g3">${S.reviews.map((r) => `<div class="card"><div class="stars">${stars(r.rating)}</div><p class="quote">${r.comment ? `“${esc(r.comment)}”` : '<small>Sem comentário</small>'}</p><p style="margin-top:8px"><b>${esc(r.client.split(' ')[0])}</b> · ${fmtDate(r.created_at)}</p></div>`).join('')}</div>`
      : '<div class="empty">Você ainda não recebeu avaliações.</div>');
}

function profileView() {
  main.innerHTML = `<h1>Perfil e senha</h1><div class="card" style="max-width:480px"><form id="pf"><label>Nome</label><input class="input" id="pn" value="${esc(S.barber.name)}" required>
    <label for="pp">WhatsApp</label><input class="input" id="pp"><label for="ps">Nova senha</label><input class="input" id="ps" type="password" minlength="6" autocomplete="new-password">
    <p class="err" id="pe" role="alert"></p><button class="btn">Salvar</button></form></div>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/me/profile', { name: $('#pn').value, phone: $('#pp').value, password: $('#ps').value || undefined }); toast('Perfil atualizado'); $('#ps').value = ''; }
    catch (er) { $('#pe').textContent = er.message; }
  };
}
boot();
