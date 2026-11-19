const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'barbearia.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  phone TEXT, pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'client',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
  price REAL NOT NULL, duration INTEGER NOT NULL DEFAULT 30,
  kind TEXT NOT NULL DEFAULT 'other', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS barbers(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, specialty TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS plans(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
  price REAL NOT NULL, cuts INTEGER NOT NULL DEFAULT 0, beards INTEGER NOT NULL DEFAULT 0,
  highlight INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subscriptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id), status TEXT NOT NULL DEFAULT 'active',
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  cuts_used INTEGER NOT NULL DEFAULT 0, beards_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
  subscription_id INTEGER, amount REAL NOT NULL, method TEXT, status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS appointments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
  barber_id INTEGER NOT NULL REFERENCES barbers(id), service_id INTEGER NOT NULL REFERENCES services(id),
  date TEXT NOT NULL, time TEXT NOT NULL, duration INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', price REAL NOT NULL DEFAULT 0,
  subscription_id INTEGER, notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_appt_day ON appointments(date, barber_id);
CREATE TABLE IF NOT EXISTS amenities(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT DEFAULT '✦', description TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', icon TEXT DEFAULT '🧴',
  price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL, price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT, appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id),
  user_id INTEGER NOT NULL REFERENCES users(id), barber_id INTEGER NOT NULL REFERENCES barbers(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS loyalty(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), points INTEGER NOT NULL,
  reason TEXT NOT NULL, ref TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS rewards(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cost INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS redemptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), reward_id INTEGER NOT NULL REFERENCES rewards(id),
  cost INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@barbearia.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users(name,email,phone,pass_hash,role) VALUES(?,?,?,?,?)')
    .run('Administrador', adminEmail, '', hashPassword(adminPass), 'admin');

  const s = db.prepare('INSERT INTO services(name,description,price,duration,kind) VALUES(?,?,?,?,?)');
  s.run('Corte Clássico', 'Tesoura e máquina, acabamento na navalha e finalização com pomada.', 50, 30, 'cut');
  s.run('Corte Degradê', 'Degradê perfeito (fade) com acabamento detalhado.', 60, 45, 'cut');
  s.run('Barba Completa', 'Toalha quente, óleo, navalha e hidratação.', 40, 30, 'beard');
  s.run('Corte + Barba', 'O combo completo para sair renovado.', 85, 60, 'combo');
  s.run('Sobrancelha', 'Design na navalha ou pinça.', 20, 15, 'other');
  s.run('Pezinho / Acabamento', 'Contorno e acabamento rápido.', 20, 15, 'other');
  s.run('Hidratação Capilar', 'Tratamento para fios e couro cabeludo.', 45, 30, 'other');
  s.run('Pigmentação / Luzes', 'Coloração e camuflagem de fios brancos.', 90, 60, 'other');

  const b = db.prepare('INSERT INTO barbers(name,specialty) VALUES(?,?)');
  b.run('Rafael Souza', 'Degradê e cortes modernos');
  b.run('Bruno Lima', 'Barba e navalha');
  b.run('Diego Alves', 'Cortes clássicos');

  const p = db.prepare('INSERT INTO plans(name,description,price,cuts,beards,highlight) VALUES(?,?,?,?,?,?)');
  p.run('Plano Corte', '4 cortes por mês, ideal para manter o visual em dia.', 149.9, 4, 0, 0);
  p.run('Plano Barba', '4 barbas por mês com toalha quente.', 119.9, 0, 4, 0);
  p.run('Plano Completo', '4 cortes + 4 barbas por mês. O melhor custo-benefício.', 229.9, 4, 4, 1);
  p.run('Plano VIP', 'Cortes e barbas ilimitados* (até 8 de cada por mês).', 349.9, 8, 8, 0);

  const a = db.prepare('INSERT INTO amenities(name,icon,description) VALUES(?,?,?)');
  a.run('Wi-Fi grátis', '📶', 'Internet rápida enquanto você espera.');
  a.run('Cerveja e café', '🍺', 'Bebidas geladas e café na casa.');
  a.run('Ar-condicionado', '❄️', 'Ambiente climatizado e confortável.');
  a.run('Estacionamento', '🅿️', 'Vagas para clientes.');
  a.run('Videogame / TV', '🎮', 'Diversão na sala de espera.');
  a.run('Cartão e Pix', '💳', 'Todas as formas de pagamento.');

  const pr = db.prepare('INSERT INTO products(name,description,icon,price,stock) VALUES(?,?,?,?,?)');
  pr.run('Pomada Modeladora', 'Fixação forte, acabamento fosco. 120g.', '🧴', 39.9, 25);
  pr.run('Óleo para Barba', 'Hidrata e dá brilho. 30ml.', '💧', 44.9, 20);
  pr.run('Shampoo Anticaspa', 'Limpeza profunda do couro cabeludo. 250ml.', '🧼', 34.9, 18);
  pr.run('Balm Pós-Barba', 'Acalma e hidrata a pele após a navalha.', '🌿', 37.9, 15);
  pr.run('Pente de Madeira', 'Pente artesanal antiestático.', '🪮', 24.9, 30);
  pr.run('Kit Barba Completo', 'Óleo + balm + pente em caixa presente.', '🎁', 109.9, 8);

  const rw = db.prepare('INSERT INTO rewards(name,cost) VALUES(?,?)');
  rw.run('Sobrancelha grátis', 100);
  rw.run('Desconto de R$ 20 em qualquer serviço', 200);
  rw.run('Corte grátis', 400);

  const st = db.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
  st.run('whatsapp', '5511999999999'); st.run('points_per_visit', '10');
  st.run('open', '09:00'); st.run('close', '19:00');
  st.run('days', '1,2,3,4,5,6'); // 0=domingo
  st.run('shop_name', 'Barbearia Navalha de Ouro');
  st.run('address', 'Rua das Tesouras, 123 - Centro');
  st.run('phone', '(11) 99999-9999');
}
seed();
try { db.exec('ALTER TABLE users ADD COLUMN barber_id INTEGER REFERENCES barbers(id)'); } catch { /* coluna já existe */ }

// Contas de demonstração (idempotente). Desative com SEED_DEMO=0 em produção.
function seedDemo() {
  if (process.env.SEED_DEMO === '0') return;
  const has = db.prepare('SELECT 1 FROM users WHERE email=?');
  const ins = db.prepare('INSERT INTO users(name,email,phone,pass_hash,role,barber_id) VALUES(?,?,?,?,?,?)');
  if (!has.get('cliente@barbearia.com')) ins.run('Cliente Demo', 'cliente@barbearia.com', '11988887777', hashPassword('cliente123'), 'client', null);
  const emails = { 'Rafael Souza': 'rafael@barbearia.com', 'Bruno Lima': 'bruno@barbearia.com', 'Diego Alves': 'diego@barbearia.com' };
  for (const [name, email] of Object.entries(emails)) {
    const b = db.prepare('SELECT id FROM barbers WHERE name=?').get(name);
    if (b && !has.get(email)) ins.run(name, email, '', hashPassword('barbeiro123'), 'barber', b.id);
  }
}
seedDemo();

module.exports = { db, hashPassword, verifyPassword };
