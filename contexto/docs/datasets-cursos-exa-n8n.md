# Datasets de cursos con Exa + n8n

## Objetivo

Sincronizar cursos publicos para TrabajoYA sin tocar el workflow existente de
ElevenLabs. El flujo inicial usa Exa para encontrar paginas, n8n para ejecutar
la tarea diaria/manual y el backend de TrabajoYA para normalizar y guardar en
PostgreSQL.

```text
n8n Manual/Cron -> Exa /search -> n8n Code normalize -> TrabajoYA API -> PostgreSQL
```

## Fuentes iniciales

```text
INCAF
https://www.incaf.gob.sv/listado-formacion-disponible/

Platzi / Gobierno de El Salvador
https://diaspora.certificate.gob.sv/
https://platzi.com/blog/el-salvador/
```

## Variables para n8n

No guardar llaves en GitHub. Configurar en el contenedor/proyecto de n8n:

```text
EXA_API_KEY=...
TRABAJOYA_BASE_URL=https://trabajoya.rivasystems.dev
TRABAJOYA_INTAKE_API_KEY=...
```

Tambien puede usarse `TRABAJOYA_DATASET_API_KEY`; el workflow revisa esa
variable si no existe `TRABAJOYA_INTAKE_API_KEY`.

## Workflow importable

Archivo:

```text
contexto/n8n/trabajoya_courses_exa_sync.json
```

Incluye:

```text
- Manual Trigger: para actualizar cuando queras.
- Schedule Trigger: diario a las 5 AM.
- Code node: consulta Exa, normaliza resultados y llama TrabajoYA.
```

El workflow inicia desactivado para no interferir con otros flujos. Importarlo,
configurar variables y activarlo cuando este probado.

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
GET /api/courses?source=platzi_gob_sv
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
