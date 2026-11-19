const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { db, hashPassword, verifyPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

// ---------- Segurança básica ----------
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch {}
      if (host !== req.headers.host) return res.status(403).json({ error: 'Origem inválida' });
    }
  }
  next();
});

const attempts = new Map();
function rateLimit(key, max = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  attempts.set(key, arr);
  return arr.length > max;
}

// ---------- Helpers ----------
const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
};
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = (v) => Number(v);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T00:00:00'));
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const settings = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((r) => [r.key, r.value]));
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrapTx = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'Erro interno' });
  }
};

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));
}
app.use((req, _res, next) => {
  const token = parseCookies(req).sid;
  req.user = null;
  if (token) {
    const row = db.prepare(
      'SELECT u.id,u.name,u.email,u.phone,u.role,u.barber_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?'
    ).get(token, Date.now());
    if (row) req.user = row;
  }
  next();
});
const needAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Faça login' }));
const needAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Acesso restrito' }));
const needBarber = (req, res, next) => (req.user?.role === 'barber' && req.user.barber_id ? next() : res.status(403).json({ error: 'Acesso restrito' }));
const needClient = (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Disponível só para contas de cliente' }));

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = 7 * 24 * 3600 * 1000;
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + ttl);
  res.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl / 1000}`);
}
const points = (uid) => db.prepare('SELECT COALESCE(SUM(points),0) p FROM loyalty WHERE user_id=?').get(uid).p;

// ---------- Auth ----------
app.post('/api/auth/register', wrap((req, res) => {
  const name = str(req.body.name, 100), email = str(req.body.email, 150).toLowerCase(), phone = str(req.body.phone, 30);
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (password.length < 6 || password.length > 100) return res.status(400).json({ error: 'A senha precisa ter de 6 a 100 caracteres' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'E-mail já cadastrado' });
  const r = db.prepare('INSERT INTO users(name,email,phone,pass_hash,role) VALUES(?,?,?,?,?)')
    .run(name, email, phone, hashPassword(password), 'client');
  startSession(res, Number(r.lastInsertRowid));
  res.json({ ok: true, role: 'client' });
}));

app.post('/api/auth/login', wrap((req, res) => {
  const email = str(req.body.email, 150).toLowerCase();
  if (rateLimit(`${req.ip}|${email}`)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !verifyPassword(String(req.body.password || ''), u.pass_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos' });
  startSession(res, u.id);
  res.json({ ok: true, role: u.role });
}));

app.post('/api/auth/logout', wrap((req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
}));
app.get('/api/auth/me', wrap((req, res) => res.json({ user: req.user })));

// ---------- Público ----------
app.get('/api/public', wrap((_req, res) => {
  const { whatsapp, ...pub } = settings();
  res.json({
    settings: { ...pub, whatsapp },
    services: db.prepare('SELECT id,name,description,price,duration,kind FROM services WHERE active=1 ORDER BY id').all(),
    barbers: db.prepare(`SELECT b.id,b.name,b.specialty,
      (SELECT ROUND(AVG(rating),1) FROM reviews WHERE barber_id=b.id) rating,
      (SELECT COUNT(*) FROM reviews WHERE barber_id=b.id) reviews FROM barbers b WHERE b.active=1 ORDER BY b.id`).all(),
    plans: db.prepare('SELECT id,name,description,price,cuts,beards,highlight FROM plans WHERE active=1 ORDER BY price').all(),
    amenities: db.prepare('SELECT id,name,icon,description FROM amenities ORDER BY id').all(),
    products: db.prepare('SELECT id,name,description,icon,price,stock FROM products WHERE active=1 ORDER BY id').all(),
    rewards: db.prepare('SELECT id,name,cost FROM rewards WHERE active=1 ORDER BY cost').all(),
    reviews: db.prepare(`SELECT r.rating,r.comment,r.created_at,u.name client,b.name barber FROM reviews r
      JOIN users u ON u.id=r.user_id JOIN barbers b ON b.id=r.barber_id WHERE r.comment!='' ORDER BY r.id DESC LIMIT 6`).all()
      .map((r) => ({ ...r, client: r.client.split(' ')[0] })),
  });
}));

function freeSlots(barberId, date, duration) {
  const s = settings();
  const dow = new Date(date + 'T12:00:00').getDay();
  if (!s.days.split(',').map(Number).includes(dow)) return [];
  const open = toMin(s.open), close = toMin(s.close);
  const busy = db.prepare("SELECT time,duration FROM appointments WHERE barber_id=? AND date=? AND status IN ('scheduled','confirmed')")
    .all(barberId, date).map((a) => [toMin(a.time), toMin(a.time) + a.duration]);
  const now = new Date();
  const nowMin = date === todayStr() ? now.getHours() * 60 + now.getMinutes() + 15 : -1;
  const out = [];
  for (let t = open; t + duration <= close; t += 30) {
    if (t < nowMin) continue;
    if (busy.some(([b0, b1]) => t < b1 && t + duration > b0)) continue;
    out.push(toTime(t));
  }
  return out;
}
app.get('/api/availability', wrap((req, res) => {
  const barberId = num(req.query.barber), serviceId = num(req.query.service), date = str(req.query.date, 10);
  const svc = db.prepare('SELECT duration FROM services WHERE id=? AND active=1').get(serviceId);
  if (!svc || !isDate(date) || !db.prepare('SELECT 1 FROM barbers WHERE id=? AND active=1').get(barberId))
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  if (date < todayStr()) return res.json({ slots: [] });
  res.json({ slots: freeSlots(barberId, date, svc.duration) });
}));

// ---------- Cliente ----------
function activeSub(userId) {
  return db.prepare(`SELECT s.*, p.name plan_name, p.cuts, p.beards, p.price FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.user_id=? AND s.status='active' AND s.period_end>=? ORDER BY s.id DESC LIMIT 1`).get(userId, todayStr());
}

app.get('/api/me/overview', needAuth, needClient, wrap((req, res) => {
  const uid = req.user.id;
  res.json({
    user: req.user,
    whatsapp: settings().whatsapp,
    subscription: activeSub(uid) || null,
    points: points(uid),
    appointments: db.prepare(`SELECT a.*, sv.name service_name, b.name barber_name,
      (SELECT rating FROM reviews WHERE appointment_id=a.id) rating FROM appointments a
      JOIN services sv ON sv.id=a.service_id JOIN barbers b ON b.id=a.barber_id WHERE a.user_id=? ORDER BY a.date DESC, a.time DESC`).all(uid),
    payments: db.prepare('SELECT * FROM payments WHERE user_id=? ORDER BY id DESC').all(uid),
    orders: db.prepare(`SELECT o.*, (SELECT group_concat(p.name || ' x' || i.qty, ', ') FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id) items
      FROM orders o WHERE o.user_id=? ORDER BY o.id DESC`).all(uid),
    redemptions: db.prepare('SELECT d.*, r.name FROM redemptions d JOIN rewards r ON r.id=d.reward_id WHERE d.user_id=? ORDER BY d.id DESC').all(uid),
    loyalty: db.prepare('SELECT points,reason,created_at FROM loyalty WHERE user_id=? ORDER BY id DESC LIMIT 20').all(uid),
  });
}));

app.put('/api/me/profile', needAuth, wrap((req, res) => {
  const name = str(req.body.name, 100), phone = str(req.body.phone, 30);
  if (name.length < 2) return res.status(400).json({ error: 'Nome inválido' });
  if (req.body.password) {
    const pw = String(req.body.password);
    if (pw.length < 6 || pw.length > 100) return res.status(400).json({ error: 'Senha inválida (6 a 100 caracteres)' });
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(pw), req.user.id);
  }
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, req.user.id);
  res.json({ ok: true });
}));

const creditNeeds = (kind) => ({ cuts: kind === 'cut' || kind === 'combo' ? 1 : 0, beards: kind === 'beard' || kind === 'combo' ? 1 : 0 });

app.post('/api/appointments', needAuth, needClient, wrapTx((req, res) => {
  const barberId = num(req.body.barber_id), serviceId = num(req.body.service_id);
  const date = str(req.body.date, 10), time = str(req.body.time, 5), notes = str(req.body.notes, 300);
  const svc = db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(serviceId);
  if (!svc || !isDate(date) || !isTime(time) || !db.prepare('SELECT 1 FROM barbers WHERE id=? AND active=1').get(barberId))
    throw new HttpError(400, 'Dados inválidos');
  if (date < todayStr()) throw new HttpError(400, 'Data no passado');
  const id = tx(() => {
    if (!freeSlots(barberId, date, svc.duration).includes(time)) throw new HttpError(409, 'Horário indisponível. Escolha outro.');
    let price = svc.price, subId = null;
    if (req.body.use_plan) {
      const sub = activeSub(req.user.id), need = creditNeeds(svc.kind);
      if (!sub || (!need.cuts && !need.beards)) throw new HttpError(400, 'Este serviço não é coberto pelo seu plano');
      if (sub.cuts_used + need.cuts > sub.cuts || sub.beards_used + need.beards > sub.beards)
        throw new HttpError(400, 'Seu plano não tem mais créditos para este serviço neste período');
      db.prepare('UPDATE subscriptions SET cuts_used=cuts_used+?, beards_used=beards_used+? WHERE id=?').run(need.cuts, need.beards, sub.id);
      price = 0; subId = sub.id;
    }
    return Number(db.prepare(`INSERT INTO appointments(user_id,barber_id,service_id,date,time,duration,price,subscription_id,notes)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user.id, barberId, serviceId, date, time, svc.duration, price, subId, notes).lastInsertRowid);
  });
  res.json({ ok: true, id });
}));

