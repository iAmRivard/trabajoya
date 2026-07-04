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
2. El backend genera un codigo corto y una URL publica.
3. El candidato abre la URL, verifica su telefono y arranca la conversacion.
4. El agente recibe el contexto del registro.
5. El tool de ElevenLabs guarda el perfil final en Postgres y lo enlaza al
   registro inicial.

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
TRABAJOYA_DB_PASSWORD=...
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

La migracion principal esta en:

```text
trabajoya-client/migrations/001_candidate_intakes.sql
```

## Seguridad

No guardar `.env`, passwords, API keys ni service-role keys en el repo. Si una
clave se compartio por chat o se uso durante pruebas, conviene rotarla.
