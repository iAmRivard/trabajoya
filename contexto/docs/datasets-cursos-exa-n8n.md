# Datasets de cursos con Exa + n8n

## Objetivo

Sincronizar cursos publicos para TrabajoYA sin tocar el workflow existente de
ElevenLabs. El flujo inicial usa Exa para encontrar paginas, n8n para ejecutar
la tarea diaria/manual y el backend de TrabajoYA para normalizar y guardar en
PostgreSQL.

```text
n8n Manual/Cron -> HTTP Exa /search -> Code normalize -> HTTP TrabajoYA API -> PostgreSQL
```

## Fuentes iniciales

```text
INCAF
https://www.incaf.gob.sv/listado-formacion-disponible/

Platzi catalogo general
https://platzi.com/cursos/

El workflow consulta Platzi por varias areas: programacion, datos/IA,
marketing/negocios, ingles/habilidades profesionales y herramientas de oficina.
```

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
TrabajoYA. Si se dejan los valores `PEGAR_...`, el workflow falla a proposito
para no ejecutar sin credenciales.

## Variables para produccion

Para no guardar llaves dentro del workflow de n8n, configurar en el
contenedor/proyecto de n8n y reiniciar el servicio:

```text
EXA_API_KEY=...
TRABAJOYA_BASE_URL=https://trabajoya.rivasystems.dev
TRABAJOYA_INTAKE_API_KEY=...
```

Tambien puede usarse `TRABAJOYA_DATASET_API_KEY`.

## Workflow importable

Archivo:

```text
contexto/n8n/trabajoya_courses_exa_sync.json
```

Incluye:

```text
- Manual Trigger: para actualizar cuando queras.
- Schedule Trigger: diario a las 5 AM.
- Code node Configurar llaves: para prueba rapida desde la UI.
- Code node Preparar busquedas: arma los payloads para Exa.
- HTTP Request Buscar en Exa: consulta Exa sin depender de `fetch`.
- Code node Normalizar cursos: convierte resultados a cursos candidatos.
- HTTP Request Guardar en TrabajoYA: llama el endpoint del backend.
```

El workflow inicia desactivado para no interferir con otros flujos. Importarlo,
configurar llaves y activarlo cuando este probado.

## Endpoint TrabajoYA

```http
POST /api/datasets/courses/upsert
X-Trabajoya-Key: <api-key>
Content-Type: application/json
```

Payload:

```json
{
  "source": "incaf",
  "sync": {
    "provider": "INCAF",
    "query": "cursos formacion disponible El Salvador INCAF",
    "ran_at": "2026-07-04T12:00:00.000Z"
  },
  "courses": [
    {
      "source": "incaf",
      "provider": "INCAF",
      "title": "Formacion disponible - INCAF",
      "area": "Formacion tecnica",
      "description": "Texto resumido o highlights de Exa",
      "modality": "mixta",
      "country": "El Salvador",
      "is_free": true,
      "cost": 0,
      "currency": "USD",
      "skills": ["Atencion al cliente"],
      "target_roles": ["Auxiliar de tienda"],
      "source_url": "https://www.incaf.gob.sv/listado-formacion-disponible/",
      "status": "active",
      "raw": {}
    }
  ]
}
```

## Verificacion

Con sesion admin:

```http
GET /api/courses?limit=50
GET /api/courses?source=incaf
GET /api/courses?source=platzi
```

## Siguiente mejora

El primer workflow guarda paginas/resultados como cursos candidatos. Cuando ya
tengamos fuentes estables, el siguiente paso es extraer cursos individuales de
cada pagina con una normalizacion mas fina:

```text
titulo real del curso
duracion
fecha de inicio
modalidad
inscripcion
categoria
habilidades
```
