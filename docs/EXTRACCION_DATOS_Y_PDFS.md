# Extracción de datos y PDFs — Web Familia 2.0 (GVA)

Implementado en el bridge (`apps/bridge`) sobre la app existente:

1. Login → `listar_alumnos_wf` (+ LOPD)
2. Por alumno: `alumno_datos_wf` / `alumno_matricula_wf` → **Agenda** (`alumno_avisos_wf?tipo=ag`)
3. Avisos con `{ studentId, studentName, date, dateIso, title, hasDetail, detailHref }`
4. Detalle de aviso → descarga PDF; si SharePoint bloquea fetch, **Playwright** (sesión WF + captura `application/pdf` / download)
5. Menús: `pdfjs-dist` posiciones de texto + geometría columnas A1–A5 (`apps/bridge/src/menu-pdf.ts`)
6. Metadatos alumno: NIA, grupo, tutor, curso — **sin** Identitat digital / claves

Endpoints:
- `POST /api/admin/scrape` — rescan completo
- `GET /api/attachments/:id` — PDF capturado
- Dashboard: `notices`, `attachments`, `menus`

Tests: `npm run test:extractors -w @pont/bridge`
