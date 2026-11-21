// Rete PR — Worker Cloudflare: serve l'app e le API su D1.
// Accesso: Cloudflare Access (PIN via email) davanti al Worker; qui si verifica il token
// e si decide chi è admin (ADMIN_EMAILS) e quale capo staff corrisponde a ogni email (tabella utenti).

const HTML = "__HTML__";
const VER = "__VER__";
const ICONE = "__ICONE__"; // icone dell'app, inline: così restano leggibili anche dietro Cloudflare Access // versione della pagina: se il browser ha una pagina vecchia, la ricarica prima di salvare

const RUOLI = ['staff', 'capo', 'pr'];

// Service worker: nessun dato viene messo in cache, solo una pagina di cortesia quando manca la rete.
const SW = `const V='${'__VER__'}',C='happy-pr-'+V;
const OFF='<!DOCTYPE html><html lang=it><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Happy.PR</title><body style="margin:0;background:#141414;color:#FFF5E6;font:16px/1.5 system-ui;display:grid;place-items:center;height:100vh;text-align:center"><div><p style="font:800 28px system-ui;margin:0 0 8px">HAPPY<span style="color:#FF5A1F">.</span>PR</p><p>Manca la connessione.<br>Riprova quando torni online.</p></div>';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.put('/offline',new Response(OFF,{headers:{'content-type':'text/html; charset=utf-8'}}))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.mode!=='navigate')return;e.respondWith(fetch(e.request).catch(()=>caches.open(C).then(c=>c.match('/offline'))))});`;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (m, s = 400) => json({ error: m }, s);
const SEC = { 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const page = (body, s = 200) => new Response(body, { status: s, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC } });
const msgPage = (t, m) => page(`<!DOCTYPE html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rete PR</title><body style="font:16px system-ui;max-width:520px;margin:15vh auto;padding:0 20px;color:#2a1309"><h1 style="color:#e3301c">${t}</h1><p>${m}</p><p><a href="/cdn-cgi/access/logout">Esci e accedi con un'altra email</a></p></body></html>`, 403);

/* ---------- verifica del token di Cloudflare Access ---------- */
let JWKS = null, JWKS_T = 0;
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
async function chiavi(env) {
  if (JWKS && Date.now() - JWKS_T < 3600e3) return JWKS;
  const r = await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`);
  JWKS = (await r.json()).keys || []; JWKS_T = Date.now(); return JWKS;
}
async function verifica(token, env) {
  const [h, p, s] = (token || '').split('.'); if (!s) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(b64u(h)));
    const pay = JSON.parse(new TextDecoder().decode(b64u(p)));
    const k = (await chiavi(env)).find(x => x.kid === head.kid); if (!k) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: k.kty, n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(h + '.' + p))) return null;
    const aud = Array.isArray(pay.aud) ? pay.aud : [pay.aud];
    if (!aud.includes(env.POLICY_AUD)) return null;
    if (!pay.exp || pay.exp * 1000 < Date.now()) return null;
    if (pay.iss !== `https://${env.TEAM_DOMAIN}`) return null;
    return (pay.email || '').toLowerCase() || null;
  } catch { return null; }
}
async function chiSei(req, env) {
  const url = new URL(req.url);
  // Solo per i test in locale (wrangler dev su localhost): mai attivo sul sito pubblicato.
  if (env.DEV_EMAIL && ['localhost', '127.0.0.1'].includes(url.hostname)) return (req.headers.get('x-dev-email') || env.DEV_EMAIL).toLowerCase();
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return { config: true };
  return verifica(req.headers.get('Cf-Access-Jwt-Assertion'), env);
}

