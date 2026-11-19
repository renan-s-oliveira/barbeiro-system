let D = null;        // dados públicos
let ME = null;       // usuário logado
let SUB = null;      // assinatura ativa
let cart = {};       // {productId: qty}

const KIND = { cut: 'Corte', beard: 'Barba', combo: 'Combo', other: 'Serviço' };
const modal = $('#modal'), mBody = $('#mBody');
const openModal = (html) => { mBody.innerHTML = html; modal.classList.add('open'); };
const closeModal = () => modal.classList.remove('open');
$('#mClose').onclick = closeModal;
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
$('#menuBtn').onclick = (e) => { const o = $('#navLinks').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); };
$('#navLinks').addEventListener('click', (e) => { if (e.target.tagName === 'A') $('#navLinks').classList.remove('open'); });

async function load() {
  D = await api('GET', '/api/public');
  try { ME = (await api('GET', '/api/auth/me')).user; } catch { ME = null; }
  if (ME && ME.role === 'client') { try { SUB = (await api('GET', '/api/me/overview')).subscription; } catch {} }
  render();
}

function render() {
  const s = D.settings;
  document.title = s.shop_name;
  $('.logo').innerHTML = esc(s.shop_name.replace(/^Barbearia /, '').toUpperCase());
  $('#authArea').innerHTML = ME
    ? `<a class="btn sm" href="${panelUrl(ME.role)}">${{ admin: 'Painel admin', barber: 'Minha agenda', client: 'Minha conta' }[ME.role]}</a>`
    : `<button class="btn sm ghost" id="loginBtn">Entrar</button>`;
  if (!ME) $('#loginBtn').onclick = () => authModal();

  const rated = D.barbers.filter((b) => b.rating);
  const avg = rated.length ? (rated.reduce((a, b) => a + b.rating, 0) / rated.length).toFixed(1) : '5.0';
  $('#heroStats').innerHTML = `<div><b>${esc(D.services.length)}</b><small>serviços</small></div><div><b>${esc(D.barbers.length)}</b><small>barbeiros</small></div><div><b>★ ${esc(avg)}</b><small>avaliação média</small></div>`;

  $('#services').innerHTML = D.services.map((v) => `<div class="card svc"><span class="pill">${KIND[v.kind]}</span><h3>${esc(v.name)}</h3><p>${esc(v.description)}</p>
    <div class="meta"><span class="price">${brl(v.price)}</span><button class="btn sm" data-book="${v.id}">Agendar</button></div><small class="gold">${v.duration} min</small></div>`).join('');

  $('#plans').innerHTML = D.plans.map((p) => `<div class="card plan ${p.highlight ? 'hl' : ''}">${p.highlight ? '<span class="badge">MAIS POPULAR</span>' : ''}
    <h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="price">${brl(p.price)} <small>/mês</small></div>
    <ul>${p.cuts ? `<li>${p.cuts} cortes por mês</li>` : ''}${p.beards ? `<li>${p.beards} barbas por mês</li>` : ''}<li>Agendamento prioritário</li><li>Cancele quando quiser</li></ul>
    <button class="btn ${p.highlight ? '' : 'ghost'}" data-plan="${p.id}" style="margin-top:auto">Assinar</button></div>`).join('');

  $('#barbers').innerHTML = D.barbers.map((b) => `<div class="card barber"><div class="avatar" aria-hidden="true">${esc(b.name[0])}</div><h3>${esc(b.name)}</h3><p>${esc(b.specialty)}</p>
    <p class="stars" style="margin-top:8px">${b.rating ? `${stars(Math.round(b.rating))} <small>${b.rating} (${b.reviews})</small>` : '<small>Novo na equipe</small>'}</p></div>`).join('');

  $('#products').innerHTML = D.products.map((p) => `<div class="card prod"><div class="ico" aria-hidden="true">${esc(p.icon)}</div><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>
    <div class="price">${brl(p.price)}</div><button class="btn sm" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>${p.stock < 1 ? 'Esgotado' : 'Adicionar'}</button></div>`).join('');
  updateCart();

  $('#amenities').innerHTML = D.amenities.map((a) => `<div class="card amen"><div class="ico" aria-hidden="true">${esc(a.icon)}</div><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p></div>`).join('');
  $('#rewards').innerHTML = D.rewards.map((r) => `<div class="card amen"><div class="price">${esc(r.cost)} pts</div><h3 style="margin-top:6px">${esc(r.name)}</h3></div>`).join('');
  $('#reviews').innerHTML = D.reviews.length ? D.reviews.map((r) => `<div class="card"><div class="stars">${stars(r.rating)}</div><p class="quote">“${esc(r.comment)}”</p><p style="margin-top:8px"><b>${esc(r.client)}</b> · ${esc(r.barber)}</p></div>`).join('')
    : '<p class="empty" style="grid-column:1/-1">Seja o primeiro a avaliar!</p>';
  $('#footer').innerHTML = `<p><b>${esc(s.shop_name)}</b> · ${esc(s.address)} · ${esc(s.phone)}</p><p>Horário: ${esc(s.open)} às ${esc(s.close)} · ${esc(daysLabel(s.days))}</p>`;
}
const panelUrl = (role) => ({ admin: '/admin', barber: '/barbeiro', client: '/cliente' }[role] || '/');
const daysLabel = (d) => d.split(',').map((n) => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][n]).join(', ');

