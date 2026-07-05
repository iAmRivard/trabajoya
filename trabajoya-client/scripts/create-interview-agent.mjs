const elevenLabsBaseUrl = 'https://api.elevenlabs.io/v1';
const defaultSourceAgentId = 'agent_3101kwq6aq0yfywbc4jyxqevv9zm';
const agentName = process.env.ELEVENLABS_INTERVIEW_AGENT_NAME || 'TrabajoYA - Simulacion Entrevista';
const sourceAgentId = process.env.ELEVENLABS_SOURCE_AGENT_ID || defaultSourceAgentId;
const existingInterviewAgentId = process.env.ELEVENLABS_INTERVIEW_AGENT_ID || '';
const apiKey = process.env.ELEVENLABS_API_KEY || '';
const feedbackWebhookUrl =
  process.env.N8N_INTERVIEW_FEEDBACK_WEBHOOK_URL ||
  'https://n8n.rivasystems.dev/webhook/trabajoya/save-interview-feedback';
const feedbackApiKey = process.env.TRABAJOYA_INTERVIEW_API_KEY || '';
const interviewPrompt = `
Sos un entrevistador laboral de practica para TrabajoYA en El Salvador.
Tu objetivo es simular una entrevista corta, realista y respetuosa para la vacante elegida por el candidato.

Recibiras contexto con:
- interview_session_id
- elevenlabs_conversation_id si esta disponible
- resumen del perfil del candidato
- vacante elegida, habilidades buscadas y motivos del match

No leas el contexto tecnico en voz alta.

Reglas:
- Haz de 4 a 6 preguntas maximo.
- Haz una sola pregunta por turno.
- Basa las preguntas en el perfil y la vacante elegida.
- Pide ejemplos concretos, disponibilidad o motivacion solo si aplica.
- No pidas DUI, documentos, religion, genero, apariencia, orientacion sexual, salud, afiliacion politica ni datos financieros.
- No prometas contratacion ni digas que la persona fue seleccionada.
- Mantén tono neutral latino, amable, breve y profesional.
- Si el candidato responde muy corto, puedes repreguntar una vez.
- Al terminar, da un cierre breve y llama save_interview_feedback.
- Despues de llamar save_interview_feedback, no hagas mas preguntas.

Estructura recomendada:
1. Saluda y menciona la vacante elegida.
2. Pregunta por experiencia relacionada.
3. Pregunta por una habilidad clave de la vacante.
4. Pregunta por manejo de una situacion realista.
5. Pregunta por disponibilidad/motivacion si falta.
6. Cierra y guarda feedback.

Feedback:
- Scores de 0 a 100.
- Fortalezas y mejoras concretas.
- Respuestas sugeridas accionables.
- Proximos pasos breves.
`.trim();

if (!apiKey) {
  throw new Error('Configura ELEVENLABS_API_KEY solo en tu entorno local/servidor antes de ejecutar este script.');
}

if (!feedbackApiKey) {
  throw new Error('Configura TRABAJOYA_INTERVIEW_API_KEY antes de crear el agente de entrevista.');
}

const agentId = existingInterviewAgentId || (await duplicateAgent(sourceAgentId, agentName));
const agent = await elevenLabsFetch(`/convai/agents/${agentId}`);
const conversationConfig = buildConversationConfig(agent.conversation_config || {});