/* ---------- utilità sui dati ---------- */
const euroCent = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const misura = v => v === 'incasso' ? 'incasso' : 'persone';
const etaMin = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 6 && n <= 99 ? n : null; };
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const txt = (v, n = 200) => (v == null ? '' : String(v)).trim().slice(0, n);
async function tutte(env) { return (await env.DB.prepare('SELECT * FROM persone').all()).results; }
function ramo(persone, rootId) {
  const ids = new Set([rootId]); let cambiato = true;
  while (cambiato) { cambiato = false; for (const p of persone) if (p.parent && ids.has(p.parent) && !ids.has(p.id)) { ids.add(p.id); cambiato = true; } }
  return ids;
}
function pulisci(b) {
  const anno = b.anno === '' || b.anno == null ? null : parseInt(b.anno, 10);
  return {
    nome: txt(b.nome, 80), cognome: txt(b.cognome, 80), anno: Number.isFinite(anno) ? anno : null,
    scuola: txt(b.scuola, 120), zona: txt(b.zona, 120), tel: txt(b.tel, 40), note: txt(b.note, 1000),
    ruolo: RUOLI.includes(b.ruolo) ? b.ruolo : 'pr', parent: b.parent ? txt(b.parent, 40) : null,
  };
}
// Regole dell'albero, uguali per tutti
function controllaAlbero(d, id, persone) {
  if (!d.nome && !d.cognome) return 'Serve almeno il nome o il cognome.';
  if (d.anno != null && (d.anno < 1950 || d.anno > 2025)) return 'Anno di nascita non valido.';
  if (d.parent) {
    if (d.parent === id) return 'Una persona non può essere superiore di sé stessa.';
    const par = persone.find(p => p.id === d.parent); if (!par) return 'Superiore non trovato.';
    if (id && ramo(persone, id).has(d.parent)) return 'Non puoi mettere una persona sotto qualcuno del suo stesso ramo.';
    if (d.ruolo === 'staff' && par.ruolo !== 'staff') return 'Un Capo staff può stare solo sotto un altro Capo staff.';
    if (d.ruolo === 'capo' && par.ruolo !== 'staff') return 'Un Capo PR può stare solo sotto un Capo staff.';
    if (d.ruolo === 'pr' && par.ruolo === 'pr') return 'Un PR può stare solo sotto un Capo staff o un Capo PR.';
  }
  if (id) {
    const figli = persone.filter(p => p.parent === id);
    if (d.ruolo === 'pr' && figli.length) return `Ha ${figli.length} persone collegate: spostale prima di farlo diventare PR.`;
    if (d.ruolo === 'capo' && figli.some(f => f.ruolo !== 'pr')) return 'Ha Capi staff o Capi PR sotto di sé: spostali prima.';
  }
  return null;
}

/* ---------- classifica a punti ---------- */
async function impostazioni(env) {
  const rows = (await env.DB.prepare('SELECT * FROM impostazioni').all()).results;
  const o = Object.fromEntries(rows.map(r => [r.chiave, r.valore]));
  return { stagione_inizio: o.stagione_inizio || '2000-01-01', punti_persone: parseInt(o.punti_persone, 10) || 20, punti_euro: parseInt(o.punti_euro, 10) || 500, punti_segno: o.punti_segno != null ? parseInt(o.punti_segno, 10) || 0 : 10 };
}
// Punti interi sui totali della stagione: PR = personali; Capi PR e Capi staff = personali + tutto il gruppo.
// La classifica mostra solo nome e punti (nessun numero di persone, incasso o superiore).
async function classificaPunti(env, me, admin, filtro) {
  const imp = await impostazioni(env);
  const persone = await tutte(env);
  const [serR, locR, risR] = await Promise.all([
    env.DB.prepare('SELECT id, data, loc, fmt FROM serate ORDER BY data, id').all(),
    env.DB.prepare('SELECT id, misura FROM locali').all(),
    env.DB.prepare('SELECT serata_id, persona_id, b, t, e FROM risultati').all()]);
  const incasso = new Set(locR.results.filter(l => l.misura === 'incasso').map(l => l.id));
  const perSerata = {}; for (const r of risR.results) (perSerata[r.serata_id] ||= {})[r.persona_id] = r;
  const val = (s, pid) => { const r = (perSerata[s.id] || {})[pid]; if (!r) return 0; return incasso.has(s.fmt) ? (r.e || 0) : r.b + r.t; };
  const conta = s => s.data >= imp.stagione_inizio && (!filtro || s.loc === filtro || s.fmt === filtro);
  // totali personali della stagione (e del filtro)
  const pers = {}, segni = {};
  for (const s of serR.results) if (conta(s)) for (const r of Object.values(perSerata[s.id] || {})) {
    const o = pers[r.persona_id] ||= { b: 0, t: 0, e: 0 }; o.b += r.b; o.t += r.t; o.e += r.e || 0;
  }
  // "a segno": più del miglior risultato personale nelle 2 serate precedenti dello stesso format
  // (anche fuori stagione, per il confronto); si contano solo le serate della stagione e del filtro
  const gruppi = {}; for (const s of serR.results) (gruppi[s.fmt || ''] ||= []).push(s);
  for (const l of Object.values(gruppi)) l.forEach((s, i) => {
    const prev = l.slice(Math.max(0, i - 2), i);
    if (!conta(s) || !prev.length) return; // la prima serata di un format non conta come andata a segno
    for (const pid of Object.keys(perSerata[s.id] || {})) {
      const v = val(s, pid), best = Math.max(0, ...prev.map(p => val(p, pid)));
      if (v > best) segni[pid] = (segni[pid] || 0) + 1;
    }
  });
  const figli = {}; for (const p of persone) if (p.parent) (figli[p.parent] ||= []).push(p.id);
  const memo = {};
  const team = (id, vis = new Set()) => {
    if (memo[id]) return memo[id]; if (vis.has(id)) return { b: 0, t: 0, e: 0, s: 0 }; vis.add(id);
    const a = { ...(pers[id] || { b: 0, t: 0, e: 0 }), s: segni[id] || 0 };
    for (const c of figli[id] || []) { const v = team(c, vis); a.b += v.b; a.t += v.t; a.e += v.e; a.s += v.s; }
    return memo[id] = a;
  };
  const mio = admin ? null : ramo(persone, me.persona_id);
  const righe = [];
  for (const p of persone) {
    // PR: risultati personali; Capi PR e Capi staff: personali + tutto il gruppo (bonus compresi)
    const v = p.ruolo === 'pr' ? { ...(pers[p.id] || { b: 0, t: 0, e: 0 }), s: segni[p.id] || 0 } : team(p.id);
    const persoTot = v.b + v.t; if (!persoTot && !v.e) continue;
    const punti = Math.floor(persoTot / imp.punti_persone) + Math.floor(v.e / 100 / imp.punti_euro) + v.s * imp.punti_segno;
    const vede = admin || mio.has(p.id);
    const r = { nome: [p.nome, p.cognome].filter(Boolean).join(' ') || 'Senza nome', ruolo: p.ruolo, punti, mio: !admin && vede };
    if (vede) r.id = p.id; // la classifica mostra solo nome e punti
    righe.push(r);
  }
  return { imp, filtro, righe };
}

