import { Conversation } from '@elevenlabs/client';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Briefcase,
  createIcons,
  CheckCircle,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Link,
  LogIn,
  LogOut,
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
  candidateHeader: document.querySelector('#candidateHeader'),
  candidateHeaderTitle: document.querySelector('#candidateHeaderTitle'),
  candidateHeaderStep: document.querySelector('#candidateHeaderStep'),
  candidateMain: document.querySelector('#candidateMain'),
  candidateBottomAction: document.querySelector('#candidateBottomAction'),
  candidatePrimaryActionButton: document.querySelector('#candidatePrimaryActionButton'),
  candidateBottomHint: document.querySelector('#candidateBottomHint'),
  candidateGate: document.querySelector('#candidateGate'),
  candidateGateTitle: document.querySelector('#candidateGateTitle'),
  candidateGateDetail: document.querySelector('#candidateGateDetail'),
  candidateSteps: document.querySelector('#candidateSteps'),
  candidateVerifyStatus: document.querySelector('#candidateVerifyStatus'),
  continueRecommendationsButton: document.querySelector('#continueRecommendationsButton'),
  recommendationsPanel: document.querySelector('#recommendationsPanel'),
  recommendationsSummary: document.querySelector('#recommendationsSummary'),
  recommendationsStatus: document.querySelector('#recommendationsStatus'),
  recommendationsLoading: document.querySelector('#recommendationsLoading'),
  recommendationsMeta: document.querySelector('#recommendationsMeta'),
  recommendationsJobs: document.querySelector('#recommendationsJobs'),
  recommendationsCourses: document.querySelector('#recommendationsCourses'),
  recommendationsTabs: document.querySelector('#recommendationsTabs'),
  recommendationsJobsTab: document.querySelector('#recommendationsJobsTab'),
  recommendationsCoursesTab: document.querySelector('#recommendationsCoursesTab'),
  recommendationsJobsSection: document.querySelector('#recommendationsJobsSection'),
  recommendationsCoursesSection: document.querySelector('#recommendationsCoursesSection'),
  recommendationsGaps: document.querySelector('#recommendationsGaps'),
  refreshRecommendationsButton: document.querySelector('#refreshRecommendationsButton'),
  backToProfileButton: document.querySelector('#backToProfileButton'),
  interviewPanel: document.querySelector('#interviewPanel'),
  interviewTitle: document.querySelector('#interviewTitle'),
  interviewDetail: document.querySelector('#interviewDetail'),
  interviewJobSummary: document.querySelector('#interviewJobSummary'),
  startInterviewButton: document.querySelector('#startInterviewButton'),
  stopInterviewButton: document.querySelector('#stopInterviewButton'),
  muteInterviewButton: document.querySelector('#muteInterviewButton'),
  retryInterviewButton: document.querySelector('#retryInterviewButton'),
  backToRecommendationsButton: document.querySelector('#backToRecommendationsButton'),
  interviewStatus: document.querySelector('#interviewStatus'),
  interviewFeedback: document.querySelector('#interviewFeedback'),
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
  candidateProfileFacts: document.querySelector('#candidateProfileFacts'),
  panelTitle: document.querySelector('#panelTitle'),
  adminAuthPanel: document.querySelector('#adminAuthPanel'),
  adminLoginForm: document.querySelector('#adminLoginForm'),
  adminPasswordInput: document.querySelector('#adminPasswordInput'),
  adminLoginButton: document.querySelector('#adminLoginButton'),
  adminLogoutButton: document.querySelector('#adminLogoutButton'),
  adminAuthStatus: document.querySelector('#adminAuthStatus'),
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
let adminAuthenticated = false;
let candidateSession = getCandidateSessionFromPath();
let candidateView = 'profile';
let candidatePrimaryAction = null;
let candidateAutoEndTimer = null;
let candidateCloseAfterSave = false;
let candidateSaveCompletedAt = 0;
let candidateFinalAgentMessageAt = 0;
let candidateAgentSpeaking = false;
let candidateRecommendations = null;
let recommendationsLoading = false;
let recommendationsTab = 'jobs';
let conversationMode = null;
let activeInterview = null;
let interviewLoading = false;
let interviewStarting = false;
let interviewFeedbackTimer = null;
let interviewAutoEndTimer = null;
let interviewCloseAfterFeedback = false;
let interviewFeedbackCompletedAt = 0;
let interviewFinalAgentMessageAt = 0;
let interviewAgentSpeaking = false;

const noisyMicrophoneThreshold = 0.075;
const veryNoisyMicrophoneThreshold = 0.12;

function getErrorMessage(error, fallback) {
  if (typeof error === 'string') return error;
  return error?.message || fallback;
}

function getVoiceMicrophoneConstraints() {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  const constraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
  };

  if (supported.sampleRate) constraints.sampleRate = { ideal: 16000 };
  if ('voiceIsolation' in supported) constraints.voiceIsolation = true;

  return constraints;
}