function cancelAppointment(appt) {
  tx(() => {
    db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(appt.id);
    if (appt.subscription_id) {
      const svc = db.prepare('SELECT kind FROM services WHERE id=?').get(appt.service_id);
      const need = creditNeeds(svc?.kind);
      db.prepare('UPDATE subscriptions SET cuts_used=MAX(0,cuts_used-?), beards_used=MAX(0,beards_used-?) WHERE id=?')
        .run(need.cuts, need.beards, appt.subscription_id);
    }
  });
}
app.post('/api/appointments/:id/cancel', needAuth, needClient, wrap((req, res) => {
  const a = db.prepare('SELECT * FROM appointments WHERE id=? AND user_id=?').get(num(req.params.id), req.user.id);
  if (!a) return res.status(404).json({ error: 'Agendamento não encontrado' });
  if (!['scheduled', 'confirmed'].includes(a.status)) return res.status(400).json({ error: 'Não é possível cancelar' });
  if (new Date(`${a.date}T${a.time}:00`) - Date.now() < 2 * 3600 * 1000) return res.status(400).json({ error: 'Cancelamento só até 2h antes do horário' });
  cancelAppointment(a);
  res.json({ ok: true });
}));

// Avaliação (só de atendimento concluído, uma por atendimento)
app.post('/api/appointments/:id/review', needAuth, needClient, wrap((req, res) => {
  const a = db.prepare('SELECT * FROM appointments WHERE id=? AND user_id=?').get(num(req.params.id), req.user.id);
  const rating = num(req.body.rating);
  if (!a || a.status !== 'done') return res.status(400).json({ error: 'Só é possível avaliar atendimentos concluídos' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Nota de 1 a 5' });
  if (db.prepare('SELECT 1 FROM reviews WHERE appointment_id=?').get(a.id)) return res.status(409).json({ error: 'Você já avaliou este atendimento' });
  tx(() => {
    db.prepare('INSERT INTO reviews(appointment_id,user_id,barber_id,rating,comment) VALUES(?,?,?,?,?)')
      .run(a.id, req.user.id, a.barber_id, rating, str(req.body.comment, 300));
    db.prepare('INSERT OR IGNORE INTO loyalty(user_id,points,reason,ref) VALUES(?,?,?,?)').run(req.user.id, 5, 'Avaliação enviada', `review:${a.id}`);
  });
  res.json({ ok: true });
}));

// Planos (pagamento simulado)
app.post('/api/subscriptions', needAuth, needClient, wrap((req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(num(req.body.plan_id));
  const method = ['pix', 'cartao'].includes(req.body.method) ? req.body.method : null;
  if (!plan || !method) return res.status(400).json({ error: 'Plano ou forma de pagamento inválidos' });
  const start = new Date(), end = new Date(); end.setDate(end.getDate() + 30);
  try {
    tx(() => {
      if (activeSub(req.user.id)) throw new HttpError(409, 'Você já possui um plano ativo');
      const r = db.prepare('INSERT INTO subscriptions(user_id,plan_id,period_start,period_end) VALUES(?,?,?,?)')
        .run(req.user.id, plan.id, start.toLocaleDateString('sv-SE'), end.toLocaleDateString('sv-SE'));
      db.prepare('INSERT INTO payments(user_id,subscription_id,amount,method,status) VALUES(?,?,?,?,?)')
        .run(req.user.id, Number(r.lastInsertRowid), plan.price, method, 'paid');
    });
  } catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message }); throw e; }
  res.json({ ok: true });
}));
app.post('/api/subscriptions/cancel', needAuth, needClient, wrap((req, res) => {
  const sub = activeSub(req.user.id);
  if (!sub) return res.status(404).json({ error: 'Nenhum plano ativo' });
  db.prepare("UPDATE subscriptions SET status='cancelled' WHERE id=?").run(sub.id);
  res.json({ ok: true });
}));

