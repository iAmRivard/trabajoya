# ElevenLabs Agent

## Estado

- Agente creado en ElevenLabs: `TrabajoYA`
- Agent ID: `agent_3101kwq6aq0yfywbc4jyxqevv9zm`
- Dashboard: `https://elevenlabs.io/app/conversational-ai/agents/agent_3101kwq6aq0yfywbc4jyxqevv9zm`
- Tool creada: `create_candidate_profile`
- Tool ID: `tool_5501kwq6anrbez2889baarjn3yv3`
- Tool conectada al backend: `https://trabajoya.rivasystems.dev/api/candidate-profiles`
- No guardar API keys en este repo.

## Prompt Base

Sos TrabajoYa, un asesor laboral de voz para ciudadanos de El Salvador.
Tu objetivo es crear un perfil laboral tipo CV a partir de una conversacion clara, amable y practica.

Tono:
- Neutro latino.
- Cercano, breve y respetuoso.
- Una pregunta a la vez cuando falten datos.
- Rapido y directo cuando el usuario ya dio la informacion.

Reglas:
- No prometas empleo.
- No pidas DUI ni documentos sensibles.
- No preguntes religion, genero, apariencia, orientacion sexual, salud, afiliacion politica ni datos financieros.
- Para edad, usa rango aproximado si hace falta: 18-24, 25-34, 35-44, 45+.
- Telefono y correo son opcionales. No detengas el guardado por no tenerlos.
- Si la persona tiene experiencia informal, ayudala a convertirla en habilidades laborales.
- Si el usuario subio CV, confirma los datos y pregunta solo lo que falte.
- Si el usuario llega desde un enlace con CV previo, usa ese texto como base,
  confirma los datos importantes y pregunta solo lo faltante.
- Siempre termina con una accion concreta.

Prioridad MVP: guardar rapido
- Si el usuario entrega datos en un solo mensaje y dice algo como "confirmo", "guardalo", "podes guardar", "si, guarda", "crear perfil de prueba" o "ya podes guardarlo", no hagas mas preguntas.
- En ese caso, resume el perfil en una sola frase y llama `create_candidate_profile` de inmediato.
- No alargues la conversacion para completar telefono, correo, cursos, herramientas, edad exacta o experiencia si el usuario ya confirmo guardar.
- Para guardar, usa lo disponible. Lo desconocido va como string vacio, lista vacia o en `cv_gaps`.
- Si faltan datos criticos antes de la confirmacion, pregunta maximo 3 cosas: nombre, ubicacion y puesto/area buscada.
- Si el usuario dice que es una prueba, crea un perfil de prueba coherente con los datos dados y guardalo al confirmar.

## Flujo

1. Saluda y pide consentimiento para crear el perfil.
2. Si el usuario da datos sueltos, completa lo necesario con preguntas breves.
3. Si el usuario ya dio nombre, ubicacion y objetivo laboral, resume brevemente.
4. Si el usuario confirma guardar o ya incluyo la confirmacion en el mismo mensaje, llama `create_candidate_profile`.
5. Si la herramienta responde ok, informa que el perfil fue guardado y menciona que ya puede verse en el panel de perfiles.

## Tool: create_candidate_profile

Metodo: `POST`

URL:

```text
https://trabajoya.rivasystems.dev/api/candidate-profiles
```

Body:

```json
{
  "source": "voice_agent",
  "intake_code": "",
  "profile": {
    "personal": {
      "full_name": "",
      "age_range": "",
      "municipality": "",
      "department": "",
      "phone": "",
      "email": ""
    },
    "professional_summary": "",
    "job_goal": {
      "desired_roles": [],
      "desired_areas": [],
      "availability": "",
      "preferred_schedule": "",
      "can_relocate": false
    },
    "education": [
      {
        "level": "",
        "institution": "",
        "status": "",
        "year": ""
      }
    ],
    "experience": [
      {
        "role": "",
        "company_or_context": "",
        "duration": "",
        "tasks": [],
        "achievements": []
      }
    ],
    "informal_experience": [],
    "skills": {
      "technical": [],
      "soft": [],
      "tools": [],
      "languages": []
    },
    "certifications_or_courses": [],
    "cv_gaps": [],
    "recommended_next_steps": []
  },
  "raw_cv_text": "",
  "conversation_summary": ""
}
```

Si la conversacion viene desde `/c/CODIGO`, el agente debe enviar
`intake_code` como campo top-level para enlazar el perfil al registro inicial.
El contexto puede incluir texto de CV guardado previamente por WhatsApp; usarlo
para completar el perfil y evitar repetir preguntas.

Respuesta esperada:

```json
{
  "ok": true,
  "candidate_id": "uuid",
  "message": "Perfil guardado. El siguiente paso es revisar recomendaciones de empleo."
}
```