async function prepareVoiceMicrophone() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: getVoiceMicrophoneConstraints(),
  });

  try {
    return await measureAmbientNoise(stream);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

async function measureAmbientNoise(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return { level: null, kind: 'unknown' };

  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  const readings = [];
  analyser.fftSize = 1024;
  const samples = new Uint8Array(analyser.fftSize);
  source.connect(analyser);

  try {
    await context.resume();
    const startedAt = Date.now();

    while (Date.now() - startedAt < 900) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;

      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }

      readings.push(Math.sqrt(sum / samples.length));
      await wait(90);
    }
  } finally {
    source.disconnect();
    await context.close().catch(() => {});
  }

  const level =
    readings.length > 0 ? readings.reduce((total, reading) => total + reading, 0) / readings.length : null;

  return {
    level,
    kind:
      level === null
        ? 'unknown'
        : level >= veryNoisyMicrophoneThreshold
          ? 'very_noisy'
          : level >= noisyMicrophoneThreshold
            ? 'noisy'
            : 'ok',
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function describeMicrophoneCheck(check) {
  if (!check || check.kind === 'unknown') return 'Micrófono listo.';
  if (check.kind === 'very_noisy') return 'Hay bastante ruido de fondo; intenta usar audífonos o acercarte al micrófono.';
  if (check.kind === 'noisy') return 'Detecté algo de ruido de fondo; hablar cerca del micrófono ayudará a que no se pause.';
  return 'Micrófono listo con reducción de ruido.';
}

createIcons({
  icons: {
    ArrowLeft,
    ArrowRight,
    BookOpen,
    Briefcase,
    CheckCircle,
    Copy,
    Database,
    ExternalLink,
    FileText,
    Link,
    LogIn,
    LogOut,
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
  elements.startButton.disabled = isConnected || !canStartConversation() || Boolean(activeInterview);
  elements.stopButton.disabled = !isConnected;
  elements.muteButton.disabled = !isConnected;
  elements.textInput.disabled = !isConnected;
  elements.sendButton.disabled = !isConnected;
  updateCvContextButton();
  elements.connectionStatus.textContent = isConnected ? 'Conectado' : 'Desconectado';

  if (isConnected) {
    elements.sessionTitle.textContent = 'Sesión activa';
    elements.sessionDetail.textContent = 'Conversación en curso con TrabajoYA.';
  } else if (candidateSession) {
    updateCandidateSessionCopy();
  } else {
    elements.sessionTitle.textContent = 'Listo para crear un perfil';
    elements.sessionDetail.textContent = 'Perfil laboral en preparación.';
  }

  if (!isConnected) {
    elements.agentStatus.textContent = 'En espera';
    muted = false;
    updateMuteButton();
  }

  updateCandidateRecommendationsButton();
  updateInterviewControls();
  updateCandidatePrimaryAction();
}

function canStartConversation() {
  return !candidateSession || Boolean(candidateSession.intake);
}

function setCandidateView(view) {
  if (!candidateSession) return;

  candidateView = view;
  document.body.dataset.candidateView = view;
  updateCandidateHeader();
  updateCandidatePrimaryAction();
}

function updateCandidateHeader() {
  if (!candidateSession || !elements.candidateHeader) return;

  const viewCopy = {
    loading: ['Preparando perfil', 'Registro'],
    error: ['Enlace no disponible', 'Revisar'],
    profile: ['Completa tu perfil', 'Perfil'],
    saved: ['Perfil guardado', 'Guardado'],
    recommendations: ['Opciones recomendadas', 'Opciones'],
    interview: ['Práctica de entrevista', 'Entrevista'],
    feedback: ['Feedback listo', 'Feedback'],
  };
  const [title, step] = viewCopy[candidateView] || viewCopy.profile;

  elements.candidateHeader.hidden = false;
  elements.candidateHeaderTitle.textContent = title;
  elements.candidateHeaderStep.textContent = step;
}

function setCandidatePrimaryConfig({ action, label, icon, disabled = false, hint = '' }) {
  if (!elements.candidatePrimaryActionButton || !elements.candidateBottomAction) return;

  candidatePrimaryAction = action;
  elements.candidateBottomAction.hidden = !candidateSession;
  elements.candidatePrimaryActionButton.disabled = disabled || !action;
  elements.candidatePrimaryActionButton.dataset.action = action || '';
  elements.candidatePrimaryActionButton.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  elements.candidateBottomHint.textContent = hint;
  elements.candidateBottomHint.hidden = !hint;
  createIcons({ icons: { ArrowRight, Briefcase, CheckCircle, Mic, Play, RefreshCw, Square } });
}

function updateCandidatePrimaryAction() {
  if (!candidateSession || !elements.candidateBottomAction) return;

  const anyConversation = Boolean(conversation);
  const profileDone = isCandidateProfileCompleted();
  const isRecommendationsView = document.body.classList.contains('recommendations-mode');
  const isInterviewView = document.body.classList.contains('interview-mode');

  if (candidateView === 'loading') {
    setCandidatePrimaryConfig({
      action: null,
      label: 'Cargando',
      icon: 'refresh-cw',
      disabled: true,
      hint: 'Estamos validando tu enlace.',
    });
    return;
  }

  if (candidateView === 'error') {
    setCandidatePrimaryConfig({
      action: null,
      label: 'No disponible',
      icon: 'square',
      disabled: true,
      hint: 'Revisa que el enlace esté completo.',
    });
    return;
  }

  if (conversationMode === 'interview' && anyConversation) {
    setCandidatePrimaryConfig({
      action: 'stop-conversation',
      label: 'Detener práctica',
      icon: 'square',
      hint: 'Cuando termine, buscaremos tu feedback.',
    });
    return;
  }

  if (conversationMode === 'profile' && anyConversation) {
    setCandidatePrimaryConfig({
      action: candidateCloseAfterSave ? null : 'stop-conversation',
      label: candidateCloseAfterSave ? 'Guardando perfil' : 'Detener',
      icon: candidateCloseAfterSave ? 'check-circle' : 'square',
      disabled: candidateCloseAfterSave,
      hint: candidateCloseAfterSave
        ? 'Esperando el cierre del agente para no cortar el audio.'
        : 'Habla con calma; el agente irá paso a paso.',
    });
    return;
  }

  if (interviewCloseAfterFeedback) {
    setCandidatePrimaryConfig({
      action: null,
      label: 'Cerrando práctica',
      icon: 'check-circle',
      disabled: true,
      hint: 'El agente está terminando antes de mostrar el feedback.',
    });
    return;
  }

  if (candidateView === 'feedback') {
    setCandidatePrimaryConfig({
      action: activeInterview ? 'retry-interview' : 'back-recommendations',
      label: activeInterview ? 'Repetir práctica' : 'Ver opciones',
      icon: activeInterview ? 'refresh-cw' : 'briefcase',
      disabled: interviewLoading || anyConversation,
      hint: 'Puedes practicar otra vez cuando quieras.',
    });
    return;
  }

  if (candidateView === 'interview' || isInterviewView) {
    if (interviewStarting) {
      setCandidatePrimaryConfig({
        action: null,
        label: 'Conectando',
        icon: 'refresh-cw',
        disabled: true,
        hint: 'Activando micrófono y conectando con el entrevistador.',
      });
      return;
    }

    setCandidatePrimaryConfig({
      action: activeInterview ? 'start-interview' : 'back-recommendations',
      label: interviewLoading ? 'Preparando' : activeInterview ? 'Iniciar práctica' : 'Ver opciones',
      icon: interviewLoading ? 'refresh-cw' : activeInterview ? 'mic' : 'briefcase',
      disabled: interviewLoading || anyConversation || (activeInterview ? false : recommendationsLoading),
      hint: activeInterview ? 'Será una práctica corta de 4 a 6 preguntas.' : 'Elige una vacante para practicar.',
    });
    return;
  }

  if (isRecommendationsView) {
    setCandidatePrimaryConfig({
      action: 'refresh-recommendations',
      label: recommendationsLoading ? 'Buscando' : 'Actualizar opciones',
      icon: 'refresh-cw',
      disabled: recommendationsLoading || !profileDone || anyConversation,
      hint: recommendationsLoading ? 'Esto puede tardar un poco.' : 'Las opciones se actualizan con búsqueda en vivo.',
    });
    return;
  }

  if (profileDone || candidateView === 'saved') {
    setCandidatePrimaryConfig({
      action: 'open-recommendations',
      label: 'Ver recomendaciones',
      icon: 'arrow-right',
      disabled: recommendationsLoading || anyConversation,
      hint: 'Usaremos tu perfil guardado para buscar cursos y empleos.',
    });
    return;
  }

  setCandidatePrimaryConfig({
    action: 'start-profile',
    label: 'Iniciar perfil',
    icon: 'play',
    disabled: !canStartConversation() || anyConversation || Boolean(activeInterview),
    hint: candidateSession.intake?.initial_data?.cv_text
      ? 'Ya tenemos tu contexto inicial y CV.'
      : 'Puedes subir tu CV antes de iniciar si lo tienes.',
  });
}

function handleCandidatePrimaryAction() {
  if (!candidatePrimaryAction) return;

  if (candidatePrimaryAction === 'start-profile') {
    startConversation();
    return;
  }

  if (candidatePrimaryAction === 'stop-conversation') {
    stopConversation();
    return;
  }

  if (candidatePrimaryAction === 'open-recommendations') {
    openCandidateRecommendations();
    return;
  }

  if (candidatePrimaryAction === 'refresh-recommendations') {
    fetchCandidateRecommendations();
    return;
  }

  if (candidatePrimaryAction === 'start-interview') {
    startInterviewConversation();
    return;
  }

  if (candidatePrimaryAction === 'retry-interview') {
    retryInterviewPractice();
    return;
  }

  if (candidatePrimaryAction === 'back-recommendations') {
    backToRecommendationsFromInterview();
  }
}

function setRecommendationsTab(tab) {
  const nextTab = tab === 'courses' ? 'courses' : 'jobs';

  recommendationsTab = nextTab;
  elements.recommendationsPanel?.setAttribute('data-active-tab', nextTab);
  elements.recommendationsJobsTab?.classList.toggle('is-active', nextTab === 'jobs');
  elements.recommendationsCoursesTab?.classList.toggle('is-active', nextTab === 'courses');
  elements.recommendationsJobsTab?.setAttribute('aria-selected', nextTab === 'jobs' ? 'true' : 'false');
  elements.recommendationsCoursesTab?.setAttribute('aria-selected', nextTab === 'courses' ? 'true' : 'false');
  elements.recommendationsJobsSection?.setAttribute('aria-hidden', nextTab === 'jobs' ? 'false' : 'true');
  elements.recommendationsCoursesSection?.setAttribute('aria-hidden', nextTab === 'courses' ? 'false' : 'true');
  createIcons({ icons: { BookOpen, Briefcase } });
}

function scrollCandidateElementIntoView(element) {
  if (!candidateSession || !element || !window.matchMedia('(max-width: 900px)').matches) return;

  window.requestAnimationFrame(() => {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
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

  document.body.classList.add('candidate-mode');
  elements.candidateGate.hidden = false;
  elements.candidateBottomAction.hidden = false;
  elements.candidateGateTitle.textContent = `Código ${candidateSession.code}`;
  elements.candidateGateDetail.textContent = 'Buscando tu registro inicial.';
  elements.panelTitle.textContent = 'Progreso';
  setCandidateVerifyStatus('Cargando registro...');
  setCandidateFlow('link');
  setCandidateView('loading');
  updateCandidateSessionCopy();
  elements.startButton.disabled = true;
  elements.startButton.innerHTML = '<i data-lucide="play"></i><span>Iniciar entrevista</span>';
  elements.stopButton.innerHTML = '<i data-lucide="square"></i><span>Pausar</span>';
  createIcons({ icons: { Play, Square } });
  loadCandidateIntake();
}

function setCandidateVerifyStatus(text, kind = 'neutral') {
  elements.candidateVerifyStatus.textContent = text;
  elements.candidateVerifyStatus.dataset.kind = kind;
}

function isCandidateProfileCompleted() {
  return Boolean(candidateSession?.intake?.status === 'profile_completed' || candidateSession?.intake?.profile_id);
}

function updateCandidateRecommendationsButton() {
  if (!candidateSession || !elements.continueRecommendationsButton) return;

  const canContinue = isCandidateProfileCompleted() && !conversation && !recommendationsLoading;
  elements.continueRecommendationsButton.hidden = !isCandidateProfileCompleted();
  elements.continueRecommendationsButton.disabled = !canContinue;
  elements.continueRecommendationsButton.innerHTML = recommendationsLoading
    ? '<i data-lucide="refresh-cw"></i><span>Buscando</span>'
    : '<i data-lucide="arrow-right"></i><span>Continuar</span>';
  createIcons({ icons: { ArrowRight, RefreshCw } });
  updateCandidatePrimaryAction();
}

function setCandidateRecommendationsView(active) {
  if (!candidateSession) return;

  document.body.classList.toggle('recommendations-mode', active);
  if (!active && activeInterview && !conversation) {
    clearInterviewPanel();
  }
  elements.recommendationsPanel.hidden = !active;
  elements.continueRecommendationsButton.hidden = active || !isCandidateProfileCompleted();
  elements.panelTitle.textContent = active ? 'Recomendaciones' : 'Progreso';

  if (active) {
    setCandidateFlow('recommendations');
    setCandidateView(activeInterview ? 'interview' : 'recommendations');
    elements.sessionTitle.textContent = 'Recomendaciones';
    elements.sessionDetail.textContent = 'Cursos y empleos alineados a tu perfil.';
    return;
  }

  setCandidateFlow(isCandidateProfileCompleted() ? 'saved' : 'context');
  setCandidateView(isCandidateProfileCompleted() ? 'saved' : 'profile');
  updateCandidateSessionCopy();
  updateCandidateRecommendationsButton();
}

function setCandidateFlow(stage) {
  if (!elements.candidateSteps) return;

  const order = ['link', 'context', 'conversation', 'saved', 'recommendations'];
  const activeIndex = order.indexOf(stage);

  for (const item of elements.candidateSteps.querySelectorAll('[data-stage]')) {
    const itemIndex = order.indexOf(item.dataset.stage);
    item.classList.toggle('is-done', activeIndex > itemIndex);
    item.classList.toggle('is-active', activeIndex === itemIndex);
  }
}

function updateCandidateSessionCopy() {
  if (!candidateSession) return;

  const intake = candidateSession.intake;

  if (!intake) {
    elements.sessionTitle.textContent = 'Preparando tu perfil';
    elements.sessionDetail.textContent = 'El enlace se está cargando.';
    elements.candidateProfileFacts.hidden = true;
    elements.candidateProfileFacts.replaceChildren();
    return;
  }

  const name = intake.full_name ? `Perfil de ${intake.full_name}` : 'Construcción de perfil';
  const location = [intake.municipality, intake.department].filter(Boolean).join(', ');

  elements.sessionTitle.textContent = name;
  elements.sessionDetail.textContent = isCandidateProfileCompleted()
    ? 'Tu perfil quedó guardado. Puedes continuar con recomendaciones.'
    : 'TrabajoYA te hará preguntas cortas para completar tu perfil.';
  elements.candidateProfileFacts.hidden = false;
  elements.candidateProfileFacts.replaceChildren(
    createInfoPill('Objetivo', intake.desired_role || 'Por completar'),
    createInfoPill('Ubicación', location || 'Por completar'),
    createInfoPill('CV', intake.initial_data?.cv_text ? 'Recibido' : 'Opcional'),
  );
}

async function loadCandidateIntake() {
  if (!candidateSession) return;

  setCandidateVerifyStatus('Cargando registro...');
  setCandidateFlow('link');
  setCandidateView('loading');

  try {
    const response = await fetch(`${API_BASE_URL}/api/intakes/${candidateSession.code}`);
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo abrir este enlace.');
    }

    candidateSession.intake = data.intake;
    candidateSession.contextSent = false;
    setCandidateFlow(data.intake.status === 'profile_completed' ? 'saved' : 'context');
    setCandidateView(data.intake.status === 'profile_completed' ? 'saved' : 'profile');
    setCandidateVerifyStatus(
      data.intake.status === 'profile_completed'
        ? 'Perfil guardado. Puedes actualizarlo si hace falta.'
        : 'Registro listo. Ya puedes iniciar la entrevista.',
    );
    elements.candidateGateDetail.textContent = data.intake.initial_data?.cv_text
      ? 'Ya tenemos datos iniciales y CV para construir el perfil.'
      : 'Ya tenemos tu registro inicial para construir el perfil.';

    if (data.intake.initial_data?.cv_text) {
      setCvStatus('CV inicial recibido desde el registro.');
    }

    updateCandidateSessionCopy();
    setConnectedState(false);
    updateCandidateRecommendationsButton();
    addEvent('system', `Registro cargado: ${candidateSession.code}`);
  } catch (error) {
    candidateSession.intake = null;
    elements.startButton.disabled = true;
    elements.candidateGateTitle.textContent = 'Enlace no disponible';
    elements.candidateGateDetail.textContent = 'No pudimos cargar el registro asociado a este código.';
    elements.sessionTitle.textContent = 'No se pudo abrir el enlace';
    elements.sessionDetail.textContent = 'Revisa que el código esté completo.';
    setCandidateVerifyStatus(getErrorMessage(error, 'No se pudo abrir este enlace.'), 'error');
    setCandidateView('error');
    addEvent('error', getErrorMessage(error, 'No se pudo abrir este enlace.'));
  }
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
  elements.muteInterviewButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
  elements.muteInterviewButton.innerHTML = muted
    ? '<i data-lucide="mic-off"></i><span>Silenciado</span>'
    : '<i data-lucide="mic"></i><span>Micrófono</span>';
  createIcons({ icons: { Mic, MicOff } });
}

function setPanel(panel) {
  if ((panel === 'intakes' || panel === 'profiles') && !adminAuthenticated) {
    setAdminAuthStatus('Inicia sesión para ver datos internos.', 'error');
    panel = 'activity';
  }

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

function setAdminAuthStatus(text, kind = 'neutral') {
  elements.adminAuthStatus.textContent = text;
  elements.adminAuthStatus.dataset.kind = kind;
}

function setAdminAuthenticated(authenticated) {
  adminAuthenticated = authenticated;
  elements.adminLoginForm.hidden = authenticated;
  elements.adminLogoutButton.hidden = !authenticated;
  elements.intakesTab.disabled = !authenticated;
  elements.profilesTab.disabled = !authenticated;
  elements.refreshProfilesButton.disabled = !authenticated;
  elements.createIntakeButton.disabled = !authenticated;

  if (authenticated) {
    setAdminAuthStatus('Sesión admin activa.');
    intakesLoaded = false;
    profilesLoaded = false;
    fetchIntakes();
    fetchProfiles();
    return;
  }

  elements.intakeCount.textContent = '0';
  elements.profileCount.textContent = '0';
  elements.intakesList.replaceChildren();
  elements.profilesList.replaceChildren();
  setIntakesStatus('Inicia sesión para ver registros.');
  setProfilesStatus('Inicia sesión para ver perfiles.');
}

function handleAuthRequired(response, data) {
  if (response.status === 401 || response.status === 403) {
    setAdminAuthenticated(false);
    throw new Error(data?.error || 'Inicia sesión para continuar.');
  }
}

async function checkAdminSession() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/session`);
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo validar la sesión.');
    }

    setAdminAuthenticated(Boolean(data.authenticated));
    if (!data.configured) {
      setAdminAuthStatus('Configura seguridad admin en Dokploy.', 'error');
    }
  } catch (error) {
    setAdminAuthenticated(false);
    setAdminAuthStatus(getErrorMessage(error, 'No se pudo validar la sesión.'), 'error');
  }
}

async function loginAdmin(event) {
  event.preventDefault();
  elements.adminLoginButton.disabled = true;
  setAdminAuthStatus('Validando...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password: elements.adminPasswordInput.value,
      }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo iniciar sesión.');
    }

    elements.adminPasswordInput.value = '';
    setAdminAuthenticated(true);
  } catch (error) {
    setAdminAuthenticated(false);
    setAdminAuthStatus(getErrorMessage(error, 'No se pudo iniciar sesión.'), 'error');
  } finally {
    elements.adminLoginButton.disabled = false;
  }
}

async function logoutAdmin() {
  elements.adminLogoutButton.disabled = true;

  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
    });
  } finally {
    elements.adminLogoutButton.disabled = false;
    setAdminAuthenticated(false);
    setPanel('activity');
    setAdminAuthStatus('Sesión cerrada.');
  }
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
  if (!adminAuthenticated) {
    setIntakesStatus('Inicia sesión para ver registros.');
    return;
  }

  setIntakesStatus('Cargando registros...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/intakes?limit=30`);
    const data = await response.json().catch(() => null);

    handleAuthRequired(response, data);

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

  if (!adminAuthenticated) {
    setIntakesStatus('Inicia sesión para crear enlaces.', 'error');
    return;
  }

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

    handleAuthRequired(response, data);

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
    elements.createIntakeButton.disabled = !adminAuthenticated;
  }
}

async function copyIntakeUrl() {
  const url = elements.intakeUrlOutput.value;
  if (!url) return;

  await navigator.clipboard?.writeText(url);
  setIntakesStatus('Enlace copiado.');
}

async function fetchProfiles() {
  if (!adminAuthenticated) {
    setProfilesStatus('Inicia sesión para ver perfiles.');
    return;
  }

  elements.refreshProfilesButton.disabled = true;
  setProfilesStatus('Cargando perfiles...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/profiles?limit=30`);
    const data = await response.json().catch(() => null);

    handleAuthRequired(response, data);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo leer Postgres.');
    }

    profilesLoaded = true;
    renderProfiles(data.profiles || []);
  } catch (error) {
    setProfilesStatus(getErrorMessage(error, 'No se pudo cargar la lista de perfiles.'), 'error');
  } finally {
    elements.refreshProfilesButton.disabled = !adminAuthenticated;
  }
}

function setRecommendationsStatus(text, kind = 'neutral') {
  elements.recommendationsStatus.textContent = text;
  elements.recommendationsStatus.dataset.kind = kind;
}

function setRecommendationsLoading(isLoading) {
  recommendationsLoading = isLoading;
  elements.recommendationsLoading.hidden = !isLoading;
  elements.refreshRecommendationsButton.disabled = isLoading || !isCandidateProfileCompleted() || Boolean(conversation);
  elements.backToProfileButton.disabled = Boolean(conversation);
  elements.continueRecommendationsButton.disabled = isLoading || !isCandidateProfileCompleted();
  updateCandidateRecommendationsButton();
}

async function openCandidateRecommendations() {
  if (!candidateSession?.intake) return;

  setCandidateRecommendationsView(true);

  if (candidateRecommendations) {
    renderCandidateRecommendations(candidateRecommendations);
    return;
  }

  await fetchCandidateRecommendations();
}

function closeCandidateRecommendations() {
  setCandidateRecommendationsView(false);
}

async function fetchCandidateRecommendations() {
  if (!candidateSession?.intake || !isCandidateProfileCompleted()) {
    setRecommendationsStatus('El perfil debe estar guardado antes de buscar recomendaciones.', 'error');
    return;
  }

  setRecommendationsLoading(true);
  setRecommendationsStatus('Buscando oportunidades en vivo. Esto puede tardar un poco.');
  elements.recommendationsSummary.textContent = 'Estamos comparando tu perfil con cursos y empleos disponibles.';
  elements.recommendationsMeta.hidden = true;
  elements.recommendationsJobs.replaceChildren();
  elements.recommendationsCourses.replaceChildren();
  elements.recommendationsGaps.replaceChildren();

  try {
    const response = await fetch(`${API_BASE_URL}/api/intakes/${candidateSession.code}/recommendations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        max_results: 5,
      }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudieron generar recomendaciones.');
    }

    candidateRecommendations = data;
    renderCandidateRecommendations(data);
    addEvent('system', data.cached ? 'Recomendaciones cargadas desde historial.' : 'Recomendaciones generadas.');
  } catch (error) {
    candidateRecommendations = null;
    setRecommendationsStatus(getErrorMessage(error, 'No se pudieron generar recomendaciones.'), 'error');
    elements.recommendationsSummary.textContent = 'No pudimos completar la búsqueda. Puedes intentar de nuevo.';
    addEvent('error', getErrorMessage(error, 'No se pudieron generar recomendaciones.'));
  } finally {
    setRecommendationsLoading(false);
  }
}

function renderCandidateRecommendations(data) {
  const jobs = data.recommendations?.jobs || [];
  const courses = data.recommendations?.courses || [];
  const gaps = data.profile_gaps || [];

  elements.recommendationsSummary.textContent =
    data.summary || 'Estas opciones se generaron a partir de tu perfil laboral.';
  setRecommendationsStatus(data.cached ? 'Mostrando la recomendación guardada más reciente.' : 'Recomendaciones listas.');
  renderRecommendationsMeta(data);
  renderRecommendationCards(elements.recommendationsJobs, jobs, 'job');
  renderRecommendationCards(elements.recommendationsCourses, courses, 'course');
  renderRecommendationGaps(gaps);
  setRecommendationsTab(jobs.length === 0 && courses.length > 0 ? 'courses' : recommendationsTab);
  updateCandidatePrimaryAction();
  createIcons({ icons: { ExternalLink, Briefcase, BookOpen, ArrowLeft, RefreshCw, Mic } });
}

function renderRecommendationsMeta(data) {
  const metaItems = [
    data.generated_at ? `Generado: ${formatDate(data.generated_at)}` : '',
    data.cached ? 'Desde historial' : 'Búsqueda nueva',
    data.search?.live_counts
      ? `${data.search.live_counts.jobs || 0} empleos y ${data.search.live_counts.courses || 0} cursos encontrados`
      : '',
  ].filter(Boolean);

  elements.recommendationsMeta.hidden = metaItems.length === 0;
  elements.recommendationsMeta.replaceChildren(
    ...metaItems.map((item) => {
      const span = document.createElement('span');
      span.textContent = item;
      return span;
    }),
  );
}

function renderRecommendationCards(container, items, type) {
  container.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-recommendations';
    empty.textContent =
      type === 'job'
        ? 'No encontramos empleos suficientemente alineados por ahora.'
        : 'No encontramos cursos suficientemente alineados por ahora.';
    container.append(empty);
    return;
  }

  for (const item of items) {
    container.append(createRecommendationCard(item, type));
  }
}

function createRecommendationCard(item, type) {
  const article = document.createElement('article');
  const header = document.createElement('div');
  const title = document.createElement('h4');
  const score = document.createElement('span');
  const meta = document.createElement('div');
  const highlight = document.createElement('p');
  const reasons = createRecommendationList('Por qué encaja', item.reasons);
  const secondary =
    type === 'job'
      ? createRecommendationList('A considerar', item.concerns)
      : createRecommendationList('Refuerza', item.skill_gaps_addressed);
  const details = document.createElement('details');
  const detailsLabel = document.createElement('summary');
  const nextStep = document.createElement('p');
  const link = document.createElement('a');
  const actions = document.createElement('div');
  const scoreValue = Number(item.score || 0);
  const primaryReason = Array.isArray(item.reasons) ? item.reasons.find(Boolean) : '';

  article.className = 'recommendation-card';
  header.className = 'recommendation-card-header';
  title.textContent = item.title || (type === 'job' ? 'Empleo recomendado' : 'Curso recomendado');
  score.className = `score-pill ${getScoreClass(scoreValue)}`;
  score.textContent = `${Math.round(scoreValue)}%`;
  header.append(title, score);

  meta.className = 'recommendation-meta-grid';
  meta.append(
    createInfoPill(type === 'job' ? 'Empresa' : 'Proveedor', type === 'job' ? item.company || getSourceLabel(item.source_url) : item.provider),
    createInfoPill(type === 'job' ? 'Ajuste' : 'Tipo', type === 'job' ? item.fit_level || 'Por revisar' : 'Curso'),
    createInfoPill('Fuente', getSourceLabel(item.source_url)),
  );

  highlight.className = 'recommendation-highlight';
  highlight.textContent =
    primaryReason ||
    (type === 'job'
      ? 'Esta vacante tiene señales compatibles con tu perfil.'
      : 'Este curso puede ayudarte a fortalecer tu perfil.');

  nextStep.className = 'next-step';
  nextStep.textContent = item.next_step ? `Siguiente: ${item.next_step}` : 'Siguiente: revisar la fuente original.';

  details.className = 'recommendation-details';
  detailsLabel.textContent = 'Ver detalles';
  details.append(detailsLabel, reasons, secondary, nextStep);

  link.className = 'source-link';
  link.href = item.source_url || '#';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.innerHTML = '<i data-lucide="external-link"></i><span>Ver fuente</span>';
  if (!item.source_url) {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
  }

  actions.className = 'recommendation-card-actions';

  if (type === 'job' && item.job_id) {
    const practiceButton = document.createElement('button');
    practiceButton.type = 'button';
    practiceButton.className = 'practice-action';
    practiceButton.innerHTML = '<i data-lucide="mic"></i><span>Practicar entrevista</span>';
    practiceButton.addEventListener('click', () => openInterviewPractice(item));
    actions.append(practiceButton);
  }

  actions.append(link);
  article.append(header, meta, highlight, details, actions);
  return article;
}

function createInfoPill(label, value) {
  const pill = document.createElement('span');
  const labelElement = document.createElement('small');
  const valueElement = document.createElement('strong');

  pill.className = 'info-pill';
  labelElement.textContent = label;
  valueElement.textContent = value || 'No indicado';
  pill.append(labelElement, valueElement);
  return pill;
}

function getSourceLabel(url) {
  if (!url) return '';

  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function createRecommendationList(label, values) {
  const wrapper = document.createElement('div');
  const title = document.createElement('strong');
  const list = document.createElement('ul');
  const normalized = Array.isArray(values) ? values.filter(Boolean).slice(0, 4) : [];

  wrapper.className = 'recommendation-points';
  title.textContent = label;

  if (normalized.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Sin observaciones.';
    wrapper.append(title, empty);
    return wrapper;
  }

  for (const value of normalized) {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  }

  wrapper.append(title, list);
  return wrapper;
}

function renderRecommendationGaps(gaps) {
  elements.recommendationsGaps.replaceChildren();

  if (!gaps.length) {
    const item = document.createElement('span');
    item.textContent = 'Perfil suficientemente claro para recomendar.';
    elements.recommendationsGaps.append(item);
    return;
  }

  for (const gap of gaps.slice(0, 8)) {
    const item = document.createElement('span');
    item.textContent = gap;
    elements.recommendationsGaps.append(item);
  }
}

function getScoreClass(score) {
  if (score >= 80) return 'is-high';
  if (score >= 60) return 'is-mid';

  return 'is-low';
}

function setInterviewStatus(text, kind = 'neutral') {
  elements.interviewStatus.textContent = text;
  elements.interviewStatus.dataset.kind = kind;
}

function clearInterviewPanel() {
  clearInterviewFeedbackTimer();
  activeInterview = null;
  interviewLoading = false;
  interviewStarting = false;
  document.body.classList.remove('interview-mode');
  elements.interviewPanel.hidden = true;
  elements.interviewTitle.textContent = 'Simulacion de entrevista';
  elements.interviewDetail.textContent = 'Elegí una vacante recomendada para practicar con un entrevistador de voz.';
  elements.interviewJobSummary.replaceChildren();
  elements.interviewFeedback.replaceChildren();
  elements.interviewFeedback.hidden = true;
  setInterviewStatus('Sin iniciar.');
  updateInterviewControls();
  if (candidateSession && document.body.classList.contains('recommendations-mode')) {
    setCandidateView('recommendations');
  }
}

function backToRecommendationsFromInterview() {
  if (conversation) return;
  clearInterviewPanel();
}

function retryInterviewPractice() {
  if (conversation || !activeInterview) return;

  const job = activeInterview.job || {
    job_id: activeInterview.session?.selected_job?.job_id,
  };

  clearInterviewPanel();
  openInterviewPractice(job);
}

async function openInterviewPractice(job) {
  if (!candidateSession?.intake || !candidateRecommendations?.run_id || !job?.job_id) return;

  if (conversation) {
    setInterviewStatus('Detén la conversación actual antes de iniciar una práctica.', 'error');
    return;
  }

  clearInterviewFeedbackTimer();
  interviewLoading = true;
  document.body.classList.add('interview-mode');
  setCandidateView('interview');
  elements.interviewPanel.hidden = false;
  elements.interviewFeedback.hidden = true;
  elements.interviewFeedback.replaceChildren();
  elements.interviewTitle.textContent = 'Preparando práctica';
  elements.interviewDetail.textContent = 'Creando una sesión corta con la vacante seleccionada.';
  elements.interviewJobSummary.replaceChildren();
  setInterviewStatus('Creando sesión de entrevista...', 'loading');
  updateInterviewControls();
  scrollCandidateElementIntoView(elements.interviewPanel);

  try {
    const response = await fetch(`${API_BASE_URL}/api/intakes/${candidateSession.code}/interview-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        job_id: job.job_id,
        recommendation_run_id: candidateRecommendations.run_id,
      }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo crear la práctica.');
    }

    activeInterview = {
      session: data.session,
      sessionId: data.session_id,
      agentId: data.agent_id,
      context: data.context,
      job,
    };
    renderInterviewSession(data.session, data.context);
    setInterviewStatus('Práctica lista. Será breve, de 4 a 6 preguntas.');
    setCandidateView('interview');
    scrollCandidateElementIntoView(elements.interviewPanel);
    addEvent('system', `Práctica preparada: ${data.session_id}`);
  } catch (error) {
    activeInterview = null;
    document.body.classList.remove('interview-mode');
    elements.interviewPanel.hidden = true;
    setInterviewStatus(getErrorMessage(error, 'No se pudo crear la práctica.'), 'error');
    setRecommendationsStatus(getErrorMessage(error, 'No se pudo crear la práctica.'), 'error');
    setCandidateView('recommendations');
    addEvent('error', getErrorMessage(error, 'No se pudo crear la práctica.'));
  } finally {
    interviewLoading = false;
    updateInterviewControls();
  }
}