document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.book) bookFlow(+t.dataset.book);
  if (t.id === 'heroBook') bookFlow();
  if (t.dataset.plan) planModal(+t.dataset.plan);
  if (t.dataset.add) { cart[t.dataset.add] = (cart[t.dataset.add] || 0) + 1; updateCart(); toast('Adicionado ao carrinho'); }
  if (t.id === 'cartBtn') cartModal();
});
function updateCart() { $('#cartCount').textContent = Object.values(cart).reduce((a, b) => a + b, 0); }

// ---------- Login / cadastro ----------
function authModal(after, mode = 'login') {
  const reg = mode === 'register';
  openModal(`<h2 id="mTitle">${reg ? 'Criar conta' : 'Entrar'}</h2><p style="color:var(--muted)">${reg ? 'Rápido e gratuito.' : 'Acesse para agendar e ver seus planos.'}</p>
    <form id="authForm" novalidate>
    ${reg ? '<label for="aN">Nome</label><input class="input" id="aN" autocomplete="name" required><label for="aP">WhatsApp</label><input class="input" id="aP" autocomplete="tel" placeholder="(11) 99999-9999">' : ''}
    <label for="aE">E-mail</label><input class="input" id="aE" type="email" autocomplete="email" required>
    <label for="aS">Senha</label><input class="input" id="aS" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="6">
    <div class="err" id="aErr" role="alert"></div>
    <button class="btn" style="width:100%;margin-top:6px">${reg ? 'Cadastrar' : 'Entrar'}</button></form>
    <p style="text-align:center;margin-top:16px;color:var(--muted)">${reg ? 'Já tem conta?' : 'Novo por aqui?'} <a href="#" id="swap">${reg ? 'Entrar' : 'Criar conta'}</a></p>`);
  $('#swap').onclick = (e) => { e.preventDefault(); authModal(after, reg ? 'login' : 'register'); };
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = { email: $('#aE').value, password: $('#aS').value };
      if (reg) { body.name = $('#aN').value; body.phone = $('#aP').value; }
      const r = await api('POST', reg ? '/api/auth/register' : '/api/auth/login', body);
      if (r.role !== 'client') return (location.href = panelUrl(r.role));
      closeModal(); await load(); if (after) after();
    } catch (err) { $('#aErr').textContent = err.message; }
  };
}
const needClient = (fn) => {
  if (!ME) return authModal(fn);
  if (ME.role !== 'client') return toast('Entre com uma conta de cliente para esta ação', true);
  fn();
};

