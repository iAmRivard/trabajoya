# TrabajoYA Client

Cliente local para probar el agente de voz de ElevenLabs.

## Ejecutar

```bash
npm install
npm run dev
```

Abrir la URL local que imprime Vite.

## Ejecutar con dashboard

Mantener abierto el tunel SSH a Postgres:

```bash
ssh -L 15432:127.0.0.1:15432 debian@<ip-del-vps>
```

Configurar la clave de DBeaver en una variable local:

```bash
export PGPASSWORD="la_clave_de_dbeaver"
npm run dev:full
```

Tambien se puede crear `.env.local` desde `.env.example` y llenar
`PGPASSWORD`. Ese archivo queda ignorado por git.

URLs locales:

```text
Interfaz: http://127.0.0.1:5173/
API: http://127.0.0.1:8787/api/health
```

## Registro inicial

La app deployed corre en:

```text
https://trabajoya.rivasystems.dev/
```

Endpoints principales:

```text
POST /api/intakes
GET  /api/intakes/:code
POST /api/intakes/:code/verify
POST /api/candidate-profiles
POST /api/datasets/courses/upsert
POST /api/datasets/jobs/upsert
POST /api/intakes/:code/recommendations
GET  /api/intakes/:code/recommendations/latest
POST /api/intakes/:code/interview-sessions
GET  /api/intakes/:code/interview-sessions/latest
GET  /api/intakes/:code/interview-sessions/:sessionId
POST /api/interview-feedback
POST /api/profiles/:profileId/recommendations
GET  /api/profiles/:profileId/recommendations
GET  /api/courses
GET  /api/jobs
GET  /api/intakes
GET  /api/profiles
```

`POST /api/intakes` recibe telefono salvadoreno, datos iniciales y devuelve
un codigo corto mas URL. Requiere sesion admin o API key server-to-server:

```http
X-Trabajoya-Key: <TRABAJOYA_INTAKE_API_KEY>
```

Tambien puede recibir texto de CV ya extraido:

```json
{
  "phone": "77778888",
  "full_name": "Nombre inicial",
  "municipality": "San Salvador",
  "department": "San Salvador",
  "desired_role": "Atencion al cliente",
  "cv_text": "Texto del CV extraido por WhatsApp o por otro backend",
  "cv_file_name": "cv.pdf",
  "source": "whatsapp"
}
```

La URL del candidato queda en formato:

```text
https://trabajoya.rivasystems.dev/c/CODIGO
```

Cuando el candidato abre la URL, la interfaz carga el registro por codigo,
muestra el progreso de construccion del perfil y permite iniciar la entrevista
sin pedir confirmacion telefonica. Al iniciar, envia al agente el registro
inicial, el `intake_code` y el `cv_text` guardado para que retome ese contexto.

`POST /api/intakes/:code/verify` queda por compatibilidad con versiones
anteriores del flujo.

## Recomendaciones por perfil

El endpoint de recomendaciones busca oportunidades en vivo con Exa, guarda los
resultados encontrados en Postgres y usa OpenAI para rankear solo esos cursos y
empleos reales contra el perfil confirmado.

Para candidato por codigo:

```http
POST /api/intakes/:code/recommendations
Content-Type: application/json
```

Body opcional:

```json
{
  "max_results": 5
}
```

Respuesta resumida:

```json
{
  "ok": true,
  "run_id": "uuid",
  "source": "live",
  "cached": false,
  "summary": "Resumen del match",
  "recommendations": {
    "jobs": [],
    "courses": []
  },
  "profile_gaps": [],
  "search": {
    "live_counts": {
      "jobs": 12,
      "courses": 10
    }
  }
}
```

Si el mismo perfil pide recomendaciones dentro de
`MATCH_MIN_INTERVAL_SECONDS`, se devuelve la ultima corrida con `cached: true`
para evitar gasto accidental. Tambien se puede leer la ultima recomendacion con:

```http
GET /api/intakes/:code/recommendations/latest
```

Endpoints admin, requieren login del panel:

```http
POST /api/profiles/:profileId/recommendations
GET  /api/profiles/:profileId/recommendations
```

Variables requeridas:

```text
EXA_API_KEY=...
OPENAI_API_KEY=...
OPENAI_MATCH_MODEL=gpt-5.4-mini
MATCH_MIN_INTERVAL_SECONDS=60
MATCH_MAX_RESULTS_PER_TYPE=5
EXA_JOB_FRESH_DAYS=45
EXA_JOB_MAX_AGE_HOURS=6
```

Para reducir vacantes vencidas, las busquedas live de empleos limitan resultados
a paginas crawleadas recientemente, recargan contenido fresco de Exa y filtran
textos que indiquen oferta expirada, cerrada o con fecha limite pasada. Si se
necesitan mas resultados se puede subir `EXA_JOB_FRESH_DAYS`; si salen muchas
vacantes viejas conviene bajarlo.

## Simulacion de entrevista

Despues de generar recomendaciones, el candidato puede practicar una entrevista
corta sobre una vacante recomendada. El frontend crea una sesion, inicia el
agente de ElevenLabs de simulacion y luego consulta el feedback guardado.

Crear sesion:

```http
POST /api/intakes/:code/interview-sessions
Content-Type: application/json
```

Body:

```json
{
  "job_id": "uuid",
  "recommendation_run_id": "uuid"
}
```

Respuesta:

```json
{
  "ok": true,
  "session_id": "uuid",
  "agent_id": "agent_xxx",
  "context": {
    "interview_session_id": "uuid",
    "profile_summary": "Resumen para el agente",
    "job_summary": "Vacante elegida"
  }
}
```

Consultar feedback:

