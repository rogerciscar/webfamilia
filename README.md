# Pont · puente personal a Web Família

Web Família (GVA / ITACA) funciona, pero la UI es hostil. **Pont** es un puente local:

1. inicia sesión en `familia.edu.gva.es` con tu usuario oficial
2. reinterpreta el HTML en JSON limpio
3. te sirve una webapp clara y usable
4. recuerda tu login en este dispositivo: por defecto guarda NIF/contraseña **cifrados en disco** y vuelve a entrar solo al abrir la app

No es un servicio oficial ni está afiliado a la Generalitat Valenciana. Uso personal.

## Arrancar

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Bridge API: http://localhost:8787

En la pantalla inicial puedes:

- **Provar amb dades d'exemple** — UI sin credenciales
- **Entrar amb el meu usuari** — login real contra Web Família

## Deploy a Railway

**Git sí sube a Railway** (se crean deployments), pero los últimos builds estaban en **failure**. Por eso seguías viendo la página vieja de solo API.

1. Abre el proyecto: https://railway.com/project/8ec7ac83-910c-46f7-b325-e5bc0105bbb9
2. En el servicio → **Deployments**: mira el build rojo y los logs (ahí está el error real)
3. Settings importantes:
   - **Root Directory**: vacío / `/` (no `apps/bridge`)
   - **Config as Code**: activado (usa `railway.toml` + `Dockerfile`)
   - Branch: `main`
4. Fuerza **Redeploy** / Command Palette → **Deploy Latest Commit**
5. Cuando esté verde, `/api/health` debe devolver `"web": true`

(Opcional) Volume en `/data` + `PONT_DATA_DIR=/data` para recordar login.

## Cómo funciona

```
[Pont web] → [Pont bridge] → POST login → familia.edu.gva.es
                   ↓
            cookie de sesión + scrape HTML
                   ↓
            parsers (cheerio) → Dashboard JSON
```

Tras el login, el bridge:

- guarda capturas HTML en memoria (`/api/debug/captures`)
- intenta rutas candidatas (`avisos_wf`, `faltas_wf`, `notas_wf`, …)
- parsea tablas/listas de forma tolerante (cada centro puede variar)

Si el HTML real no encaja, abre `/api/debug/captures/:key` y afinamos el parser.

## Recordar login

Hay **dos capas**:

1. **Navegador (localStorage)** — guarda NIF/contraseña en este dispositivo y reentra solo al abrir la web.
2. **Servidor** — vault cifrado en **Postgres** (`DATABASE_URL`) o en disco/volumen.

### Railway (importante)

Sin base de datos ni volumen, Railway **borra el disco en cada deploy**.

En el proyecto Railway:

1. **New → Database → PostgreSQL**
2. En el servicio web, variable:
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
3. Redeploy

Con eso basta (la clave de cifrado se deriva de `DATABASE_URL`).

Comprueba `/api/health`: `"storage":{"backend":"postgres","persistent":true,...}`.

## Seguridad

- Credenciales solo en `apps/bridge/.data/` (gitignored), cifradas
- Clave de dispositivo con permisos 0600; sin cloud, sin analytics, sin terceros
- Si usas contraseña mestra, no la pierdas: sin ella no se pueden leer las credenciales
- La GVA puede cambiar el portal; el puente puede romperse y hay que retocarlo

## Estado

MVP funcional:

- [x] auth bridge + vault cifrado
- [x] recordar login en el dispositivo (auto-entrada)
- [x] dashboard mock
- [x] parsers genéricos + discovery de rutas
- [ ] parsers ajustados a HTML real de tu centro (necesita un login de prueba)
- [ ] notificaciones / polling
- [ ] envío de mensajes al profesorado

## Disclaimer

Herramienta personal de accesibilidad/UX. Respeta las condiciones de uso del portal oficial y la privacidad de los datos escolares.
