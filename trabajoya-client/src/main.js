import { Conversation } from '@elevenlabs/client';
import {
  createIcons,
  CheckCircle,
  Copy,
  Database,
  FileText,
  Link,
  MessageSquare,
  Mic,
  MicOff,
  Play,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Upload,
  UserPlus,
  Users,
} from 'lucide';
import './styles.css';

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID || 'agent_3101kwq6aq0yfywbc4jyxqevv9zm';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const elements = {
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  muteButton: document.querySelector('#muteButton'),
  candidateGate: document.querySelector('#candidateGate'),
  candidateGateTitle: document.querySelector('#candidateGateTitle'),
  candidateGateDetail: document.querySelector('#candidateGateDetail'),
  candidateVerifyForm: document.querySelector('#candidateVerifyForm'),
  candidatePhoneInput: document.querySelector('#candidatePhoneInput'),
  candidateVerifyButton: document.querySelector('#candidateVerifyButton'),
  candidateVerifyStatus: document.querySelector('#candidateVerifyStatus'),
  cvForm: document.querySelector('#cvForm'),
  cvInput: document.querySelector('#cvInput'),
  extractCvButton: document.querySelector('#extractCvButton'),
  sendCvContextButton: document.querySelector('#sendCvContextButton'),
  cvStatus: document.querySelector('#cvStatus'),
  cvPreview: document.querySelector('#cvPreview'),
  textForm: document.querySelector('#textForm'),
  textInput: document.querySelector('#textInput'),
  sendButton: document.querySelector('#sendButton'),
  connectionStatus: document.querySelector('#connectionStatus'),
  agentStatus: document.querySelector('#agentStatus'),
  sessionTitle: document.querySelector('#sessionTitle'),
  sessionDetail: document.querySelector('#sessionDetail'),
  panelTitle: document.querySelector('#panelTitle'),
  activityTab: document.querySelector('#activityTab'),
  intakesTab: document.querySelector('#intakesTab'),
  profilesTab: document.querySelector('#profilesTab'),
  activityView: document.querySelector('#activityView'),
  intakesView: document.querySelector('#intakesView'),
  profilesView: document.querySelector('#profilesView'),
  refreshProfilesButton: document.querySelector('#refreshProfilesButton'),
  intakeForm: document.querySelector('#intakeForm'),
  intakePhoneInput: document.querySelector('#intakePhoneInput'),
  intakeNameInput: document.querySelector('#intakeNameInput'),
  intakeRoleInput: document.querySelector('#intakeRoleInput'),
  intakeMunicipalityInput: document.querySelector('#intakeMunicipalityInput'),
  intakeDepartmentInput: document.querySelector('#intakeDepartmentInput'),
  createIntakeButton: document.querySelector('#createIntakeButton'),
  intakeResult: document.querySelector('#intakeResult'),
  intakeUrlOutput: document.querySelector('#intakeUrlOutput'),
  copyIntakeUrlButton: document.querySelector('#copyIntakeUrlButton'),
  intakesStatus: document.querySelector('#intakesStatus'),
  intakesList: document.querySelector('#intakesList'),
  intakeCount: document.querySelector('#intakeCount'),
  profilesStatus: document.querySelector('#profilesStatus'),
  profilesList: document.querySelector('#profilesList'),
  profileCount: document.querySelector('#profileCount'),
  eventLog: document.querySelector('#eventLog'),
};

let conversation = null;
let muted = false;
let profilesLoaded = false;
let intakesLoaded = false;
let extractedCv = null;
let candidateSession = getCandidateSessionFromPath();

function getErrorMessage(error, fallback) {
  if (typeof error === 'string') return error;
  return error?.message || fallback;
}

createIcons({
  icons: {
    CheckCircle,
    Copy,
    Database,
    FileText,
    Link,
    MessageSquare,
    Mic,
    MicOff,
    Play,
    Radio,
    RefreshCw,
    Send,
    ShieldCheck,
    Square,
    Upload,
    UserPlus,
    Users,
  },
});

function addEvent(kind, text) {
  const item = document.createElement('li');
  const time = new Intl.DateTimeFormat('es-SV', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());

  item.className = `event event-${kind}`;
  item.innerHTML = `<span>${time}</span><p></p>`;
  item.querySelector('p').textContent = text;
  elements.eventLog.prepend(item);

  while (elements.eventLog.children.length > 10) {
    elements.eventLog.lastElementChild.remove();
  }
}

