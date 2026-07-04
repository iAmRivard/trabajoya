const webhookUrl =
  process.env.TRABAJOYA_WEBHOOK_URL ||
  'https://n8n.rivasystems.dev/webhook/trabajoya/create-candidate-profile';

const timestamp = new Date().toISOString();

const payload = {
  source: 'qa_local_script',
  profile: {
    personal: {
      full_name: `QA TrabajoYA ${timestamp}`,
      age_range: '25-34',
      municipality: 'San Salvador',
      department: 'San Salvador',
      phone: '',
      email: 'qa+trabajoya@rivasystems.dev',
    },
    professional_summary:
      'Registro de prueba para validar que el webhook de n8n inserta en Postgres.',
    job_goal: {
      desired_roles: ['Atencion al cliente'],
      desired_areas: ['Servicios'],
      availability: 'Inmediata',
      preferred_schedule: 'Diurno',
      can_relocate: false,
    },
    education: [
      {
        level: 'Bachillerato',
        institution: '',
        status: 'Completado',
        year: '',
      },
    ],
    experience: [],
    informal_experience: ['Prueba directa desde el cliente local.'],
    skills: {
      technical: [],
      soft: ['Comunicacion', 'Responsabilidad'],
      tools: [],
      languages: ['Espanol nativo'],
    },
    certifications_or_courses: [],
    cv_gaps: [],
    recommended_next_steps: ['Validar que el registro aparezca en DBeaver.'],
  },
  raw_cv_text: '',
  conversation_summary:
    'Prueba directa del webhook sin pasar por el agente de voz.',
};

const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

const body = await response.json().catch(() => null);

if (!response.ok || body?.ok !== true) {
  console.error('No se pudo crear el perfil de prueba.');
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log('Perfil de prueba creado.');
console.log(`candidate_id: ${body.candidate_id}`);
console.log(`full_name: ${payload.profile.personal.full_name}`);
