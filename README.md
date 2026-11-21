# Rete PR

Gestionale della rete PR (archivio, struttura dello staff, serate, report) su Cloudflare Workers + D1, con accesso tramite Cloudflare Access (PIN via email).

- `public/index.html` — interfaccia
- `src/worker.js` — API e controllo accessi (admin vede tutto; ogni capo staff solo il proprio ramo)
- `build.mjs` — unisce l'interfaccia nel Worker (`dist/worker.js`)
- `schema.sql` — tabelle del database D1

Variabili del Worker: `ADMIN_EMAILS`, `TEAM_DOMAIN`, `POLICY_AUD`.
