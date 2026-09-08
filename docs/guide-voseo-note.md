# Guía — decisión de voseo (issue #197)

**Fecha:** 2026-09-08  
**Contexto:** #197 — Publicar "Por dónde empezar"

## Decisión

- **Contenido educativo (`/guia/*`, `/guide/*`, Centro de ayuda):** usa **tuteo** (`tú`) de forma deliberada para mantener neutralidad regional. El español neutro maximiza comprensión entre Nicaragua, México, Argentina, etc. y evita fricción con lectores que no usan `vos`.

- **Correos transaccionales (invitaciones, recordatorios):** usan **voseo nicaragüense** (`vos`) por cercanía y tono personal. El correo es 1:1 y el público primario durante la beta son hogares nicaragüenses; `vos` genera confianza local.

## Consistencia

- Cada pieza es internamente consistente: no se mezclan `tú` y `vos` dentro del mismo artículo o del mismo correo.
- La guía `por-donde-empezar.md` cierra con una nota explícita: _"esta guía usa **tú** (tuteo) de forma deliberada..."_ para documentar la elección donde el usuario la ve.

## Referencias

- Artículo: `src/content/guide/es/por-donde-empezar.md` (tuteo, neutralidad regional).
- Email invitaciones: `src/lib/...` / Supabase Resend templates (voseo, cercanía local).
- Issue #197: settle the voseo question — documented here y en la guía misma.

## Mantenimiento

Si se añade portugués o nuevas guías, mantener el mismo criterio: guías educativas neutras, comunicaciones transaccionales localizadas.
