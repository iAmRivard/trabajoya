# Datasets de empleos con Exa + n8n

## Objetivo

Sincronizar vacantes publicas para TrabajoYA sin tocar los workflows existentes.
El flujo inicial usa Exa para descubrir vacantes/listados, n8n para ejecutar la
tarea diaria/manual y el backend de TrabajoYA para normalizar y guardar en
PostgreSQL.

```text
n8n Manual/Cron -> HTTP Exa /search -> Code normalize -> HTTP TrabajoYA API -> PostgreSQL
```

## Fuentes iniciales

```text
Tecoloco
https://www.tecoloco.com.sv/
https://www.tecoloco.com.sv/empleos

Computrabajo El Salvador
https://sv.computrabajo.com/

Ministerio de Trabajo - Oportunidades
https://oportunidades.mtps.gob.sv/job-offers

Bolsa de Trabajo Gobierno de El Salvador
https://bolsadetrabajo.gob.sv/
```

El workflow actual consulta Tecoloco y Computrabajo por areas: ventas/atencion al
cliente, administracion/operaciones, tecnologia/soporte y zonas principales. Para
el portal Oportunidades usa la ruta publica de ofertas laborales.

## Configuracion rapida en n8n

El workflow importable trae un nodo llamado `Configurar llaves`. Para probar sin
reiniciar n8n:

```text
exa_api_key: pegar la API key de Exa
trabajoya_base_url: https://trabajoya.rivasystems.dev
trabajoya_api_key: pegar la API key aceptada por TrabajoYA
```

`trabajoya_api_key` puede ser la `TRABAJOYA_DATASET_API_KEY` o la
`TRABAJOYA_INTAKE_API_KEY`, segun cual este configurada en el deploy de
TrabajoYA.

## Workflow importable

Archivo:

```text
contexto/n8n/trabajoya_jobs_exa_sync.json
```

Incluye:

```text
- Manual Trigger: para actualizar cuando queras.
- Schedule Trigger: diario a las 6 AM.
- Code node Configurar llaves: para prueba rapida desde la UI.
- Code node Preparar busquedas: arma los payloads para Exa.
- HTTP Request Buscar en Exa: consulta Exa sin depender de `fetch`.
- Code node Normalizar empleos: convierte resultados a vacantes candidatas.
- HTTP Request Guardar en TrabajoYA: llama el endpoint del backend.
```

El workflow inicia desactivado para no interferir con otros flujos. Importarlo,
configurar llaves y activarlo cuando este probado.

## Endpoint TrabajoYA

```http
POST /api/datasets/jobs/upsert
X-Trabajoya-Key: <api-key>
Content-Type: application/json
```

Payload:

```json
{
  "source": "tecoloco",
  "sync": {
    "provider": "Tecoloco",
    "query": "empleos El Salvador ventas",
    "ran_at": "2026-07-04T12:00:00.000Z"
  },
  "jobs": [
    {
      "source": "tecoloco",
      "provider": "Tecoloco",
      "title": "Asesor de ventas",
      "company": "Empresa demo",
      "area": "Ventas y atencion al cliente",
      "description": "Texto resumido o highlights de Exa",
      "employment_type": "tiempo completo",
      "modality": "presencial",
      "country": "El Salvador",
      "department": "San Salvador",
      "salary_min": 450,
      "salary_max": 600,
      "currency": "USD",
      "skills": ["Ventas", "Atencion al cliente"],
      "source_url": "https://example.com/vacante-demo",
      "apply_url": "https://example.com/vacante-demo",
      "status": "active"
    }
  ]
}
```

## Verificacion

Con sesion admin:

```http
GET /api/jobs?limit=50
GET /api/jobs?source=tecoloco
GET /api/jobs?source=computrabajo
GET /api/jobs?source=mtps_oportunidades
GET /api/jobs?q=ventas
```

## Siguiente mejora

El primer workflow guarda vacantes candidatas a partir de resultados de Exa. El
siguiente paso es extraer vacantes individuales con mas precision por fuente:

```text
empresa real
salario exacto
fecha de publicacion
fecha limite
ubicacion completa
requisitos
link directo de aplicacion
```