```http
GET /api/intakes/:code/interview-sessions/:sessionId
GET /api/intakes/:code/interview-sessions/latest
```

Guardar feedback desde n8n:

```http
POST /api/interview-feedback
X-Trabajoya-Key: <TRABAJOYA_INTERVIEW_API_KEY>
Content-Type: application/json
```

El agente de entrevista llama el webhook n8n:

```text
POST https://n8n.rivasystems.dev/webhook/trabajoya/save-interview-feedback
```

Para crear o actualizar el agente de ElevenLabs desde API:

```bash
ELEVENLABS_API_KEY=... \
TRABAJOYA_INTERVIEW_API_KEY=... \
N8N_INTERVIEW_FEEDBACK_WEBHOOK_URL=https://n8n.rivasystems.dev/webhook/trabajoya/save-interview-feedback \
npm run create:interview-agent
```

El script duplica el agente principal si no se pasa `ELEVENLABS_INTERVIEW_AGENT_ID`.
Si ya existe un agente de entrevista, pasar ese ID para actualizar prompt/tool sin
crear otro:

```bash
ELEVENLABS_INTERVIEW_AGENT_ID=agent_xxx npm run create:interview-agent
```

Variables requeridas:

```text
ELEVENLABS_INTERVIEW_AGENT_ID=...
TRABAJOYA_INTERVIEW_API_KEY=...
N8N_INTERVIEW_FEEDBACK_WEBHOOK_URL=https://n8n.rivasystems.dev/webhook/trabajoya/save-interview-feedback
VOICE_FEEDBACK_API_URL=https://wp-api.rivasystems.dev/api/voice/send
VOICE_FEEDBACK_API_KEY=...
VOICE_FEEDBACK_MAX_CHARS=700
VOICE_FEEDBACK_TIMEOUT_MS=12000
```

Cuando `VOICE_FEEDBACK_API_URL` y `VOICE_FEEDBACK_API_KEY` estan configuradas,
`POST /api/interview-feedback` envia un audio corto al telefono del intake. El
backend resume el feedback a un texto breve antes de llamar el servicio externo.

La UI prepara el microfono con reduccion de ruido del navegador antes de iniciar
la entrevista y avisa si detecta demasiado ruido de fondo. El agente de
entrevista usa turnos mas agiles (`turn_timeout=4`, `turn_eagerness=high`) para
reducir pausas en ambientes con ruido.

## Datasets de cursos

El MVP de cursos usa Exa + n8n para sincronizar fuentes publicas hacia
Postgres:

```text
n8n -> Exa /search -> POST /api/datasets/courses/upsert -> public.courses
```

El workflow importable esta en:

```text
../contexto/n8n/trabajoya_courses_exa_sync.json
```

Documentacion:

```text
../contexto/docs/datasets-cursos-exa-n8n.md
```

`POST /api/datasets/courses/upsert` requiere sesion admin o:

```http
X-Trabajoya-Key: <TRABAJOYA_DATASET_API_KEY o TRABAJOYA_INTAKE_API_KEY>
```

## Datasets de empleos

El MVP de empleos usa Exa + n8n para sincronizar vacantes hacia Postgres:

```text
n8n -> Exa /search -> POST /api/datasets/jobs/upsert -> public.job_vacancies
```

El workflow importable esta en:

```text
../contexto/n8n/trabajoya_jobs_exa_sync.json
```

Documentacion:

```text
../contexto/docs/datasets-empleos-exa-n8n.md
```

`POST /api/datasets/jobs/upsert` requiere sesion admin o:

```http
X-Trabajoya-Key: <TRABAJOYA_DATASET_API_KEY o TRABAJOYA_INTAKE_API_KEY>
```

## Prueba rapida de guardado

Para validar n8n + Postgres sin pasar por toda la conversacion:

```bash
npm run test:webhook
```

Luego refrescar `public.candidate_profiles` en DBeaver y buscar registros con
`source = qa_local_script`.

## CV

La interfaz permite subir archivos `.pdf` y `.txt`.

- PDF con texto seleccionable: extrae texto y paginas.
- PDF escaneado como imagen: muestra error y queda pendiente OCR.
- TXT: extrae el contenido directamente.

Flujo:

```text
Subir CV -> Extraer -> Iniciar conversacion -> Enviar al agente
```

## Configuracion

Por defecto usa:

```text
agent_3101kwq6aq0yfywbc4jyxqevv9zm
```

Para cambiarlo, crear un `.env.local`:

```bash
VITE_ELEVENLABS_AGENT_ID=agent_xxx
```

No guardar API keys en este cliente. Si el agente se vuelve privado, agregar un backend local que entregue signed URLs.

## Deploy

El deploy fullstack usa:

```text
Dockerfile
docker-compose.dokploy.yml
migrations/
```

Desde GitHub, Dokploy puede usar el `docker-compose.yml` que esta en la raiz
del repo. Variables requeridas:

```text
TRABAJOYA_DOMAIN=trabajoya.rivasystems.dev
PUBLIC_APP_URL=https://trabajoya.rivasystems.dev
TRABAJOYA_DB_PASSWORD=...
TRABAJOYA_ADMIN_PASSWORD=...
TRABAJOYA_SESSION_SECRET=...
TRABAJOYA_INTAKE_API_KEY=...
EXA_API_KEY=...
OPENAI_API_KEY=...
```

El script `npm run migrate` aplica todos los archivos `.sql` en
`migrations/` en orden alfabetico. En produccion, aplicarlo con un usuario de
Postgres que tenga permisos de DDL antes de usar nuevos datasets.

En el VPS el compose esta en:

```text
/etc/dokploy/compose/trabajoya-client/code
```
