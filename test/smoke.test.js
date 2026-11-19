// Teste de fumaça do backend. Uso: node --test test/
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
test.after(() => server.close());

async function call(method, url, body, cookie) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toLocaleDateString('sv-SE'); };

test('fluxo completo: cadastro, plano, agendamento, conclusão, pontos e avaliação', async () => {
  const pub = await call('GET', '/api/public');
  assert.ok(pub.data.services.length >= 5 && pub.data.plans.length >= 3 && pub.data.products.length > 0);

  const reg = await call('POST', '/api/auth/register', { name: 'Teste Cliente', email: 't@t.com', password: 'secret1' });
  assert.equal(reg.status, 200);
  const c = reg.cookie;

  assert.equal((await call('POST', '/api/subscriptions', { plan_id: 3, method: 'pix' }, c)).status, 200);
  assert.equal((await call('POST', '/api/subscriptions', { plan_id: 3, method: 'pix' }, c)).status, 409);

  const date = nextMonday();
  const av = await call('GET', `/api/availability?barber=1&service=1&date=${date}`);
  assert.ok(av.data.slots.length > 0);
  const slot = av.data.slots[0];
  const ap = await call('POST', '/api/appointments', { barber_id: 1, service_id: 1, date, time: slot, use_plan: true }, c);
  assert.equal(ap.status, 200);
  // mesmo horário: conflito
  assert.equal((await call('POST', '/api/appointments', { barber_id: 1, service_id: 1, date, time: slot }, c)).status, 409);

  let ov = await call('GET', '/api/me/overview', null, c);
  assert.equal(ov.data.subscription.cuts_used, 1);

  // cliente não acessa admin
  assert.equal((await call('GET', '/api/admin/dashboard', null, c)).status, 403);

  const login = await call('POST', '/api/auth/login', { email: 'admin@barbearia.com', password: 'admin123' });
  assert.equal(login.status, 200);
  const a = login.cookie;
  assert.equal((await call('POST', `/api/admin/appointments/${ap.data.id}/status`, { status: 'done' }, a)).status, 200);
  await call('POST', `/api/admin/appointments/${ap.data.id}/status`, { status: 'done' }, a); // idempotente nos pontos
  ov = await call('GET', '/api/me/overview', null, c);
  assert.equal(ov.data.points, 10);

  assert.equal((await call('POST', `/api/appointments/${ap.data.id}/review`, { rating: 5, comment: 'Top' }, c)).status, 200);
  assert.equal((await call('POST', `/api/appointments/${ap.data.id}/review`, { rating: 5 }, c)).status, 409);

  // loja
  const o = await call('POST', '/api/orders', { items: [{ product_id: 1, qty: 2 }] }, c);
  assert.equal(o.status, 200);
  assert.equal((await call('POST', '/api/orders', { items: [{ product_id: 1, qty: 999 }] }, c)).status, 400);
  assert.equal((await call('POST', `/api/orders/${o.data.id}/cancel`, null, c)).status, 200);

  // resgate sem pontos suficientes
  assert.equal((await call('POST', '/api/rewards/1/redeem', null, c)).status, 400);
});

test('perfil barbeiro: vê só a própria agenda e não acessa admin nem ações de cliente', async () => {
  const date = nextMonday();
  const cli = await call('POST', '/api/auth/login', { email: 'cliente@barbearia.com', password: 'cliente123' });
  assert.equal(cli.status, 200);
  const slot = (await call('GET', `/api/availability?barber=1&service=1&date=${date}`)).data.slots[1];
  const ap = await call('POST', '/api/appointments', { barber_id: 1, service_id: 1, date, time: slot }, cli.cookie);
  assert.equal(ap.status, 200);

  const b1 = await call('POST', '/api/auth/login', { email: 'rafael@barbearia.com', password: 'barbeiro123' });
  assert.equal(b1.data.role, 'barber');
  const ag = await call('GET', `/api/barber/agenda?date=${date}`, null, b1.cookie);
  assert.ok(ag.data.some((a) => a.id === ap.data.id));

  const b2 = await call('POST', '/api/auth/login', { email: 'bruno@barbearia.com', password: 'barbeiro123' });
  assert.equal((await call('GET', `/api/barber/agenda?date=${date}`, null, b2.cookie)).data.length, 0);
  assert.equal((await call('POST', `/api/barber/appointments/${ap.data.id}/status`, { status: 'done' }, b2.cookie)).status, 404);
  assert.equal((await call('POST', `/api/barber/appointments/${ap.data.id}/status`, { status: 'done' }, b1.cookie)).status, 200);

  assert.equal((await call('GET', '/api/admin/dashboard', null, b1.cookie)).status, 403);
  assert.equal((await call('POST', '/api/orders', { items: [{ product_id: 1, qty: 1 }] }, b1.cookie)).status, 403);
  assert.equal((await call('GET', '/api/barber/summary', null, cli.cookie)).status, 403);
});

test('segurança: sem login 401, origem cruzada 403, entrada inválida 400', async () => {
  assert.equal((await call('GET', '/api/me/overview')).status, 401);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.com' }, body: '{}' });
  assert.equal(res.status, 403);
  assert.equal((await call('POST', '/api/auth/register', { name: 'x', email: 'bad', password: '1' })).status, 400);
});
