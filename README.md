# WebFamilia · capa clara sobre Web Família

Web Família (GVA / ITACA) funciona, pero la UI es hostil. **WebFamilia** es una capa local:

1. el **servidor** inicia sesión en `familia.edu.gva.es` (login en la app o `WF_USER`/`WF_PASS`)
2. scrapea **cada alumno** (agenda, horarios, materias, faltes, PDFs/menús)
3. te sirve una webapp clara; al cambiar de hijo/a filtra **toda** la info
4. cada navegador debe **iniciar sesión** (cookie httpOnly); ya no hay auto-entrada anónima

No es un servicio oficial ni está afiliado a la Generalitat Valenciana. Uso personal.

## Arrancar

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Bridge API: http://localhost:8787

## Variables Railway (recomendadas)

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Vault persistente (Postgres) |
| `WF_USER` / `WF_PASS` | Login automático del bridge al arrancar + rescrape periódico |
| `PONT_SCRAPE_MINUTES` | Minutos entre rescrapes (default `45`; `0` = solo boot) |
| `PONT_ALLOW_MOCK` | `0` en prod (default si Railway); `1` para permitir ejemplo |
| `PONT_VAULT_SECRET` | Secreto de cifrado del vault (si no, se deriva de `DATABASE_URL`) |
| `PONT_SESSION_DAYS` | Duración cookie de sesión del navegador (default **365**, se renueva al usar) |

Con `WF_USER`/`WF_PASS` el servidor scrapea solo; **ver** los datos sigue exigiendo login en ese navegador.

## Deploy a Railway

1. Proyecto → servicio → branch `main` (o merge del PR)
2. Variables: al menos `DATABASE_URL`, y opcionalmente `WF_USER`/`WF_PASS`
3. Redeploy → `/api/health` con `"web": true`
4. Entra con NIF/contraseña → **Admin → Rescanejar** la primera vez

## Seguridad

- Cookie de sesión httpOnly tras login/unlock (no se abre desde otro terminal sin contraseña)
- Vault “device” ya **no** desbloquea sin la contraseña de Web Família
- Mock desactivado en Railway salvo `PONT_ALLOW_MOCK=1`
- Endpoints `/api/dashboard`, admin, attachments y debug exigen sesión
- El navegador solo recuerda el **usuario** (no la contraseña en claro)

## Cómo funciona

```
[Web] ──login──► [Bridge] ──WF cookies──► familia.edu.gva.es
                     │
                     ├── scrape cada alumno_*_wf
                     ├── PDFs agenda (Playwright/SharePoint) → menús (pdfjs)
                     └── Dashboard JSON etiquetado por studentId
```

## Estado

- [x] scrape por alumno + filtro UI
- [x] sesión por navegador + scrape server con env
- [x] menús en pestaña propia
- [x] parsers faltes ampliados
- [ ] notificaciones push
- [ ] envío de mensajes al profesorado