// ---------- Agendamento ----------
function bookFlow(serviceId) {
  const st = { service: serviceId || null, barber: null, date: null, time: null, usePlan: false };
  const step = () => {
    const n = !st.service ? 1 : !st.barber ? 2 : !st.time ? 3 : 4;
    const head = `<h2 id="mTitle">Agendar horário</h2><div class="steps">${[1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
    if (n === 1) {
      openModal(head + `<p>Escolha o serviço</p><div class="opts" style="margin-top:10px">${D.services.map((v) => `<button class="opt" data-s="${v.id}"><span>${esc(v.name)}<small>${v.duration} min</small></span><b class="gold">${brl(v.price)}</b></button>`).join('')}</div>`);
      $$('[data-s]', mBody).forEach((b) => (b.onclick = () => { st.service = +b.dataset.s; step(); }));
    } else if (n === 2) {
      openModal(head + `<p>Escolha o barbeiro</p><div class="opts" style="margin-top:10px">${D.barbers.map((b) => `<button class="opt" data-b="${b.id}"><span>${esc(b.name)}<small>${esc(b.specialty)}</small></span><span class="stars">${b.rating ? '★ ' + b.rating : ''}</span></button>`).join('')}</div><button class="btn ghost sm" id="back" style="margin-top:14px">Voltar</button>`);
      $$('[data-b]', mBody).forEach((b) => (b.onclick = () => { st.barber = +b.dataset.b; step(); }));
      $('#back').onclick = () => { st.service = null; step(); };
    } else if (n === 3) {
      const min = today();
      openModal(head + `<label for="bd">Data</label><input class="input" id="bd" type="date" min="${min}" value="${st.date || ''}"><div id="slots" class="slots"></div><div class="err" id="bErr"></div><button class="btn ghost sm" id="back" style="margin-top:14px">Voltar</button>`);
      $('#back').onclick = () => { st.barber = null; step(); };
      const loadSlots = async () => {
        st.date = $('#bd').value; if (!st.date) return;
        try {
          const { slots } = await api('GET', `/api/availability?barber=${st.barber}&service=${st.service}&date=${st.date}`);
          $('#slots').innerHTML = slots.length ? slots.map((t) => `<button class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join('') : '<p class="empty" style="grid-column:1/-1">Sem horários neste dia.</p>';
          $$('[data-t]', mBody).forEach((b) => (b.onclick = () => { st.time = b.dataset.t; step(); }));
        } catch (e) { $('#bErr').textContent = e.message; }
      };
      $('#bd').onchange = loadSlots; if (st.date) loadSlots();
    } else {
      const sv = D.services.find((x) => x.id === st.service), br = D.barbers.find((x) => x.id === st.barber);
      const covered = SUB && ((sv.kind === 'cut' && SUB.cuts_used < SUB.cuts) || (sv.kind === 'beard' && SUB.beards_used < SUB.beards) ||
        (sv.kind === 'combo' && SUB.cuts_used < SUB.cuts && SUB.beards_used < SUB.beards));
      openModal(head + `<div class="summary"><div><span>Serviço</span><b>${esc(sv.name)}</b></div><div><span>Barbeiro</span><b>${esc(br.name)}</b></div>
        <div><span>Quando</span><b>${fmtDate(st.date)} às ${esc(st.time)}</b></div><div><span>Valor</span><b class="gold" id="val">${brl(sv.price)}</b></div></div>
        ${covered ? `<label style="display:flex;gap:10px;align-items:center;color:var(--text)"><input type="checkbox" id="usePlan" checked> Usar crédito do meu plano (${esc(SUB.plan_name)})</label>` : ''}
        <label for="nt">Observações (opcional)</label><input class="input" id="nt" maxlength="300">
        <div class="err" id="bErr" role="alert"></div>
        <div class="row" style="margin-top:10px"><button class="btn ghost" id="back">Voltar</button><button class="btn" id="ok">Confirmar agendamento</button></div>`);
      const up = $('#usePlan'); const upd = () => ($('#val').textContent = up && up.checked ? 'Incluso no plano' : brl(sv.price));
      if (up) { up.onchange = upd; upd(); }
      $('#back').onclick = () => { st.time = null; step(); };
      $('#ok').onclick = () => needClient(async () => {
        try {
          await api('POST', '/api/appointments', { service_id: st.service, barber_id: st.barber, date: st.date, time: st.time, notes: $('#nt')?.value || '', use_plan: !!(up && up.checked) });
          openModal(`<h2 id="mTitle">Agendado! ✂️</h2><p style="margin:10px 0 18px">${esc(sv.name)} com ${esc(br.name)} em ${fmtDate(st.date)} às ${esc(st.time)}.</p>
            <div class="row"><a class="btn wa" target="_blank" rel="noopener" href="${esc(waLink(D.settings.whatsapp, `Olá! Agendei ${sv.name} com ${br.name} em ${fmtDate(st.date)} às ${st.time}.`))}">Avisar no WhatsApp</a><a class="btn" href="/cliente">Meus agendamentos</a></div>`);
          load();
        } catch (e) { const el = $('#bErr'); if (el) el.textContent = e.message; else toast(e.message, true); }
      });
    }
  };
  step();
}