/* ---------- API ---------- */
async function api(req, env, me, path) {
  const m = req.method, seg = path.split('/').filter(Boolean); // es. ['persone', 'id']
  const admin = me.ruolo === 'admin';
  if (m !== 'GET' && !(req.headers.get('content-type') || '').includes('application/json')) return err('Richiesta non valida', 415);
  if (m !== 'GET' && req.headers.get('x-ver') !== VER) return json({ error: 'Il sito è stato aggiornato: ricarico la pagina, poi riprova.', reload: true }, 409);
  const body = m === 'POST' || m === 'PUT' ? await req.json().catch(() => ({})) : {};

  if (m === 'GET' && seg[0] === 'data') {
    const persone = await tutte(env);
    const [loc, ser, ris] = await Promise.all([
      env.DB.prepare('SELECT * FROM locali').all(), env.DB.prepare('SELECT * FROM serate').all(), env.DB.prepare('SELECT * FROM risultati').all()]);
    const vis = admin ? null : ramo(persone, me.persona_id);
    const mappa = {};
    for (const r of ris.results) if (!vis || vis.has(r.persona_id)) (mappa[r.serata_id] ||= {})[r.persona_id] = { b: r.b, t: r.t, e: r.e || 0 };
    const out = {
      ver: VER, me, persone: vis ? persone.filter(p => vis.has(p.id)) : persone, locali: loc.results,
      serate: ser.results.map(s => ({ ...s, ris: mappa[s.id] || {} })),
    };
    out.imp = await impostazioni(env);
    if (admin) out.utenti = (await env.DB.prepare('SELECT * FROM utenti ORDER BY email').all()).results;
    return json(out);
  }

  if (seg[0] === 'persone') {
    const persone = await tutte(env), id = seg[1] || null;
    const esistente = id ? persone.find(p => p.id === id) : null;
    if (id && !esistente) return err('Persona non trovata', 404);
    const vis = admin ? null : ramo(persone, me.persona_id);
    if (vis && id && !vis.has(id)) return err('Non fa parte del tuo ramo', 403);

    if (m === 'DELETE' && id) {
      if (!admin && id === me.persona_id) return err('Non puoi eliminare te stesso', 403);
      // i collegati passano al superiore della persona eliminata
      await env.DB.batch([
        env.DB.prepare('UPDATE persone SET parent = ? WHERE parent = ?').bind(esistente.parent, id),
        env.DB.prepare('DELETE FROM persone WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM utenti WHERE persona_id = ?').bind(id)]);
      return json({ ok: true });
    }
    if (m === 'POST' || m === 'PUT') {
      if (m === 'PUT' && !id) return err('Manca la persona');
      const d = pulisci(body);
      if (!admin) {
        if (id === me.persona_id) { d.ruolo = esistente.ruolo; d.parent = esistente.parent; } // il capo staff può aggiornare solo i propri dati
        else {
          if (!d.parent || !vis.has(d.parent)) return err('Collega la persona a qualcuno del tuo ramo', 403);
        }
      }
      const e = controllaAlbero(d, id, persone); if (e) return err(e);
      const nid = id || uid(), ora = new Date().toISOString();
      if (id) await env.DB.prepare('UPDATE persone SET nome=?,cognome=?,anno=?,scuola=?,zona=?,tel=?,note=?,ruolo=?,parent=?,aggiornato=? WHERE id=?')
        .bind(d.nome, d.cognome, d.anno, d.scuola, d.zona, d.tel, d.note, d.ruolo, d.parent, ora, id).run();
      else await env.DB.prepare('INSERT INTO persone (id,nome,cognome,anno,scuola,zona,tel,note,ruolo,parent,creato_da,aggiornato) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(nid, d.nome, d.cognome, d.anno, d.scuola, d.zona, d.tel, d.note, d.ruolo, d.parent, me.email, ora).run();
      return json({ ok: true, id: nid });
    }
  }

  if (m === 'GET' && seg[0] === 'punti') return json(await classificaPunti(env, me, admin, new URL(req.url).searchParams.get('f') || ''));

  if (!admin) return err('Solo l\'amministratore può farlo', 403);

  if (seg[0] === 'impostazioni' && m === 'PUT') {
    const ini = txt(body.stagione_inizio, 10), pp = parseInt(body.punti_persone, 10), pe = parseInt(body.punti_euro, 10), ps = parseInt(body.punti_segno, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini)) return err('Data di inizio stagione non valida.');
    if (!(pp >= 1 && pp <= 10000) || !(pe >= 1 && pe <= 1000000)) return err('Le soglie dei punti devono essere numeri maggiori di zero.');
    if (!(ps >= 0 && ps <= 1000)) return err('Il bonus per chi va a segno deve essere un numero da 0 in su.');
    const q = 'INSERT INTO impostazioni (chiave,valore) VALUES (?,?) ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore';
    await env.DB.batch([env.DB.prepare(q).bind('stagione_inizio', ini), env.DB.prepare(q).bind('punti_persone', String(pp)), env.DB.prepare(q).bind('punti_euro', String(pe)), env.DB.prepare(q).bind('punti_segno', String(ps))]);
    return json({ ok: true });
  }

  if (seg[0] === 'locali') {
    if (m === 'POST') {
      const nome = txt(body.nome, 80), tipo = body.tipo === 'format' ? 'format' : 'locale';
      if (!nome) return err('Scrivi il nome.');
      const eta = etaMin(body.eta_min);
      if (tipo === 'format' && eta == null) return err('Indica l\'età minima del format (es. 14).');
      const id = uid();
      await env.DB.prepare('INSERT INTO locali (id,nome,tipo,eta_min,misura) VALUES (?,?,?,?,?)').bind(id, nome, tipo, tipo === 'format' ? eta : null, tipo === 'format' ? misura(body.misura) : null).run();
      return json({ ok: true, id });
    }
    if (m === 'PUT' && seg[1]) {
      const l = await env.DB.prepare('SELECT * FROM locali WHERE id=?').bind(seg[1]).first();
      if (!l) return err('Non trovato', 404);
      const nome = txt(body.nome, 80); if (!nome) return err('Scrivi il nome.');
      const eta = etaMin(body.eta_min);
      if (l.tipo === 'format' && eta == null) return err('Indica l\'età minima del format (es. 14).');
      await env.DB.prepare('UPDATE locali SET nome=?, eta_min=?, misura=? WHERE id=?').bind(nome, l.tipo === 'format' ? eta : null, l.tipo === 'format' ? misura(body.misura) : null, seg[1]).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && seg[1]) {
      const u = await env.DB.prepare('SELECT COUNT(*) n FROM serate WHERE loc=?1 OR fmt=?1').bind(seg[1]).first();
      if (u.n) return err(`Usato in ${u.n} serate: non si può eliminare.`);
      await env.DB.prepare('DELETE FROM locali WHERE id=?').bind(seg[1]).run(); return json({ ok: true });
    }
  }

  if (seg[0] === 'serate') {
    const id = seg[1] || null;
    if (m === 'DELETE' && id) {
      await env.DB.batch([env.DB.prepare('DELETE FROM risultati WHERE serata_id=?').bind(id), env.DB.prepare('DELETE FROM serate WHERE id=?').bind(id)]);
      return json({ ok: true });
    }
    if (m === 'POST' || m === 'PUT') {
      const data = txt(body.data, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return err('Inserisci la data della serata.');
      const sid = id || uid(), st = [];
      st.push(env.DB.prepare('INSERT INTO serate (id,data,nome,loc,fmt) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET data=?2,nome=?3,loc=?4,fmt=?5')
        .bind(sid, data, txt(body.nome, 120), body.loc || null, body.fmt || null));
      st.push(env.DB.prepare('DELETE FROM risultati WHERE serata_id=?').bind(sid));
      for (const [pid, r] of Object.entries(body.ris || {})) {
        const b = Math.max(0, parseInt(r && r.b, 10) || 0), t = Math.max(0, parseInt(r && r.t, 10) || 0), e = Math.max(0, parseInt(r && r.e, 10) || 0); // e = incasso tavoli in centesimi
        if (b >= 1 || t >= 1 || e > 0) st.push(env.DB.prepare('INSERT INTO risultati (serata_id,persona_id,b,t,e) VALUES (?,?,?,?,?)').bind(sid, txt(pid, 40), b, t, e));
      }
      await env.DB.batch(st); return json({ ok: true, id: sid });
    }
  }

  if (seg[0] === 'utenti') {
    if (m === 'POST') {
      const email = txt(body.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Email non valida.');
      const p = await env.DB.prepare('SELECT ruolo FROM persone WHERE id=?').bind(body.persona_id || '').first();
      if (!p || p.ruolo !== 'staff') return err('Scegli un Capo staff.');
      await env.DB.prepare('INSERT INTO utenti (email,ruolo,persona_id) VALUES (?1,\'staff\',?2) ON CONFLICT(email) DO UPDATE SET persona_id=?2').bind(email, body.persona_id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && seg[1]) { await env.DB.prepare('DELETE FROM utenti WHERE email=?').bind(decodeURIComponent(seg[1]).toLowerCase()).run(); return json({ ok: true }); }
  }
  return err('Richiesta non riconosciuta', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const email = await chiSei(req, env);
    if (email && email.config) return msgPage('Configurazione incompleta', 'Mancano TEAM_DOMAIN e POLICY_AUD nelle variabili del Worker.');
    if (!email) return msgPage('Accesso non valido', 'Apri il sito dal link e accedi con la tua email.');
    const admins = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    let me = null;
    if (admins.includes(email)) me = { email, ruolo: 'admin', persona_id: null };
    else {
      const u = await env.DB.prepare('SELECT * FROM utenti WHERE email=?').bind(email).first();
      if (u && u.persona_id) me = { email, ruolo: 'staff', persona_id: u.persona_id };
    }
    const isApi = url.pathname.startsWith('/api/');
    if (!me) return isApi ? err('Non autorizzato', 403) : msgPage('Non sei abilitato', `L'email <b>${email.replace(/[<>&"]/g, '')}</b> non è tra quelle autorizzate. Chiedi all'amministratore di aggiungerti.`);
    if (isApi) {
      try { return await api(req, env, me, url.pathname.slice(5)); }
      catch (e) { return err('Errore del server: ' + (e && e.message || e), 500); }
    }
    if (url.pathname === '/manifest.webmanifest') return new Response(JSON.stringify({
      name: 'Happy.PR', short_name: 'Happy.PR', description: 'Il tool della rete PR di HAPPY.FAM',
      start_url: '/', scope: '/', display: 'standalone', orientation: 'any',
      background_color: '#FFF5E6', theme_color: '#141414', lang: 'it', dir: 'ltr',
      icons: [
        { src: ICONE.i192, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: ICONE.i512, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: ICONE.imask, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [
        { name: 'Report', url: '/#report' },
        { name: 'Classifica a punti', url: '/#punti' },
        { name: 'Serate', url: '/#serate' },
      ],
    }), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-store' } });
    if (url.pathname === '/sw.js') return new Response(SW, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', ...SEC } });
    return page(HTML);
  },
};
