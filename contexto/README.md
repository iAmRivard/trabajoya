# TrabajoYa Voz AI

Flujo inicial:

```text
CV opcional -> agente de voz confirma/completa datos -> n8n online -> Supabase/Postgres
```

## Componentes

- `supabase/schema.sql`: tabla minima para guardar perfiles tipo CV.
- `docs/elevenlabs-agent.md`: prompt base y tool `create_candidate_profile`.
- `docs/n8n-webhook-contract.md`: payload que n8n debe recibir y respuesta esperada.
- `../trabajoya-client`: app fullstack con voz, registros iniciales, carga de CV y panel de perfiles.

## Siguiente paso

1. Agregar OCR para PDFs escaneados como imagen.
2. Agregar recomendaciones de cursos/vacantes.
3. Agregar manejo de errores amigable para payloads incompletos.
4. Preparar deploy del cliente si deja de ser solo local.

## Estado Dokploy

- `https://n8n.rivasystems.dev/` responde correctamente.
- En el Postgres del stack de n8n se creo la base `trabajoya`.
- En `trabajoya` ya existe `public.candidate_profiles` con el schema minimo.
- Desde n8n, el host interno de Postgres es `postgres`, puerto `5432`, base `trabajoya`.
- En n8n ya existe el workflow `TrabajoYa - Create Candidate Profile`.
- URL de produccion:
  `https://n8n.rivasystems.dev/webhook/trabajoya/create-candidate-profile`
- El webhook fue probado con payload demo y devuelve `ok`, `candidate_id` y `message`.
- En ElevenLabs ya existe el agente `TrabajoYA`.
- Agent ID: `agent_3101kwq6aq0yfywbc4jyxqevv9zm`
- Dashboard:
  `https://elevenlabs.io/app/conversational-ai/agents/agent_3101kwq6aq0yfywbc4jyxqevv9zm`
- Tool ID: `tool_5501kwq6anrbez2889baarjn3yv3`
- Prompt ajustado para MVP: si el usuario ya dio datos suficientes y confirma, guarda sin extender la conversacion.
- Cliente local probado con API de perfiles en `http://127.0.0.1:8787/api/profiles`.
- Deploy publico:
  `https://trabajoya.rivasystems.dev/`
- Backend nuevo:
  - `POST /api/intakes`: crea registro inicial y devuelve codigo/URL.
  - `POST /api/intakes/:code/verify`: verifica codigo + telefono.
  - `POST /api/candidate-profiles`: guarda perfil final y enlaza `intake_code`.
- Cliente acepta CV en PDF con texto seleccionable y TXT; endpoint:
  `POST http://127.0.0.1:8787/api/cv/extract`.

No guardar API keys ni service-role keys en este repo.