function renderInterviewSession(session, context = null) {
  const selectedJob = session?.selected_job || context?.selected_job || {};
  const title = selectedJob.title || 'Vacante recomendada';
  const reasons = Array.isArray(selectedJob.reasons) ? selectedJob.reasons.filter(Boolean) : [];
  const primaryReason = reasons[0] || 'La práctica usará esta vacante como contexto principal.';
  const description = [selectedJob.description, reasons.length ? `Match: ${reasons.join(' ')}` : ''].filter(Boolean).join(' ');

  elements.interviewTitle.textContent = title;
  elements.interviewDetail.textContent = 'Práctica corta basada en esta vacante.';
  elements.interviewJobSummary.replaceChildren();

  const metaGrid = document.createElement('div');
  const highlight = document.createElement('p');
  metaGrid.className = 'interview-meta-grid';
  metaGrid.append(
    createInfoPill('Empresa', selectedJob.company || selectedJob.provider),
    createInfoPill('Ubicación', selectedJob.location_text),
    createInfoPill('Modalidad', selectedJob.modality || selectedJob.employment_type),
    createInfoPill('Match', selectedJob.score ? `${Math.round(selectedJob.score)}%` : selectedJob.fit_level),
  );
  highlight.className = 'interview-job-highlight';
  highlight.textContent = primaryReason;
  elements.interviewJobSummary.append(metaGrid, highlight);

  if (description) {
    const details = document.createElement('details');
    const detailsLabel = document.createElement('summary');
    const detailsText = document.createElement('p');

    details.className = 'interview-job-details';
    detailsLabel.textContent = 'Ver detalles de la vacante';
    detailsText.textContent = description;
    details.append(detailsLabel, detailsText);
    elements.interviewJobSummary.append(details);
  }
}