function setConnectedState(isConnected) {
  elements.startButton.disabled = isConnected || !canStartConversation();
  elements.stopButton.disabled = !isConnected;
  elements.muteButton.disabled = !isConnected;
  elements.textInput.disabled = !isConnected;
  elements.sendButton.disabled = !isConnected;
  updateCvContextButton();
  elements.connectionStatus.textContent = isConnected ? 'Conectado' : 'Desconectado';
  elements.sessionTitle.textContent = isConnected ? 'Sesión activa' : 'Listo para crear un perfil';
  elements.sessionDetail.textContent = isConnected ? 'Conversación en curso con TrabajoYA.' : 'Perfil laboral en preparación.';

  if (!isConnected) {
    elements.agentStatus.textContent = 'En espera';
    muted = false;
    updateMuteButton();
  }
}

function canStartConversation() {
  return !candidateSession || Boolean(candidateSession.intake);
}

function getCandidateSessionFromPath() {
  const match = window.location.pathname.match(/^\/c\/([A-Za-z0-9-]+)/);
  if (!match) return null;

  return {
    code: match[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    intake: null,
    contextSent: false,
  };
}

function initializeCandidateRoute() {
  if (!candidateSession) return;

  elements.candidateGate.hidden = false;
  elements.candidateGateTitle.textContent = `Código ${candidateSession.code}`;
  elements.candidateGateDetail.textContent =
    'Verifica el teléfono asociado para completar el perfil con TrabajoYA.';
  setCandidateVerifyStatus('Pendiente de verificación.');
  elements.sessionTitle.textContent = 'Verifica tu teléfono';
  elements.sessionDetail.textContent = 'Después podrás completar el perfil con el agente.';
  elements.startButton.disabled = true;
}

function setCandidateVerifyStatus(text, kind = 'neutral') {
  elements.candidateVerifyStatus.textContent = text;
  elements.candidateVerifyStatus.dataset.kind = kind;
}

function setCvStatus(text, kind = 'neutral') {
  elements.cvStatus.textContent = text;
  elements.cvStatus.dataset.kind = kind;
}

function updateCvContextButton() {
  elements.sendCvContextButton.disabled = !conversation || !extractedCv?.text;
}

function renderCvPreview() {
  if (!extractedCv?.preview) {
    elements.cvPreview.hidden = true;
    elements.cvPreview.textContent = '';
    return;
  }

  elements.cvPreview.hidden = false;
  elements.cvPreview.textContent = extractedCv.preview;
}

function updateMuteButton() {
  elements.muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
  elements.muteButton.innerHTML = muted
    ? '<i data-lucide="mic-off"></i><span>Silenciado</span>'
    : '<i data-lucide="mic"></i><span>Micrófono</span>';
  createIcons({ icons: { Mic, MicOff } });
}

function setPanel(panel) {
  const isActivity = panel === 'activity';
  const isIntakes = panel === 'intakes';
  const isProfiles = panel === 'profiles';

  elements.panelTitle.textContent = isProfiles ? 'Perfiles' : isIntakes ? 'Registros' : 'Actividad';
  elements.activityView.hidden = !isActivity;
  elements.intakesView.hidden = !isIntakes;
  elements.profilesView.hidden = !isProfiles;
  elements.activityTab.classList.toggle('is-active', isActivity);
  elements.intakesTab.classList.toggle('is-active', isIntakes);
  elements.profilesTab.classList.toggle('is-active', isProfiles);
  elements.activityTab.setAttribute('aria-selected', isActivity ? 'true' : 'false');
  elements.intakesTab.setAttribute('aria-selected', isIntakes ? 'true' : 'false');
  elements.profilesTab.setAttribute('aria-selected', isProfiles ? 'true' : 'false');

  if (isIntakes && !intakesLoaded) {
    fetchIntakes();
  }

  if (isProfiles && !profilesLoaded) {
    fetchProfiles();
  }
}

function setProfilesStatus(text, kind = 'neutral') {
  elements.profilesStatus.textContent = text;
  elements.profilesStatus.dataset.kind = kind;
}

function formatDate(value) {
  if (!value) return 'Sin fecha';

  return new Intl.DateTimeFormat('es-SV', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getListText(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : fallback;
}

function renderProfiles(profiles) {
  elements.profileCount.textContent = profiles.length.toString();
  elements.profilesList.replaceChildren();

  if (profiles.length === 0) {
    setProfilesStatus('No hay perfiles guardados todavia.');
    return;
  }

  setProfilesStatus(`Mostrando los ultimos ${profiles.length} perfiles.`);

  for (const savedProfile of profiles) {
    const profile = savedProfile.profile || {};
    const personal = profile.personal || {};
    const jobGoal = profile.job_goal || {};
    const skills = profile.skills || {};
    const article = document.createElement('article');
    const title = document.createElement('h3');
    const summary = document.createElement('p');
    const meta = document.createElement('dl');

    article.className = 'profile-item';
    title.textContent = savedProfile.full_name || personal.full_name || 'Perfil sin nombre';
    summary.textContent =
      profile.professional_summary ||
      savedProfile.conversation_summary ||
      'Perfil guardado sin resumen profesional.';
    meta.className = 'profile-meta';

    addMeta(meta, 'Rol', getListText(jobGoal.desired_roles, 'Por definir'));
    addMeta(
      meta,
      'Lugar',
      [savedProfile.municipality || personal.municipality, savedProfile.department || personal.department]
        .filter(Boolean)
        .join(', ') || 'Por definir',
    );
    addMeta(meta, 'Habilidades', getListText(skills.soft, 'Por completar'));
    addMeta(meta, 'Fuente', savedProfile.source || 'voice_agent');
    addMeta(meta, 'Creado', formatDate(savedProfile.created_at));

    article.append(title, summary, meta);
    elements.profilesList.append(article);
  }
}

function addMeta(container, label, value) {
  const term = document.createElement('dt');
  const description = document.createElement('dd');

  term.textContent = label;
  description.textContent = value;
  container.append(term, description);
}

function setIntakesStatus(text, kind = 'neutral') {
  elements.intakesStatus.textContent = text;
  elements.intakesStatus.dataset.kind = kind;
}

function renderIntakes(intakes) {
  elements.intakeCount.textContent = intakes.length.toString();
  elements.intakesList.replaceChildren();

  if (intakes.length === 0) {
    setIntakesStatus('No hay registros iniciales todavia.');
    return;
  }

  setIntakesStatus(`Mostrando los ultimos ${intakes.length} registros.`);

  for (const intake of intakes) {
    const article = document.createElement('article');
    const title = document.createElement('h3');
    const summary = document.createElement('p');
    const meta = document.createElement('dl');

    article.className = 'profile-item';
    title.textContent = intake.full_name || `Registro ${intake.code}`;
    summary.textContent = intake.desired_role || 'Perfil pendiente de completar.';
    meta.className = 'profile-meta';

    addMeta(meta, 'Código', intake.code);
    addMeta(meta, 'Teléfono', intake.phone || `****-${intake.phone_last4}`);
    addMeta(meta, 'Estado', intake.status);
    addMeta(meta, 'Creado', formatDate(intake.created_at));

    article.append(title, summary, meta);
    elements.intakesList.append(article);
  }
}

async function fetchIntakes() {
  setIntakesStatus('Cargando registros...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/intakes?limit=30`);
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudieron leer los registros.');
    }

    intakesLoaded = true;
    renderIntakes(data.intakes || []);
  } catch (error) {
    setIntakesStatus(getErrorMessage(error, 'No se pudieron cargar los registros.'), 'error');
  }
}

async function createIntake(event) {
  event.preventDefault();
  elements.createIntakeButton.disabled = true;
  elements.intakeResult.hidden = true;
  setIntakesStatus('Creando enlace...');

  try {
    const payload = {
      phone: elements.intakePhoneInput.value,
      full_name: elements.intakeNameInput.value,
      desired_role: elements.intakeRoleInput.value,
      municipality: elements.intakeMunicipalityInput.value,
      department: elements.intakeDepartmentInput.value,
      source: 'internal_form',
    };
    const response = await fetch(`${API_BASE_URL}/api/intakes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo crear el registro.');
    }

    elements.intakeUrlOutput.value = data.url;
    elements.intakeResult.hidden = false;
    elements.intakeForm.reset();
    setIntakesStatus(`Enlace creado con codigo ${data.code}.`);
    intakesLoaded = false;
    fetchIntakes();
  } catch (error) {
    setIntakesStatus(getErrorMessage(error, 'No se pudo crear el registro.'), 'error');
  } finally {
    elements.createIntakeButton.disabled = false;
  }
}

async function copyIntakeUrl() {
  const url = elements.intakeUrlOutput.value;
  if (!url) return;

  await navigator.clipboard?.writeText(url);
  setIntakesStatus('Enlace copiado.');
}

async function fetchProfiles() {
  elements.refreshProfilesButton.disabled = true;
  setProfilesStatus('Cargando perfiles...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/profiles?limit=30`);
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo leer Postgres.');
    }

    profilesLoaded = true;
    renderProfiles(data.profiles || []);
  } catch (error) {
    setProfilesStatus(getErrorMessage(error, 'No se pudo cargar la lista de perfiles.'), 'error');
  } finally {
    elements.refreshProfilesButton.disabled = false;
  }
}

async function verifyCandidate(event) {
  event.preventDefault();

  if (!candidateSession) return;

  elements.candidateVerifyButton.disabled = true;
  setCandidateVerifyStatus('Verificando...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/intakes/${candidateSession.code}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: elements.candidatePhoneInput.value,
      }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo verificar el enlace.');
    }

    candidateSession.intake = data.intake;
    setCandidateVerifyStatus('Teléfono verificado. Ya podés iniciar la conversación.');
    elements.candidatePhoneInput.disabled = true;
    elements.candidateVerifyButton.disabled = true;
    elements.sessionTitle.textContent = data.intake.full_name
      ? `Hola, ${data.intake.full_name}`
      : 'Listo para completar tu perfil';
    elements.sessionDetail.textContent = 'Inicia el agente para revisar tus datos y completar lo pendiente.';
    setConnectedState(false);
    addEvent('system', `Registro verificado: ${candidateSession.code}`);
  } catch (error) {
    setCandidateVerifyStatus(getErrorMessage(error, 'No se pudo verificar el enlace.'), 'error');
    elements.candidateVerifyButton.disabled = false;
  }
}

