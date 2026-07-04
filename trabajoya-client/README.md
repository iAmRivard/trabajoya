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
GET  /api/courses
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
X-Trabajoya-Key: <TRABAJOYA_INTAKE_API_KEY>
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
migrations/001_candidate_intakes.sql
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
```

El script `npm run migrate` aplica todos los archivos `.sql` en
`migrations/` en orden alfabetico. En Docker, `npm run start` ejecuta
migraciones antes de levantar el servidor.

En el VPS el compose esta en:

```text
/etc/dokploy/compose/trabajoya-client/code
```