function updateInterviewControls() {
  const interviewSelected = Boolean(activeInterview);
  const interviewConnected = Boolean(conversation && conversationMode === 'interview');
  const anyConversation = Boolean(conversation);

  elements.startInterviewButton.disabled = !interviewSelected || interviewLoading || anyConversation;
  elements.stopInterviewButton.disabled = !interviewConnected;
  elements.muteInterviewButton.disabled = !interviewConnected;
  elements.backToRecommendationsButton.disabled = interviewLoading || anyConversation;
  elements.retryInterviewButton.hidden = !interviewSelected || interviewConnected;
  elements.retryInterviewButton.disabled = interviewLoading || anyConversation;
  elements.refreshRecommendationsButton.disabled = recommendationsLoading || !isCandidateProfileCompleted() || anyConversation;
  elements.backToProfileButton.disabled = anyConversation;
  updateMuteButton();
  updateCandidatePrimaryAction();
}

async function startInterviewConversation() {
  if (!activeInterview || conversation) return;

  try {
    conversationMode = 'interview';
    interviewStarting = true;
    elements.connectionStatus.textContent = 'Conectando';
    elements.startInterviewButton.disabled = true;
    setInterviewStatus('Solicitando acceso al micrófono...', 'loading');
    updateInterviewControls();
    updateCandidatePrimaryAction();
    addEvent('system', 'Solicitando acceso al micrófono para práctica.');

    const microphoneCheck = await prepareVoiceMicrophone();
    const microphoneMessage = describeMicrophoneCheck(microphoneCheck);
    setInterviewStatus(`${microphoneMessage} Conectando con el entrevistador...`, 'loading');
    addEvent('system', microphoneMessage);

    const sessionOptions = {
      agentId: activeInterview.agentId,
      connectionType: 'webrtc',
      preferHeadphonesForIosDevices: true,
      dynamicVariables: buildInterviewDynamicVariables(),
      onConversationCreated: (createdConversation) => {
        conversation = createdConversation;
        setInterviewStatus('Conexión creada. Esperando al entrevistador...', 'loading');
        updateCandidatePrimaryAction();
      },
      onConnect: ({ conversationId }) => {
        interviewStarting = false;
        setConnectedState(true);
        setInterviewStatus('Entrevista en curso. Responde como si fuera con el empleador.');
        activeInterview.conversationId = conversationId;
        addEvent('system', `Práctica iniciada: ${conversationId}`);
        window.setTimeout(() => sendInterviewContext(conversationId), 700);
      },
      onDisconnect: (details) => {
        clearInterviewAutoEndTimer();
        interviewStarting = false;
        conversation = null;
        conversationMode = null;
        setConnectedState(false);
        setInterviewStatus('Conexión finalizada. Esperando feedback...');
        addEvent('system', `Práctica finalizada${formatDisconnectDetails(details)}.`);
        scheduleInterviewFeedbackPoll(1000);
      },
      onError: (error) => {
        const message = getErrorMessage(error, 'Error de entrevista.');
        clearInterviewAutoEndTimer();
        interviewStarting = false;
        conversation = null;
        conversationMode = null;
        setConnectedState(false);
        setInterviewStatus(message, 'error');
        addEvent('error', message);
      },
      onModeChange: (mode) => {
        interviewAgentSpeaking = mode?.mode === 'speaking';
        elements.agentStatus.textContent = interviewAgentSpeaking ? 'Entrevistando' : 'Escuchando';

        if (interviewCloseAfterFeedback && !interviewAgentSpeaking) {
          scheduleInterviewAutoEndCheck(2200);
        }
      },
      onMessage: (message) => {
        if (message?.message) {
          if (interviewCloseAfterFeedback && (message.role === 'agent' || message.source !== 'user')) {
            interviewFinalAgentMessageAt = Date.now();
            scheduleInterviewAutoEndCheck(3200);
          }

          addEvent(message.source === 'user' ? 'user' : 'agent', message.message);
        }
      },
      onAgentToolResponse: (toolResponse) => {
        setInterviewStatus('Feedback recibido del agente. Guardando...');
        addEvent('system', 'El agente envió feedback de entrevista.');
        scheduleInterviewFeedbackPoll(700);
        if (isInterviewFeedbackToolResponse(toolResponse)) {
          requestInterviewConversationEnd();
        }
      },
    };

    conversation = await Conversation.startSession(sessionOptions);
  } catch (error) {
    conversation = null;
    conversationMode = null;
    interviewStarting = false;
    setConnectedState(false);
    setInterviewStatus(getErrorMessage(error, 'No se pudo iniciar la práctica.'), 'error');
    addEvent('error', getErrorMessage(error, 'No se pudo iniciar la práctica.'));
  }
}

