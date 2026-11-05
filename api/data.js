// Vercel serverless function: checks the password, then talks to Supabase.
// Env vars needed: APP_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SECTIONS = ['electrical', 'water', 'gas', 'certs', 'contacts', 'listed', 'gardening', 'fences', 'meters', 'drainage', 'paths', 'outbuildings'];
const PIN_SECTIONS = ['electrical', 'water', 'gas', 'certs', 'contacts'];
const dd = o => { const x = o && typeof o === 'object' ? o : {}; if (JSON.stringify(x).length > 5000) throw new Error('too big'); return x; };

async function sb(path, method = 'GET', body, prefer) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs (start with "eyJ") and also go in Authorization.
  // New sb_secret_ keys only go in the apikey header.
  if (KEY && KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + KEY;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(URL_ + '/rest/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const up = 'resolution=merge-duplicates,return=minimal';
const enc = encodeURIComponent;
const text = (v, n) => (v == null ? null : String(v).slice(0, n));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.APP_PASSWORD || req.headers['x-pass'] !== process.env.APP_PASSWORD)
    return res.status(401).json({ error: 'auth' });

  const b = req.body || {};
  try {
    switch (b.action) {
      case 'load': {
        const [items, logs, plans] = await Promise.all([
          sb('items?select=*&order=created_at'),
          sb('log_entries?select=*'),
          sb('plans?select=*'),
        ]);
        const out = {};
        SECTIONS.forEach(s => (out[s] = { items: [], log: [], plan: null }));
        items.forEach(i => out[i.section]?.items.push({
          id: i.id, name: i.name, type: i.type, loc: i.location || '', status: i.status,
          tags: i.tags || [], notes: i.notes || '', d: i.details || {},
          x: i.plan_x == null ? null : Number(i.plan_x), y: i.plan_y == null ? null : Number(i.plan_y),
        }));
        logs.forEach(l => out[l.section]?.log.push({
          id: l.id, date: l.log_date, item: l.item_id || '', text: l.entry_text, d: l.details || {},
        }));
        out.master = (plans.find(p => p.section === 'master') || {}).image_data || null;
        return res.json(out);
      }
      case 'upsertItem': {
        const i = b.item || {};
        if (!PIN_SECTIONS.includes(b.section)) throw new Error('bad section');
        await sb('items?on_conflict=id', 'POST', {
          id: text(i.id, 20), section: b.section, name: text(i.name, 150), type: text(i.type, 50),
          location: text(i.loc, 150), status: i.status === 'bad' ? 'bad' : 'ok',
          tags: Array.isArray(i.tags) ? i.tags : [], notes: text(i.notes, 5000),
          plan_x: i.x, plan_y: i.y, details: dd(i.d), updated_at: new Date().toISOString(),
        }, up);
        return res.json({ ok: true });
      }
      case 'deleteItem':
        await sb('items?id=eq.' + enc(b.id), 'DELETE');
        return res.json({ ok: true });
      case 'addLog': {
        const e = b.entry || {};
        if (!SECTIONS.includes(b.section)) throw new Error('bad section');
        await sb('log_entries', 'POST', {
          id: text(e.id, 20), section: b.section, item_id: e.item || null,
          log_date: e.date, entry_text: text(e.text, 5000) || '', details: dd(e.d),
        }, 'return=minimal');
        return res.json({ ok: true });
      }
      case 'deleteLog':
        await sb('log_entries?id=eq.' + enc(b.id), 'DELETE');
        return res.json({ ok: true });
      case 'setPlan':
        await sb('plans?on_conflict=section', 'POST',
          { section: 'master', image_data: b.image, updated_at: new Date().toISOString() }, up);
        return res.json({ ok: true });
      case 'removePlan':
        await sb('plans?section=eq.master', 'DELETE');
        return res.json({ ok: true });
      default:
        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