await elevenLabsFetch(`/convai/agents/${agentId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    name: agentName,
    conversation_config: conversationConfig,
  }),
});

console.log(JSON.stringify({ ok: true, agent_id: agentId, name: agentName }, null, 2));

async function duplicateAgent(sourceId, name) {
  const duplicated = await elevenLabsFetch(`/convai/agents/${sourceId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

  return duplicated.agent_id;
}

async function elevenLabsFetch(path, options = {}) {
  const response = await fetch(`${elevenLabsBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      typeof data?.detail === 'object'
        ? JSON.stringify(data.detail)
        : data?.detail?.message || data?.detail || data?.message || JSON.stringify(data || {});
    throw new Error(detail || `ElevenLabs error ${response.status}`);
  }

  return data;
}

function buildConversationConfig(config) {
  const nextConfig = structuredClone(config);

  nextConfig.agent ||= {};
  nextConfig.agent.first_message =
    'Hola, soy tu entrevistador de practica. Vamos a simular una entrevista corta para la vacante que elegiste.';
  nextConfig.agent.language = 'es';
  nextConfig.agent.disable_first_message_interruptions = true;
  nextConfig.conversation ||= {};
  nextConfig.conversation.max_duration_seconds = 420;

  const prompt = typeof nextConfig.agent.prompt === 'object' && nextConfig.agent.prompt !== null ? nextConfig.agent.prompt : {};
  prompt.prompt = interviewPrompt;
  delete prompt.tool_ids;
  delete prompt.toolIds;
  delete prompt.tools_ids;
  prompt.tools = [saveInterviewFeedbackTool()];
  prompt.built_in_tools ||= {};
  nextConfig.agent.prompt = prompt;

  return nextConfig;
}

function saveInterviewFeedbackTool() {
  return {
    type: 'webhook',
    name: 'save_interview_feedback',
    description:
      'Guarda el feedback final de una simulacion de entrevista TrabajoYA. Usar una sola vez al terminar las 4 a 6 preguntas.',
    response_timeout_secs: 20,
    execution_mode: 'immediate',
    pre_tool_speech: 'off',
    api_schema: {
      url: feedbackWebhookUrl,
      method: 'POST',
      request_headers: {
        'Content-Type': 'application/json',
        'X-Trabajoya-Key': feedbackApiKey,
      },
      path_params_schema: {},
      query_params_schema: null,
      request_body_schema: {
        type: 'object',
        description: 'Feedback estructurado de la simulacion de entrevista.',
        required: ['interview_session_id', 'status', 'scores', 'feedback'],
        properties: {
          interview_session_id: schemaField({
            type: 'string',
            description: 'UUID recibido en el contexto de la practica.',
          }),
          elevenlabs_conversation_id: schemaField({
            type: 'string',
            description: 'Conversation ID recibido en el contexto, si esta disponible.',
          }),
          status: schemaField({
            type: 'string',
            enum: ['completed', 'failed'],
            description: 'completed si la entrevista termino y se puede evaluar.',
          }),
          scores: {
            type: 'object',
            description: 'Puntajes de 0 a 100 por dimension evaluada.',
            required: ['overall'],
            properties: {
              overall: schemaField({ type: 'integer', minimum: 0, maximum: 100, description: 'Puntaje global.' }),
              communication: schemaField({ type: 'integer', minimum: 0, maximum: 100, description: 'Comunicacion.' }),
              role_fit: schemaField({ type: 'integer', minimum: 0, maximum: 100, description: 'Ajuste al puesto.' }),
              examples: schemaField({ type: 'integer', minimum: 0, maximum: 100, description: 'Calidad de ejemplos.' }),
              confidence: schemaField({ type: 'integer', minimum: 0, maximum: 100, description: 'Seguridad al responder.' }),
              clarity: schemaField({ type: 'integer', minimum: 0, maximum: 100, description: 'Claridad.' }),
            },
          },
          feedback: {
            type: 'object',
            description: 'Retroalimentacion concreta para el candidato.',
            required: ['overall_score', 'summary', 'strengths', 'improvements', 'suggested_answers', 'next_steps'],
            properties: {
              overall_score: schemaField({ type: 'integer', minimum: 0, maximum: 100, description: 'Puntaje global.' }),
              summary: schemaField({ type: 'string', description: 'Resumen breve del desempeno.' }),
              strengths: schemaField({
                type: 'array',
                description: 'Fortalezas observadas.',
                items: schemaField({ type: 'string', description: 'Fortaleza concreta.' }),
              }),
              improvements: schemaField({
                type: 'array',
                description: 'Areas de mejora concretas.',
                items: schemaField({ type: 'string', description: 'Area de mejora concreta.' }),
              }),
              suggested_answers: schemaField({
                type: 'array',
                description: 'Respuestas sugeridas o marcos de respuesta.',
                items: schemaField({ type: 'string', description: 'Respuesta sugerida.' }),
              }),
              next_steps: schemaField({
                type: 'array',
                description: 'Proximos pasos recomendados.',
                items: schemaField({ type: 'string', description: 'Proximo paso recomendado.' }),
              }),
              closing_note: schemaField({ type: 'string', description: 'Nota final breve.' }),
            },
          },
        },
      },
      response_body_schema: {
        type: 'object',
        description: 'Respuesta del webhook de guardado.',
        properties: {
          result: schemaField({ type: 'string', description: 'Resultado del guardado.' }),
          ok: schemaField({ type: 'boolean', description: 'Indicador de exito.' }),
          message: schemaField({ type: 'string', description: 'Mensaje corto.' }),
        },
        required: [],
      },
      response_filter: null,
    },
  };
}

function schemaField(schema) {
  const defaultConstantValue =
    schema.type === 'array' ? [] : schema.type === 'object' ? {} : schema.type === 'boolean' ? false : '';

  return {
    description: '',
    enum: null,
    is_system_provided: false,
    dynamic_variable: '',
    allowed_values_dynamic_variable: '',
    constant_value: defaultConstantValue,
    is_omitted: false,
    ...schema,
  };
}
