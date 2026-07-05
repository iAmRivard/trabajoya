# n8n Webhook Contract

## Entrada

Webhook:

```text
POST /webhook/trabajoya/create-candidate-profile
```

Payload:

```json
{
  "source": "voice_agent",
  "profile": {
    "personal": {
      "full_name": "Carlos Martinez",
      "age_range": "18-24",
      "municipality": "Soyapango",
      "department": "San Salvador",
      "phone": "",
      "email": ""
    },
    "professional_summary": "Busca su primer empleo formal. Tiene experiencia atendiendo clientes en tienda familiar.",
    "job_goal": {
      "desired_roles": ["Auxiliar de tienda", "Atencion al cliente"],
      "desired_areas": ["Ventas", "Retail"],
      "availability": "Tiempo completo",
      "preferred_schedule": "Diurno",
      "can_relocate": false
    },
    "education": [
      {
        "level": "Bachillerato",
        "institution": "",
        "status": "Completado",
        "year": ""
      }
    ],
    "experience": [],
    "informal_experience": [
      "Atendio clientes y ordeno productos en una tienda familiar."
    ],
    "skills": {
      "technical": [],
      "soft": ["Atencion al cliente", "Responsabilidad", "Comunicacion"],
      "tools": [],
      "languages": ["Espanol nativo"]
    },
    "certifications_or_courses": [],
    "cv_gaps": ["Falta correo electronico", "Falta telefono"],
    "recommended_next_steps": [
      "Completar datos de contacto",
      "Practicar entrevista para auxiliar de tienda"
    ]
  },
  "raw_cv_text": "",
  "conversation_summary": "El candidato confirmo que desea buscar empleo en ventas o retail."
}
```

## Workflow minimo

1. Webhook node recibe el payload.
2. Code node valida que exista `profile.personal.full_name`.
3. Supabase/Postgres node inserta en `candidate_profiles`.
4. Respond to Webhook devuelve `candidate_id` y mensaje corto.

## Insert sugerido

Mapear estos campos:

```text
full_name = profile.personal.full_name
email = profile.personal.email
phone = profile.personal.phone
municipality = profile.personal.municipality
department = profile.personal.department
source = source
profile = profile
raw_cv_text = raw_cv_text
conversation_summary = conversation_summary
```

## Respuesta

```json
{
  "ok": true,
  "candidate_id": "uuid-generado-en-supabase",
  "message": "Perfil guardado. El siguiente paso es revisar recomendaciones de empleo."
}
```

## Webhook De Feedback De Entrevista

Webhook nuevo, independiente del guardado de perfil:

```text
POST /webhook/trabajoya/save-interview-feedback
```

Header requerido:

```http
X-Trabajoya-Key: <TRABAJOYA_INTERVIEW_API_KEY>
```

Payload esperado desde ElevenLabs:

```json
{
  "interview_session_id": "uuid",
  "elevenlabs_conversation_id": "conv_xxx",
  "status": "completed",
  "scores": {
    "overall": 82,
    "communication": 80,
    "role_fit": 85,
    "examples": 75,
    "confidence": 78,
    "clarity": 84
  },
  "feedback": {
    "overall_score": 82,
    "summary": "Resumen breve del desempeno.",
    "strengths": ["Fortaleza concreta"],
    "improvements": ["Mejora concreta"],
    "suggested_answers": ["Como responder mejor una pregunta clave."],
    "next_steps": ["Practicar una respuesta de 60 segundos"],
    "closing_note": "Cierre breve."
  }
}
```

Workflow:

1. Webhook recibe el payload.
2. Code node valida `X-Trabajoya-Key` y `interview_session_id`.
3. HTTP Request llama `POST /api/interview-feedback` en TrabajoYA con la misma
   key.
4. El backend actualiza `public.candidate_interview_simulations`.
5. Respond to Webhook devuelve `{ "ok": true, "message": "Feedback guardado." }`.