function isInterviewFeedbackToolResponse(toolResponse) {
  const toolName = String(toolResponse?.tool_name || toolResponse?.toolName || toolResponse?.name || '').trim();

  return !toolName || toolName === 'save_interview_feedback';
}

function requestInterviewConversationEnd() {
  if (!conversation || conversationMode !== 'interview' || interviewCloseAfterFeedback) return;

  interviewCloseAfterFeedback = true;
  interviewFeedbackCompletedAt = Date.now();
  interviewFinalAgentMessageAt = 0;
  setInterviewStatus('Feedback guardado. Esperando despedida del agente...');
  addEvent('system', 'Feedback recibido; cerraré la práctica cuando el agente termine de hablar.');
  sendInterviewClosureInstruction();
  scheduleInterviewAutoEndCheck(16000);
}

function sendInterviewClosureInstruction() {
  if (!conversation || !activeInterview?.sessionId) return;

  conversation.sendContextualUpdate(
    [
      'El feedback de la simulacion ya fue guardado.',
      'No hagas mas preguntas ni agregues nuevas recomendaciones.',
      'Despídete en una sola frase breve y termina la llamada.',
    ].join(' '),
    { contextId: `interview_feedback_saved_${activeInterview.sessionId}` },
  );
}

function scheduleInterviewAutoEndCheck(delayMs = 2500) {
  if (interviewAutoEndTimer) {
    window.clearTimeout(interviewAutoEndTimer);
  }

  interviewAutoEndTimer = window.setTimeout(evaluateInterviewConversationEnd, delayMs);
}

