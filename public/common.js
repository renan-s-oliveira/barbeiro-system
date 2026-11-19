// Funções compartilhadas. Todo texto vindo do servidor passa por esc() antes de entrar no HTML.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const STATUS = { scheduled: 'Agendado', confirmed: 'Confirmado', done: 'Concluído', cancelled: 'Cancelado', no_show: 'Não compareceu',
  reserved: 'Reservado', delivered: 'Entregue', paid: 'Pago', active: 'Ativo', open: 'Disponível', used: 'Usado' };
const stBadge = (s) => `<span class="st ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Erro'); e.status = res.status; throw e; }
  return data;
}
function toast(msg, bad) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.className = bad ? 'bad show' : 'show';
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), 3200);
}
const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(e.message, true); return false; } };

// WhatsApp: monta link wa.me (número só com dígitos; assume Brasil se vier sem DDI)
function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length <= 11 ? '55' + d : d;
}
const waLink = (phone, text) => {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : '';
};
const today = () => new Date().toLocaleDateString('sv-SE');
