# Pont · puente personal a Web Família

Web Família (GVA / ITACA) funciona, pero la UI es hostil. **Pont** es un puente local:

1. inicia sesión en `familia.edu.gva.es` con tu usuario oficial
2. reinterpreta el HTML en JSON limpio
3. te sirve una webapp clara y usable
4. puede guardar tu usuario/contraseña **cifrados en disco** (AES-256-GCM + scrypt) detrás de una contraseña mestra

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

## Seguridad

- Credenciales solo en `.data/vault.json` (gitignored), cifradas
- Sin cloud, sin analytics, sin terceros
- No compartas el vault ni la contraseña mestra
- La GVA puede cambiar el portal; el puente puede romperse y hay que retocarlo

## Estado

MVP funcional:

- [x] auth bridge + vault cifrado
- [x] dashboard mock
- [x] parsers genéricos + discovery de rutas
- [ ] parsers ajustados a HTML real de tu centro (necesita un login de prueba)
- [ ] notificaciones / polling
- [ ] envío de mensajes al profesorado

## Disclaimer

Herramienta personal de accesibilidad/UX. Respeta las condiciones de uso del portal oficial y la privacidad de los datos escolares.