async function evaluateInterviewConversationEnd() {
  interviewAutoEndTimer = null;

  if (!conversation || conversationMode !== 'interview' || !interviewCloseAfterFeedback) return;

  const now = Date.now();
  const hasFinalAgentMessage = interviewFinalAgentMessageAt > interviewFeedbackCompletedAt;
  const finalMessageSettled = hasFinalAgentMessage && now - interviewFinalAgentMessageAt >= 2500;
  const fallbackElapsed = now - interviewFeedbackCompletedAt >= 16000;

  if (!interviewAgentSpeaking && (finalMessageSettled || fallbackElapsed)) {
    interviewCloseAfterFeedback = false;
    await stopConversation();
    setInterviewStatus('Entrevista finalizada. Esperando feedback...');
    return;
  }

  scheduleInterviewAutoEndCheck(interviewAgentSpeaking ? 2200 : 1200);
}

function clearInterviewAutoEndTimer() {
  interviewCloseAfterFeedback = false;
  interviewFeedbackCompletedAt = 0;
  interviewFinalAgentMessageAt = 0;
  interviewAgentSpeaking = false;

  if (!interviewAutoEndTimer) return;

  window.clearTimeout(interviewAutoEndTimer);
  interviewAutoEndTimer = null;
}

function buildInterviewDynamicVariables() {
  if (!activeInterview?.context) return undefined;

  return {
    interview_session_id: activeInterview.sessionId,
    intake_code: candidateSession?.code || '',
    candidate_profile_summary: activeInterview.context.profile_summary || '',
    selected_job_summary: activeInterview.context.job_summary || '',
    selected_job_title: activeInterview.context.selected_job?.title || '',
    selected_job_company: activeInterview.context.selected_job?.company || '',
  };
}