// ---------- Plano (pagamento simulado) ----------
function planModal(id) {
  const p = D.plans.find((x) => x.id === id);
  needClient(() => {
    openModal(`<h2 id="mTitle">Assinar ${esc(p.name)}</h2><p style="color:var(--muted)">${esc(p.description)}</p>
      <div class="summary"><div><span>Valor mensal</span><b class="gold">${brl(p.price)}</b></div><div><span>Vigência</span><b>30 dias</b></div></div>
      <label for="pm">Forma de pagamento</label><select class="input" id="pm"><option value="pix">Pix</option><option value="cartao">Cartão de crédito</option></select>
      <p style="color:var(--muted);font-size:.8rem;margin-top:10px">Ambiente de demonstração: o pagamento é simulado e nenhuma cobrança real é feita.</p>
      <div class="err" id="pErr" role="alert"></div><button class="btn" id="pay" style="width:100%;margin-top:6px">Pagar ${brl(p.price)}</button>`);
    $('#pay').onclick = async () => {
      try { await api('POST', '/api/subscriptions', { plan_id: id, method: $('#pm').value }); closeModal(); toast('Plano ativado! 🎉'); await load(); }
      catch (e) { $('#pErr').textContent = e.message; }
    };
  });
}

// ---------- Carrinho ----------
function cartModal() {
  const rows = Object.entries(cart).map(([id, q]) => ({ p: D.products.find((x) => x.id == id), q })).filter((r) => r.p);
  const total = rows.reduce((a, r) => a + r.p.price * r.q, 0);
  openModal(`<h2 id="mTitle">Seu carrinho</h2>${rows.length ? `<div class="opts" style="margin-top:12px">${rows.map((r) => `<div class="opt"><span>${esc(r.p.icon)} ${esc(r.p.name)}<small>${brl(r.p.price)} cada</small></span>
    <span><button class="chip" style="padding:4px 10px" data-m="${r.p.id}" aria-label="Diminuir">−</button> ${r.q} <button class="chip" style="padding:4px 10px" data-p="${r.p.id}" aria-label="Aumentar">+</button></span></div>`).join('')}</div>
    <div class="summary"><div><span>Total</span><b class="gold">${brl(total)}</b></div></div><p style="color:var(--muted);font-size:.8rem;margin-top:8px">Retirada e pagamento na barbearia.</p>
    <div class="err" id="cErr" role="alert"></div><button class="btn" id="reserve" style="width:100%">Reservar produtos</button>` : '<p class="empty">Carrinho vazio.</p>'}`);
  $$('[data-m]', mBody).forEach((b) => (b.onclick = () => { const id = b.dataset.m; if (--cart[id] <= 0) delete cart[id]; updateCart(); cartModal(); }));
  $$('[data-p]', mBody).forEach((b) => (b.onclick = () => { cart[b.dataset.p]++; updateCart(); cartModal(); }));
  const r = $('#reserve');
  if (r) r.onclick = () => needClient(async () => {
    try {
      await api('POST', '/api/orders', { items: Object.entries(cart).map(([product_id, qty]) => ({ product_id: +product_id, qty })) });
      cart = {}; updateCart(); closeModal(); toast('Reserva feita! Retire na barbearia.'); load();
    } catch (e) { const el = $('#cErr'); if (el) el.textContent = e.message; else toast(e.message, true); }
  });
}

load().catch(() => toast('Falha ao carregar dados', true));