// Loja: reserva de produtos para retirar/pagar na barbearia
app.post('/api/orders', needAuth, needClient, wrapTx((req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 30) : [];
  if (!items.length) throw new HttpError(400, 'Carrinho vazio');
  const id = tx(() => {
    let total = 0; const lines = [];
    for (const it of items) {
      const qty = Math.floor(num(it.qty));
      const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(num(it.product_id));
      if (!p || !(qty >= 1 && qty <= 20)) throw new HttpError(400, 'Item inválido');
      if (p.stock < qty) throw new HttpError(409, `Estoque insuficiente: ${p.name}`);
      db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(qty, p.id);
      lines.push([p.id, qty, p.price]); total += p.price * qty;
    }
    const oid = Number(db.prepare('INSERT INTO orders(user_id,total) VALUES(?,?)').run(req.user.id, total).lastInsertRowid);
    for (const l of lines) db.prepare('INSERT INTO order_items(order_id,product_id,qty,price) VALUES(?,?,?,?)').run(oid, ...l);
    return oid;
  });
  res.json({ ok: true, id });
}));

function restockOrder(orderId) {
  for (const i of db.prepare('SELECT product_id,qty FROM order_items WHERE order_id=?').all(orderId))
    db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(i.qty, i.product_id);
}
app.post('/api/orders/:id/cancel', needAuth, needClient, wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(num(req.params.id), req.user.id);
  if (!o || o.status !== 'reserved') return res.status(400).json({ error: 'Não é possível cancelar' });
  tx(() => { db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id); restockOrder(o.id); });
  res.json({ ok: true });
}));