function sendInterviewContext(conversationId) {
  if (!conversation || !activeInterview?.context) return;

  const context = [
    'CONTEXTO PARA SIMULACION DE ENTREVISTA. No leas este bloque en voz alta.',
    `interview_session_id: ${activeInterview.sessionId}`,
    `elevenlabs_conversation_id: ${conversationId || ''}`,
    'Perfil del candidato:',
    activeInterview.context.profile_summary || 'Perfil no resumido.',
    'Vacante elegida:',
    activeInterview.context.job_summary || 'Vacante no resumida.',
    'Instrucciones:',
    activeInterview.context.instructions,
    'Al finalizar, llama save_interview_feedback con interview_session_id, elevenlabs_conversation_id, scores y feedback.',
    'Despues de guardar feedback, despídete en una frase breve y termina la llamada. No hagas mas preguntas.',
  ]
    .filter(Boolean)
    .join('\n');

  conversation.sendContextualUpdate(context, {
    contextId: `interview_${activeInterview.sessionId}`,
  });
  addEvent('system', 'Contexto de práctica enviado al agente.');
}

function scheduleInterviewFeedbackPoll(delayMs = 2500) {
  clearInterviewFeedbackTimer();
  interviewFeedbackTimer = window.setTimeout(() => pollInterviewFeedback({ repeat: true }), delayMs);
}

function clearInterviewFeedbackTimer() {
  if (!interviewFeedbackTimer) return;

  window.clearTimeout(interviewFeedbackTimer);
  interviewFeedbackTimer = null;
}

async function pollInterviewFeedback({ repeat = false } = {}) {
  clearInterviewFeedbackTimer();

  if (!activeInterview?.sessionId || !candidateSession?.code) return;

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/intakes/${candidateSession.code}/interview-sessions/${activeInterview.sessionId}`,
    );
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.error || 'No se pudo leer el feedback.');
    }

    activeInterview.session = data.session;

    if (data.session.status === 'completed') {
      renderInterviewFeedback(data.session);
      setInterviewStatus('Feedback listo.');
      setCandidateView('feedback');
      addEvent('system', 'Feedback de entrevista guardado.');
      updateInterviewControls();
      return;
    }

    if (data.session.status === 'failed') {
      setInterviewStatus('La simulación terminó con error al guardar feedback.', 'error');
      updateInterviewControls();
      return;
    }

    if (repeat) {
      setInterviewStatus('Esperando feedback del agente...');
      scheduleInterviewFeedbackPoll(3000);
    }
  } catch (error) {
    setInterviewStatus(getErrorMessage(error, 'No se pudo leer el feedback.'), 'error');
    addEvent('error', getErrorMessage(error, 'No se pudo leer el feedback.'));
  }
}

function renderInterviewFeedback(session) {
  const feedback = session.feedback || {};
  const scores = session.scores || {};
  const overall = Number(feedback.overall_score || scores.overall || 0);
  const title = document.createElement('div');
  const heading = document.createElement('h4');
  const score = document.createElement('span');
  const summary = document.createElement('p');

  elements.interviewFeedback.replaceChildren();
  elements.interviewFeedback.hidden = false;
  title.className = 'interview-feedback-title';
  heading.textContent = 'Feedback de práctica';
  score.className = `score-pill ${getScoreClass(overall)}`;
  score.textContent = `${Math.round(overall)}%`;
  title.append(heading, score);
  elements.interviewFeedback.append(title);

  if (feedback.summary) {
    summary.textContent = feedback.summary;
    elements.interviewFeedback.append(summary);
  }

  elements.interviewFeedback.append(
    createFeedbackList('Fortalezas', feedback.strengths),
    createFeedbackList('Mejoras', feedback.improvements),
    createFeedbackList('Respuestas sugeridas', feedback.suggested_answers),
    createFeedbackList('Próximos pasos', feedback.next_steps),
  );
  setCandidateView('feedback');
  scrollCandidateElementIntoView(elements.interviewFeedback);
}

function createFeedbackList(label, values) {
  const block = document.createElement('div');
  const title = document.createElement('strong');
  const list = document.createElement('ul');
  const normalized = Array.isArray(values) ? values.filter(Boolean).slice(0, 5) : [];

  block.className = 'feedback-list';
  title.textContent = label;

  if (normalized.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Sin observaciones.';
    block.append(title, empty);
    return block;
  }

  for (const value of normalized) {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  }

  block.append(title, list);
  return block;
}

function limitAgentContextText(text, maxLength = 2200) {
  const value = String(text || '').trim();

  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength)}\n\n[Texto recortado para iniciar la conversacion. Si falta algo importante, preguntalo.]`;
}

