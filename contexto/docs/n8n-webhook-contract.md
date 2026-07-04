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