// Fidelidade: resgatar recompensa
app.post('/api/rewards/:id/redeem', needAuth, needClient, wrapTx((req, res) => {
  const rw = db.prepare('SELECT * FROM rewards WHERE id=? AND active=1').get(num(req.params.id));
  if (!rw) throw new HttpError(404, 'Recompensa não encontrada');
  tx(() => {
    if (points(req.user.id) < rw.cost) throw new HttpError(400, 'Pontos insuficientes');
    const r = db.prepare('INSERT INTO redemptions(user_id,reward_id,cost) VALUES(?,?,?)').run(req.user.id, rw.id, rw.cost);
    db.prepare('INSERT INTO loyalty(user_id,points,reason,ref) VALUES(?,?,?,?)')
      .run(req.user.id, -rw.cost, `Resgate: ${rw.name}`, `redeem:${Number(r.lastInsertRowid)}`);
  });
  res.json({ ok: true });
}));

function awardVisit(a) { // pontos de fidelidade, uma única vez por atendimento (ref UNIQUE)
  db.prepare('INSERT OR IGNORE INTO loyalty(user_id,points,reason,ref) VALUES(?,?,?,?)')
    .run(a.user_id, num(settings().points_per_visit) || 10, 'Visita concluída', `visit:${a.id}`);
}

// ---------- Barbeiro: só enxerga a própria agenda ----------
const barber = express.Router();
barber.use(needAuth, needBarber);

barber.get('/summary', wrap((req, res) => {
  const bid = req.user.barber_id, t = todayStr();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  res.json({
    barber: one('SELECT id,name,specialty FROM barbers WHERE id=?', bid),
    today: one("SELECT COUNT(*) c FROM appointments WHERE barber_id=? AND date=? AND status IN ('scheduled','confirmed','done')", bid, t).c,
    upcoming: one("SELECT COUNT(*) c FROM appointments WHERE barber_id=? AND date>=? AND status IN ('scheduled','confirmed')", bid, t).c,
    doneMonth: one("SELECT COUNT(*) c FROM appointments WHERE barber_id=? AND status='done' AND substr(date,1,7)=?", bid, t.slice(0, 7)).c,
    avgRating: one('SELECT ROUND(AVG(rating),1) v FROM reviews WHERE barber_id=?', bid).v,
    reviews: db.prepare(`SELECT r.rating,r.comment,r.created_at,u.name client FROM reviews r JOIN users u ON u.id=r.user_id
      WHERE r.barber_id=? ORDER BY r.id DESC LIMIT 20`).all(bid),
  });
}));