function buildIntakeContext(intake) {
  const initialData = intake.initial_data || {};
  const cvText = limitAgentContextText(initialData.cv_text || '', 1200);

  return [
    'CONTEXTO INICIAL DEL CANDIDATO. No leas este bloque completo en voz alta; usalo para guiar la conversacion.',
    `Registro inicial TrabajoYA: ${intake.code}`,
    `intake_code: ${intake.code}`,
    `Telefono registrado: ${intake.phone || 'No visible en la interfaz'}`,
    `Nombre inicial: ${intake.full_name || 'No indicado'}`,
    `Municipio: ${intake.municipality || 'No indicado'}`,
    `Departamento: ${intake.department || 'No indicado'}`,
    `Puesto buscado: ${intake.desired_role || 'No indicado'}`,
    initialData.notes ? `Notas iniciales: ${initialData.notes}` : '',
    cvText
      ? `CV o perfil previo enviado por WhatsApp:\n${cvText}`
      : 'No hay CV previo registrado para este enlace.',
    'Instrucciones:',
    '- Arranca demostrando que ya conoces estos datos iniciales.',
    '- Usa modo entrevista breve: pregunta solo un dato por turno.',
    '- Si faltan varios datos, elige el siguiente mas importante y espera respuesta antes de continuar.',
    '- Orden sugerido: nombre, ubicacion, objetivo laboral, experiencia principal, disponibilidad, habilidades, estudios/cursos.',
    '- No hagas listas largas de preguntas. Evita frases como "decime nombre, edad, experiencia y estudios".',
    '- Confirma o completa solo lo que falte para guardar el perfil laboral.',
    '- Cuando guardes el perfil final, incluye este intake_code en el payload de la herramienta.',
    '- Despues de guardar el perfil, despídete en una frase corta. La interfaz cerrara la llamada automaticamente.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCandidateDynamicVariables() {
  const intake = candidateSession?.intake;

  if (!intake) return undefined;

  const initialData = intake.initial_data || {};

  return {
    intake_code: intake.code,
    candidate_name: intake.full_name || '',
    candidate_phone: intake.phone || '',
    candidate_municipality: intake.municipality || '',
    candidate_department: intake.department || '',
    candidate_desired_role: intake.desired_role || '',
    candidate_notes: initialData.notes || '',
    candidate_cv_text: limitAgentContextText(initialData.cv_text || '', 1800),
  };
}

function sendInitialIntakeContext() {
  if (!conversation || !candidateSession?.intake || candidateSession.contextSent) return;

  const intake = candidateSession.intake;
  conversation.sendContextualUpdate(buildIntakeContext(intake), {
    contextId: `intake_${intake.code}`,
  });
  candidateSession.contextSent = true;
  setCandidateFlow('conversation');
  setCandidateView('profile');
  addEvent(
    'system',
    intake.initial_data?.cv_text
      ? 'Contexto inicial y CV enviados al agente.'
      : 'Contexto inicial enviado al agente.',
  );
}

function isProfileSaveToolResponse(toolResponse) {
  const toolName = String(toolResponse?.tool_name || toolResponse?.toolName || toolResponse?.name || '').trim();

  return !toolName || toolName === 'create_candidate_profile';
}

function requestCandidateConversationEnd() {
  if (!candidateSession?.intake || candidateCloseAfterSave) return;

  candidateSession.intake.status = 'profile_completed';
  sendPostSaveClosureInstruction();
  candidateCloseAfterSave = true;
  candidateSaveCompletedAt = Date.now();
  candidateFinalAgentMessageAt = 0;
  setCandidateFlow('saved');
  setCandidateView('saved');
  setCandidateVerifyStatus('Perfil guardado. Esperando despedida del agente...');
  elements.sessionDetail.textContent = 'Perfil guardado. La sesión se cerrará cuando el agente termine de hablar.';
  addEvent('system', 'Perfil guardado; esperaré a que el agente termine de hablar.');
  updateCandidateRecommendationsButton();
  scheduleCandidateAutoEndCheck(22000);
}

function sendPostSaveClosureInstruction() {
  if (!conversation || !candidateSession?.intake) return;

  conversation.sendContextualUpdate(
    [
      'El perfil ya fue guardado correctamente.',
      'No hagas mas preguntas ni intentes completar disponibilidad, cursos, estudios, telefono, correo o experiencia.',
      'No digas "quieres que agreguemos" ni ofrezcas agregar datos al perfil.',
      'Solo confirma que el perfil quedo guardado y despídete en una frase breve.',
    ].join(' '),
    { contextId: `profile_saved_${candidateSession.intake.code}` },
  );
}

function scheduleCandidateAutoEndCheck(delayMs = 2500) {
  if (candidateAutoEndTimer) {
    window.clearTimeout(candidateAutoEndTimer);
  }

  candidateAutoEndTimer = window.setTimeout(evaluateCandidateConversationEnd, delayMs);
}

async function evaluateCandidateConversationEnd() {
  candidateAutoEndTimer = null;

  if (!conversation || !candidateCloseAfterSave) return;

  const now = Date.now();
  const hasFinalAgentMessage = candidateFinalAgentMessageAt > candidateSaveCompletedAt;
  const finalMessageSettled = hasFinalAgentMessage && now - candidateFinalAgentMessageAt >= 3500;
  const fallbackElapsed = now - candidateSaveCompletedAt >= 22000;

  if (!candidateAgentSpeaking && (finalMessageSettled || fallbackElapsed)) {
    candidateCloseAfterSave = false;
    await stopConversation();
    setCandidateVerifyStatus('Perfil guardado. Conversación finalizada.');
    elements.sessionTitle.textContent = 'Perfil completado';
    elements.sessionDetail.textContent = 'Gracias. El perfil quedó guardado correctamente. Puedes continuar.';
    setCandidateView('saved');
    updateCandidateRecommendationsButton();
    return;
  }

  scheduleCandidateAutoEndCheck(candidateAgentSpeaking ? 2500 : 1500);
}

function clearCandidateAutoEndTimer() {
  candidateCloseAfterSave = false;
  candidateSaveCompletedAt = 0;
  candidateFinalAgentMessageAt = 0;
  candidateAgentSpeaking = false;

  if (!candidateAutoEndTimer) return;

  window.clearTimeout(candidateAutoEndTimer);
  candidateAutoEndTimer = null;
}

function formatDisconnectDetails(details) {
  if (!details?.reason) return '';

  const reason = details.reason === 'agent' ? 'agente' : details.reason === 'user' ? 'usuario' : 'error';
  const message = details.message ? `: ${details.message}` : '';
  const closeReason = details.closeReason ? ` (${details.closeReason})` : '';

  return ` (${reason}${message}${closeReason})`;
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
    'No inventes datos. Si falta algo importante, pregunta solo un dato por turno.',
    'Evita pedir listas de informacion; guia la entrevista paso a paso.',
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
    conversationMode = 'profile';
    elements.connectionStatus.textContent = 'Conectando';
    elements.startButton.disabled = true;
    addEvent('system', 'Solicitando acceso al micrófono.');

    const microphoneCheck = await prepareVoiceMicrophone();
    addEvent('system', describeMicrophoneCheck(microphoneCheck));

    const sessionOptions = {
      agentId: AGENT_ID,
      connectionType: 'webrtc',
      preferHeadphonesForIosDevices: true,
      onConversationCreated: (createdConversation) => {
        conversation = createdConversation;
      },
      onConnect: ({ conversationId }) => {
        setConnectedState(true);
        addEvent('system', `Conexión iniciada: ${conversationId}`);
        window.setTimeout(sendInitialIntakeContext, 700);
      },
      onDisconnect: (details) => {
        clearCandidateAutoEndTimer();
        conversation = null;
        conversationMode = null;
        setConnectedState(false);
        addEvent('system', `Conexión finalizada${formatDisconnectDetails(details)}.`);
      },
      onError: (error) => {
        const message = getErrorMessage(error, 'Error de conversación.');
        conversationMode = null;
        addEvent('error', message);
        elements.connectionStatus.textContent = 'Error';
        elements.startButton.disabled = false;
      },
      onModeChange: (mode) => {
        candidateAgentSpeaking = mode?.mode === 'speaking';
        elements.agentStatus.textContent = candidateAgentSpeaking ? 'Hablando' : 'Escuchando';

        if (candidateCloseAfterSave && !candidateAgentSpeaking) {
          scheduleCandidateAutoEndCheck(2500);
        }
      },
      onMessage: (message) => {
        if (message?.message) {
          if (candidateCloseAfterSave && (message.role === 'agent' || message.source !== 'user')) {
            candidateFinalAgentMessageAt = Date.now();
            scheduleCandidateAutoEndCheck(4500);
          }

          addEvent(message.source === 'user' ? 'user' : 'agent', message.message);
        }
      },
      onAgentToolResponse: (toolResponse) => {
        addEvent('system', 'Perfil procesado por la herramienta de guardado.');
        profilesLoaded = false;
        if (adminAuthenticated) {
          fetchProfiles();
        }
        if (candidateSession?.intake && isProfileSaveToolResponse(toolResponse)) {
          requestCandidateConversationEnd();
        }
      },
    };

    if (candidateSession?.intake) {
      candidateSession.contextSent = false;
      sessionOptions.dynamicVariables = buildCandidateDynamicVariables();
    }

    conversation = await Conversation.startSession(sessionOptions);
  } catch (error) {
    conversation = null;
    conversationMode = null;
    setConnectedState(false);
    addEvent('error', getErrorMessage(error, 'No se pudo iniciar la conversación.'));
  }
}

async function stopConversation() {
  if (!conversation) return;
  clearCandidateAutoEndTimer();
  clearInterviewAutoEndTimer();
  const activeConversation = conversation;
  const previousMode = conversationMode;
  conversation = null;
  conversationMode = null;
  await activeConversation.endSession();
  setConnectedState(false);
  if (previousMode === 'interview') {
    setInterviewStatus('Conexión finalizada. Esperando feedback...');
    scheduleInterviewFeedbackPoll(1000);
  }
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
elements.adminLoginForm.addEventListener('submit', loginAdmin);
elements.adminLogoutButton.addEventListener('click', logoutAdmin);
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
elements.candidatePrimaryActionButton.addEventListener('click', handleCandidatePrimaryAction);
elements.continueRecommendationsButton.addEventListener('click', openCandidateRecommendations);
elements.refreshRecommendationsButton.addEventListener('click', fetchCandidateRecommendations);
elements.backToProfileButton.addEventListener('click', closeCandidateRecommendations);
elements.recommendationsJobsTab.addEventListener('click', () => setRecommendationsTab('jobs'));
elements.recommendationsCoursesTab.addEventListener('click', () => setRecommendationsTab('courses'));
elements.startInterviewButton.addEventListener('click', startInterviewConversation);
elements.stopInterviewButton.addEventListener('click', stopConversation);
elements.muteInterviewButton.addEventListener('click', toggleMute);
elements.retryInterviewButton.addEventListener('click', retryInterviewPractice);
elements.backToRecommendationsButton.addEventListener('click', backToRecommendationsFromInterview);

setRecommendationsTab('jobs');
setConnectedState(false);
initializeCandidateRoute();
addEvent('system', `Agente listo: ${AGENT_ID}`);
checkAdminSession();
