# TrabajoYA

TrabajoYA es una app fullstack para crear registros iniciales de candidatos,
generar un codigo unico y completar el perfil con un agente de voz de
ElevenLabs.

## Estructura

```text
trabajoya-client/        App web, backend Express y migraciones
contexto/                Notas tecnicas, esquema SQL y contexto del proyecto
docker-compose.yml       Compose para deploy en Dokploy desde GitHub
```

## Flujo principal

1. Un operador crea un registro inicial con telefono y datos basicos.
2. Opcionalmente se incluye texto de CV o perfil previo en `cv_text`.
3. El backend genera un codigo corto y una URL publica.
4. El candidato abre la URL y arranca la conversacion sin volver a confirmar telefono.
5. El agente recibe el contexto del registro y el CV previo, si existe.
6. El tool de ElevenLabs guarda el perfil final en Postgres y lo enlaza al
   registro inicial.
7. Con el perfil confirmado, el backend puede buscar cursos y empleos en vivo
   con Exa y usar OpenAI para rankear recomendaciones reales.
8. El candidato puede practicar una entrevista corta sobre una vacante
   recomendada; el feedback queda guardado en Postgres.
9. Al guardar feedback de entrevista, el backend puede enviar un resumen corto
   por audio al telefono registrado.

## Desarrollo local

```bash
cd trabajoya-client
npm install
cp .env.example .env.local
npm run dev:full
```

La interfaz queda en `http://127.0.0.1:5173/` y la API en
`http://127.0.0.1:8787/api/health`.

## Deploy en Dokploy

Este repo incluye un `docker-compose.yml` en la raiz para que Dokploy pueda
desplegarlo directo desde GitHub.

Variables requeridas en Dokploy:

```text
TRABAJOYA_DOMAIN=trabajoya.rivasystems.dev
PUBLIC_APP_URL=https://trabajoya.rivasystems.dev
VITE_TRABAJOYA_WHATSAPP_NUMBER=50370000000
VITE_TRABAJOYA_WHATSAPP_MESSAGE=Hola TrabajoYA, quiero iniciar mi perfil laboral.
TRABAJOYA_DB_PASSWORD=...
TRABAJOYA_ADMIN_PASSWORD=...
TRABAJOYA_SESSION_SECRET=...
TRABAJOYA_INTAKE_API_KEY=...
EXA_API_KEY=...
OPENAI_API_KEY=...
ELEVENLABS_INTERVIEW_AGENT_ID=...
TRABAJOYA_INTERVIEW_API_KEY=...
VOICE_FEEDBACK_API_URL=https://wp-api.rivasystems.dev/api/voice/send
VOICE_FEEDBACK_API_KEY=...
VOICE_FEEDBACK_MAX_CHARS=700
```

El compose espera que existan estas redes externas en el VPS:

```text
dokploy-network
n8n-n8nwithpostgres-wpwp8h
```

Tambien espera que Postgres sea alcanzable dentro de la red de n8n con el host
`postgres`, base `trabajoya` y usuario `trabajoya_dbeaver`.

## Migraciones

```bash
cd trabajoya-client
npm run migrate
```

Las migraciones estan en:

```text
trabajoya-client/migrations/
```

## Seguridad

No guardar `.env`, passwords, API keys ni service-role keys en el repo. Si una
clave se compartio por chat o se uso durante pruebas, conviene rotarla.

## API WhatsApp

Para crear registros desde otro backend:

```http
POST /api/intakes
X-Trabajoya-Key: <TRABAJOYA_INTAKE_API_KEY>
Content-Type: application/json
```

Los endpoints de consulta `GET /api/intakes` y `GET /api/profiles` requieren
sesion admin desde el panel web.

## API Recomendaciones

Para generar recomendaciones desde el enlace del candidato:

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

Para consultar la ultima recomendacion guardada:

```http
GET /api/intakes/:code/recommendations/latest
```

Desde admin:

```http
POST /api/profiles/:profileId/recommendations
GET  /api/profiles/:profileId/recommendations
```

El endpoint guarda historial en `public.candidate_recommendation_runs`. Si se
repite una solicitud dentro de `MATCH_MIN_INTERVAL_SECONDS`, devuelve la ultima
corrida con `cached: true`.

## API Entrevistas

Crear una practica sobre una vacante recomendada:

```http
POST /api/intakes/:code/interview-sessions
Content-Type: application/json
```

```json
{
  "job_id": "uuid",
  "recommendation_run_id": "uuid"
}
```

Consultar feedback:

```http
GET /api/intakes/:code/interview-sessions/:sessionId
GET /api/intakes/:code/interview-sessions/latest
```

El webhook de n8n para guardar feedback llama:

```http
POST /api/interview-feedback
X-Trabajoya-Key: <TRABAJOYA_INTERVIEW_API_KEY>
```

Si `VOICE_FEEDBACK_API_URL` y `VOICE_FEEDBACK_API_KEY` estan configuradas, ese
guardado dispara un POST al servicio de audio con `{ text, phone }`. El texto se
recorta con `VOICE_FEEDBACK_MAX_CHARS` para mantenerlo por debajo de un minuto.

## Insomnia

Hay una coleccion importable en:

```text
contexto/insomnia/TrabajoYA_Insomnia.json
```

Despues de importarla, llenar `admin_password`, `intake_api_key`,
`intake_code` y `candidate_phone` en el ambiente de Insomnia.