barber.get('/agenda', wrap((req, res) => {
  const date = str(req.query.date, 10) || todayStr();
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida' });
  res.json(db.prepare(`SELECT a.id,a.date,a.time,a.duration,a.status,a.notes,a.subscription_id,u.name client_name,u.phone client_phone,sv.name service_name
    FROM appointments a JOIN users u ON u.id=a.user_id JOIN services sv ON sv.id=a.service_id
    WHERE a.barber_id=? AND a.date=? AND a.status!='cancelled' ORDER BY a.time`).all(req.user.barber_id, date));
}));

barber.post('/appointments/:id/status', wrap((req, res) => {
  const status = str(req.body.status, 20);
  if (!['confirmed', 'done', 'no_show'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
  const a = db.prepare('SELECT * FROM appointments WHERE id=? AND barber_id=?').get(num(req.params.id), req.user.barber_id);
  if (!a) return res.status(404).json({ error: 'Agendamento não encontrado' });
  if (a.status === 'cancelled') return res.status(400).json({ error: 'Agendamento cancelado' });
  tx(() => {
    db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, a.id);
    if (status === 'done') awardVisit(a);
  });
  res.json({ ok: true });
}));
app.use('/api/barber', barber);

// ---------- Admin ----------
const admin = express.Router();
admin.use(needAuth, needAdmin);

admin.get('/dashboard', wrap((_req, res) => {
  const today = todayStr(), month = today.slice(0, 7);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  res.json({
    today: one("SELECT COUNT(*) c FROM appointments WHERE date=? AND status IN ('scheduled','confirmed','done')", today).c,
    upcoming: one("SELECT COUNT(*) c FROM appointments WHERE date>=? AND status IN ('scheduled','confirmed')", today).c,
    clients: one("SELECT COUNT(*) c FROM users WHERE role='client'").c,
    subscribers: one("SELECT COUNT(*) c FROM subscriptions WHERE status='active' AND period_end>=?", today).c,
    revenueServices: one("SELECT COALESCE(SUM(price),0) v FROM appointments WHERE status='done' AND substr(date,1,7)=?", month).v,
    revenuePlans: one("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='paid' AND substr(created_at,1,7)=?", month).v,
    revenueProducts: one("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status='delivered' AND substr(created_at,1,7)=?", month).v,
    pendingOrders: one("SELECT COUNT(*) c FROM orders WHERE status='reserved'").c,
    avgRating: one('SELECT ROUND(AVG(rating),1) v FROM reviews').v,
    topServices: db.prepare(`SELECT sv.name, COUNT(*) c FROM appointments a JOIN services sv ON sv.id=a.service_id
      WHERE a.status!='cancelled' GROUP BY sv.id ORDER BY c DESC LIMIT 5`).all(),
    agenda: db.prepare(`SELECT a.id,a.date,a.time,a.status,u.name client,u.phone,sv.name service,b.name barber FROM appointments a
      JOIN users u ON u.id=a.user_id JOIN services sv ON sv.id=a.service_id JOIN barbers b ON b.id=a.barber_id
      WHERE a.date=? AND a.status!='cancelled' ORDER BY a.time`).all(today),
  });
}));

admin.get('/appointments', wrap((req, res) => {
  const date = str(req.query.date, 10), status = str(req.query.status, 20);
  const where = [], params = [];
  if (date) { where.push('a.date=?'); params.push(date); }
  if (status) { where.push('a.status=?'); params.push(status); }
  res.json(db.prepare(`SELECT a.*, u.name client_name, u.phone client_phone, sv.name service_name, b.name barber_name FROM appointments a
    JOIN users u ON u.id=a.user_id JOIN services sv ON sv.id=a.service_id JOIN barbers b ON b.id=a.barber_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.date DESC, a.time DESC LIMIT 300`).all(...params));
}));

admin.post('/appointments/:id/status', wrap((req, res) => {
  const status = str(req.body.status, 20);
  if (!['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
  const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(num(req.params.id));
  if (!a) return res.status(404).json({ error: 'Não encontrado' });
  if (status === 'cancelled' && a.status !== 'cancelled') cancelAppointment(a);
  else if (a.status === 'cancelled') return res.status(400).json({ error: 'Agendamento cancelado não pode ser reaberto' });
  else db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, a.id);
  if (status === 'done') awardVisit(a);
  res.json({ ok: true });
}));

admin.get('/clients', wrap((_req, res) => {
  res.json(db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.created_at,
    (SELECT COUNT(*) FROM appointments WHERE user_id=u.id AND status='done') visits,
    (SELECT COALESCE(SUM(points),0) FROM loyalty WHERE user_id=u.id) points,
    (SELECT p.name FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=u.id AND s.status='active' AND s.period_end>=date('now','localtime') LIMIT 1) plan
    FROM users u WHERE u.role='client' ORDER BY u.id DESC`).all());
}));
admin.get('/subscriptions', wrap((_req, res) => {
  res.json(db.prepare(`SELECT s.*, u.name client_name, p.name plan_name, p.cuts, p.beards FROM subscriptions s
    JOIN users u ON u.id=s.user_id JOIN plans p ON p.id=s.plan_id ORDER BY s.id DESC LIMIT 300`).all());
}));
admin.get('/payments', wrap((_req, res) => {
  res.json(db.prepare('SELECT p.*, u.name client_name FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 300').all());
}));
admin.get('/reviews', wrap((_req, res) => {
  res.json(db.prepare(`SELECT r.*, u.name client_name, b.name barber_name FROM reviews r JOIN users u ON u.id=r.user_id
    JOIN barbers b ON b.id=r.barber_id ORDER BY r.id DESC LIMIT 200`).all());
}));

admin.get('/orders', wrap((_req, res) => {
  res.json(db.prepare(`SELECT o.*, u.name client_name, u.phone client_phone,
    (SELECT group_concat(p.name || ' x' || i.qty, ', ') FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id) items
    FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 200`).all());
}));
admin.post('/orders/:id/status', wrap((req, res) => {
  const status = str(req.body.status, 20);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(num(req.params.id));
  if (!o || !['delivered', 'cancelled'].includes(status) || o.status !== 'reserved') return res.status(400).json({ error: 'Operação inválida' });
  tx(() => { db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, o.id); if (status === 'cancelled') restockOrder(o.id); });
  res.json({ ok: true });
}));

admin.get('/redemptions', wrap((_req, res) => {
  res.json(db.prepare(`SELECT d.*, r.name reward_name, u.name client_name FROM redemptions d JOIN rewards r ON r.id=d.reward_id
    JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 200`).all());
}));
admin.post('/redemptions/:id/use', wrap((req, res) => {
  const r = db.prepare("UPDATE redemptions SET status='used' WHERE id=? AND status='open'").run(num(req.params.id));
  res.json({ ok: r.changes > 0 });
}));

// Contas de login dos barbeiros (criadas pelo admin)
admin.get('/barber-accounts', wrap((_req, res) => {
  res.json(db.prepare("SELECT id,email,barber_id FROM users WHERE role='barber'").all());
}));
admin.put('/barbers/:id/account', wrap((req, res) => {
  const bid = num(req.params.id), email = str(req.body.email, 150).toLowerCase(), password = String(req.body.password || '');
  const b = db.prepare('SELECT * FROM barbers WHERE id=?').get(bid);
  if (!b) return res.status(404).json({ error: 'Barbeiro não encontrado' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (password && (password.length < 6 || password.length > 100)) return res.status(400).json({ error: 'Senha de 6 a 100 caracteres' });
  const acc = db.prepare("SELECT * FROM users WHERE role='barber' AND barber_id=?").get(bid);
  const other = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (other && (!acc || other.id !== acc.id)) return res.status(409).json({ error: 'E-mail já em uso' });
  if (acc) {
    db.prepare('UPDATE users SET email=?, name=? WHERE id=?').run(email, b.name, acc.id);
    if (password) { db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(password), acc.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(acc.id); }
  } else {
    if (!password) return res.status(400).json({ error: 'Defina uma senha para criar a conta' });
    db.prepare('INSERT INTO users(name,email,phone,pass_hash,role,barber_id) VALUES(?,?,?,?,?,?)').run(b.name, email, '', hashPassword(password), 'barber', bid);
  }
  res.json({ ok: true });
}));

const entities = {
  services: { table: 'services', fields: { name: 's', description: 's', price: 'n', duration: 'n', kind: 'k', active: 'b' } },
  barbers: { table: 'barbers', fields: { name: 's', specialty: 's', active: 'b' } },
  plans: { table: 'plans', fields: { name: 's', description: 's', price: 'n', cuts: 'n', beards: 'n', highlight: 'b', active: 'b' } },
  amenities: { table: 'amenities', fields: { name: 's', icon: 's', description: 's' } },
  products: { table: 'products', fields: { name: 's', description: 's', icon: 's', price: 'n', stock: 'n', active: 'b' } },
  rewards: { table: 'rewards', fields: { name: 's', cost: 'n', active: 'b' } },
};
function clean(def, body) {
  const out = {};
  for (const [k, t] of Object.entries(def.fields)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (t === 's') out[k] = str(v, 300);
    else if (t === 'n') { const n = Number(v); if (!isFinite(n) || n < 0 || n > 100000) throw new Error(`Valor inválido: ${k}`); out[k] = n; }
    else if (t === 'b') out[k] = v ? 1 : 0;
    else if (t === 'k') { if (!['cut', 'beard', 'combo', 'other'].includes(v)) throw new Error('Tipo inválido'); out[k] = v; }
  }
  return out;
}
for (const [route, def] of Object.entries(entities)) {
  admin.get(`/${route}`, wrap((_req, res) => res.json(db.prepare(`SELECT * FROM ${def.table} ORDER BY id`).all())));
  admin.post(`/${route}`, wrap((req, res) => {
    let d; try { d = clean(def, req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!d.name) return res.status(400).json({ error: 'Nome obrigatório' });
    const keys = Object.keys(d);
    const r = db.prepare(`INSERT INTO ${def.table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map((k) => d[k]));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  }));
  admin.put(`/${route}/:id`, wrap((req, res) => {
    let d; try { d = clean(def, req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    const keys = Object.keys(d);
    if (!keys.length) return res.status(400).json({ error: 'Nada a atualizar' });
    db.prepare(`UPDATE ${def.table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => d[k]), num(req.params.id));
    res.json({ ok: true });
  }));
  admin.delete(`/${route}/:id`, wrap((req, res) => {
    try { db.prepare(`DELETE FROM ${def.table} WHERE id=?`).run(num(req.params.id)); res.json({ ok: true }); }
    catch {
      if ('active' in def.fields) { db.prepare(`UPDATE ${def.table} SET active=0 WHERE id=?`).run(num(req.params.id)); res.json({ ok: true, deactivated: true }); }
      else res.status(409).json({ error: 'Item em uso' });
    }
  }));
}

admin.get('/settings', wrap((_req, res) => res.json(settings())));
admin.put('/settings', wrap((req, res) => {
  const b = req.body, up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  if (b.open !== undefined && (!isTime(b.open) || !isTime(b.close) || toMin(b.open) >= toMin(b.close))) return res.status(400).json({ error: 'Horário inválido' });
  if (b.days !== undefined && !/^[0-6](,[0-6])*$/.test(b.days)) return res.status(400).json({ error: 'Dias inválidos' });
  if (b.whatsapp !== undefined && !/^\d{10,15}$/.test(b.whatsapp)) return res.status(400).json({ error: 'WhatsApp: use só dígitos com DDI (ex.: 5511999999999)' });
  if (b.points_per_visit !== undefined && !(Number.isInteger(+b.points_per_visit) && +b.points_per_visit >= 0 && +b.points_per_visit <= 1000)) return res.status(400).json({ error: 'Pontos inválidos' });
  for (const k of ['open', 'close', 'days', 'whatsapp', 'points_per_visit']) if (b[k] !== undefined) up.run(k, String(b[k]));
  for (const k of ['shop_name', 'address', 'phone']) if (b[k] !== undefined) up.run(k, str(b[k], 150));
  res.json({ ok: true });
}));
app.use('/api/admin', admin);

// ---------- Páginas ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Não encontrado' }));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Barbearia rodando em http://localhost:${PORT}`));
}
module.exports = app;