function sendIntakeContextToAgent() {
  if (!conversation || !candidateSession?.intake || candidateSession.contextSent) return;

  const intake = candidateSession.intake;
  const context = [
    `Registro inicial TrabajoYA: ${intake.code}`,
    `intake_code: ${intake.code}`,
    `Telefono verificado: ${intake.phone}`,
    `Nombre inicial: ${intake.full_name || 'No indicado'}`,
    `Municipio: ${intake.municipality || 'No indicado'}`,
    `Departamento: ${intake.department || 'No indicado'}`,
    `Puesto buscado: ${intake.desired_role || 'No indicado'}`,
    'Cuando guardes el perfil final, incluye este intake_code en el payload de la herramienta.',
    'Pregunta solo lo que falte para completar el perfil laboral.',
  ].join('\n');

  candidateSession.contextSent = true;
  conversation.sendContextualUpdate(context, { contextId: `intake_${intake.code}` });
  conversation.sendUserMessage(
    'Ya verifique mi telefono. Usa mis datos iniciales para completar mi perfil laboral.',
  );
  conversation.sendUserActivity();
  addEvent('system', 'Datos iniciales enviados al agente.');
}

async function extractCv(event) {
  event.preventDefault();

  const file = elements.cvInput.files?.[0];

  if (!file) {
    setCvStatus('Selecciona un PDF o TXT.', 'error');
    return;
  }

  const body = new FormData();
  body.append('cv', file);

  elements.extractCvButton.disabled = true;
  elements.sendCvContextButton.disabled = true;
  setCvStatus('Extrayendo CV...');
  elements.cvPreview.hidden = true;
  elements.cvPreview.textContent = '';

  try {
    const response = await fetch(`${API_BASE_URL}/api/cv/extract`, {
      method: 'POST',
      body,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo extraer el CV.');
    }

    extractedCv = {
      file: data.file,
      text: data.text,
      preview: data.preview,
    };

    const pages = data.file?.pages ? `, ${data.file.pages} pag.` : '';
    setCvStatus(`${data.file?.name || 'CV'} listo${pages}.`);
    renderCvPreview();
    updateCvContextButton();
    addEvent('system', `CV extraido: ${data.file?.name || file.name}`);
  } catch (error) {
    extractedCv = null;
    setCvStatus(getErrorMessage(error, 'No se pudo extraer el CV.'), 'error');
    updateCvContextButton();
  } finally {
    elements.extractCvButton.disabled = false;
  }
}

function sendCvContextToAgent() {
  if (!conversation || !extractedCv?.text) return;

  const fileName = extractedCv.file?.name || 'CV cargado';
  const context = [
    `CV cargado: ${fileName}`,
    'Usa este texto como contexto para crear o completar el perfil laboral.',
    'No inventes datos. Si falta algo importante, pregunta solo eso.',
    'Texto extraido:',
    extractedCv.text,
  ].join('\n\n');

  conversation.sendContextualUpdate(context, { contextId: 'uploaded_cv' });
  conversation.sendUserMessage(
    'Ya subi mi CV. Resumi lo que encontraste y preguntame solo lo que falte para guardar mi perfil.',
  );
  conversation.sendUserActivity();
  addEvent('system', 'CV enviado al agente.');
}

async function startConversation() {
  if (conversation) return;

  try {
    elements.connectionStatus.textContent = 'Conectando';
    elements.startButton.disabled = true;
    addEvent('system', 'Solicitando acceso al micrófono.');

    await navigator.mediaDevices.getUserMedia({ audio: true });

    conversation = await Conversation.startSession({
      agentId: AGENT_ID,
      connectionType: 'webrtc',
      onConnect: ({ conversationId }) => {
        setConnectedState(true);
        addEvent('system', `Conexión iniciada: ${conversationId}`);
        queueMicrotask(sendIntakeContextToAgent);
      },
      onDisconnect: () => {
        conversation = null;
        setConnectedState(false);
        addEvent('system', 'Conexión finalizada.');
      },
      onError: (error) => {
        const message = getErrorMessage(error, 'Error de conversación.');
        addEvent('error', message);
        elements.connectionStatus.textContent = 'Error';
        elements.startButton.disabled = false;
      },
      onModeChange: (mode) => {
        elements.agentStatus.textContent = mode?.mode === 'speaking' ? 'Hablando' : 'Escuchando';
      },
      onMessage: (message) => {
        if (message?.message) {
          addEvent(message.source === 'user' ? 'user' : 'agent', message.message);
        }
      },
      onAgentToolResponse: () => {
        addEvent('system', 'Perfil procesado por la herramienta de guardado.');
        profilesLoaded = false;
        fetchProfiles();
      },
    });
  } catch (error) {
    conversation = null;
    setConnectedState(false);
    addEvent('error', getErrorMessage(error, 'No se pudo iniciar la conversación.'));
  }
}

async function stopConversation() {
  if (!conversation) return;
  const activeConversation = conversation;
  conversation = null;
  await activeConversation.endSession();
  setConnectedState(false);
}

function toggleMute() {
  if (!conversation) return;
  muted = !muted;
  conversation.setMicMuted(muted);
  updateMuteButton();
  addEvent('system', muted ? 'Micrófono silenciado.' : 'Micrófono activo.');
}

function sendTextMessage(event) {
  event.preventDefault();
  const message = elements.textInput.value.trim();
  if (!message || !conversation) return;

  conversation.sendUserMessage(message);
  conversation.sendUserActivity();
  addEvent('user', message);
  elements.textInput.value = '';
}

elements.startButton.addEventListener('click', startConversation);
elements.stopButton.addEventListener('click', stopConversation);
elements.muteButton.addEventListener('click', toggleMute);
elements.candidateVerifyForm.addEventListener('submit', verifyCandidate);
elements.cvForm.addEventListener('submit', extractCv);
elements.sendCvContextButton.addEventListener('click', sendCvContextToAgent);
elements.textForm.addEventListener('submit', sendTextMessage);
elements.textInput.addEventListener('input', () => conversation?.sendUserActivity());
elements.activityTab.addEventListener('click', () => setPanel('activity'));
elements.intakesTab.addEventListener('click', () => setPanel('intakes'));
elements.profilesTab.addEventListener('click', () => setPanel('profiles'));
elements.refreshProfilesButton.addEventListener('click', fetchProfiles);
elements.intakeForm.addEventListener('submit', createIntake);
elements.copyIntakeUrlButton.addEventListener('click', copyIntakeUrl);

setConnectedState(false);
initializeCandidateRoute();
addEvent('system', `Agente listo: ${AGENT_ID}`);
fetchIntakes();
fetchProfiles();
