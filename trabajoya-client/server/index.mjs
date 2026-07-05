import express from 'express';
import multer from 'multer';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const envPath = join(rootDir, '.env.local');

loadEnvFile(envPath);

const app = express();
const port = Number(process.env.API_PORT || 8787);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const maxCvTextLength = 12000;
const defaultRecommendationMaxResults = 5;
const defaultRecommendationMaxCourses = 3;
const maxRecommendationMaxResults = 10;
const recommendationPreRankLimit = 20;
const defaultMatchCooldownSeconds = 60;
const exaSearchTimeoutMs = 25000;
const openAiMatchTimeoutMs = 45000;
const defaultVoiceFeedbackTimeoutMs = 12000;
const defaultVoiceFeedbackMaxChars = 700;
const defaultVoiceFeedbackMessageText = '{recommendations}';
const defaultExaJobFreshDays = 45;
const defaultExaJobMaxAgeHours = 6;
const adminCookieName = 'trabajoya_admin';
const adminSessionTtlSeconds = 60 * 60 * 8;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});
let pool;

app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trabajoya-Key');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  next();
});

app.get('/api/auth/session', (request, response) => {
  response.json({
    ok: true,
    authenticated: isAdminRequest(request),
    configured: isAdminAuthConfigured(),
  });
});

app.post('/api/auth/login', (request, response) => {
  const adminPassword = getAdminPassword();

  if (!isAdminAuthConfigured()) {
    response.status(503).json({
      ok: false,
      error: 'Configura TRABAJOYA_ADMIN_PASSWORD y TRABAJOYA_SESSION_SECRET en Dokploy.',
    });
    return;
  }

  if (!timingSafeTextEqual(cleanText(request.body.password), adminPassword)) {
    response.status(401).json({
      ok: false,
      error: 'Clave admin incorrecta.',
    });
    return;
  }

  setAdminSessionCookie(response);
  response.json({
    ok: true,
    authenticated: true,
  });
});

app.post('/api/auth/logout', (_request, response) => {
  clearAdminSessionCookie(response);
  response.json({
    ok: true,
    authenticated: false,
  });
});

app.post('/api/intakes', requireIntakeCreator, async (request, response) => {
  try {
    const db = getPool();
    const phone = normalizePhoneSV(request.body.phone);
    const code = await createUniqueCode(db);
    const initialData = buildInitialData(request.body);
    const result = await db.query(
      `
      insert into public.candidate_intakes (
        code,
        phone_e164,
        phone_last4,
        full_name,
        email,
        municipality,
        department,
        desired_role,
        source,
        initial_data
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
      `,
      [
        code,
        phone,
        phone.slice(-4),
        cleanText(request.body.full_name),
        cleanText(request.body.email),
        cleanText(request.body.municipality),
        cleanText(request.body.department),
        cleanText(request.body.desired_role),
        cleanText(request.body.source) || 'manual',
        initialData,
      ],
    );
    const intake = result.rows[0];

    response.status(201).json({
      ok: true,
      intake: serializeIntake(intake),
      code: intake.code,
      url: buildIntakeUrl(request, intake.code),
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/intakes', requireAdminSession, async (request, response) => {
  const limit = clampNumber(Number(request.query.limit || 25), 1, 100);

  try {
    const db = getPool();
    const result = await db.query(
      `
      select *
      from public.candidate_intakes
      order by created_at desc
      limit $1
      `,
      [limit],
    );

    response.json({
      ok: true,
      intakes: result.rows.map(serializeIntake),
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/intakes/:code', async (request, response) => {
  try {
    const db = getPool();
    const code = normalizeCode(request.params.code);
    const result = await db.query(
      `
      update public.candidate_intakes
      set
        last_accessed_at = now(),
        status = case when status = 'pending' then 'opened' else status end
      where code = $1
      returning *
      `,
      [code],
    );

    if (result.rowCount === 0) {
      response.status(404).json({
        ok: false,
        error: 'Codigo no encontrado.',
      });
      return;
    }

    response.json({
      ok: true,
      intake: serializeIntake(result.rows[0], { includeCvText: true }),
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/intakes/:code/verify', async (request, response) => {
  try {
    const db = getPool();
    const code = normalizeCode(request.params.code);
    const phone = normalizePhoneSV(request.body.phone);
    const result = await db.query(
      `
      update public.candidate_intakes
      set
        last_accessed_at = now(),
        status = case when status = 'pending' then 'opened' else status end
      where code = $1 and phone_e164 = $2
      returning *
      `,
      [code, phone],
    );

    if (result.rowCount === 0) {
      response.status(404).json({
        ok: false,
        error: 'Codigo o telefono no coinciden.',
      });
      return;
    }

    response.json({
      ok: true,
      intake: serializeIntake(result.rows[0], { includePhone: true, includeCvText: true }),
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/candidate-profiles', async (request, response) => {
  try {
    const saved = await saveCandidateProfile(request.body);

    response.status(saved.created ? 201 : 200).json({
      ok: true,
      candidate_id: saved.profile.id,
      intake_code: saved.intake?.code || null,
      message: 'Perfil guardado correctamente. No hagas mas preguntas; despídete brevemente.',
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/intakes/:code/recommendations', async (request, response) => {
  try {
    const db = getPool();
    const code = normalizeCode(request.params.code);
    const maxResults = getRecommendationMaxResults(request.body);
    const maxCourses = getRecommendationMaxCourses(request.body, maxResults);
    const { intake, profile } = await findIntakeProfileByCode(db, code);

    if (!intake) {
      response.status(404).json({
        ok: false,
        error: 'Codigo no encontrado.',
      });
      return;
    }

    if (!profile) {
      response.status(409).json({
        ok: false,
        error: 'Este registro aun no tiene un perfil confirmado.',
      });
      return;
    }

    const cachedRun = await findFreshRecommendationRun(db, {
      intakeId: intake.id,
      profileId: profile.id,
    });

    if (cachedRun) {
      response.json(serializeRecommendationRun(cachedRun, { cached: true }));
      return;
    }

    const run = await createProfileRecommendations(db, {
      intake,
      profile,
      requestedBy: 'candidate',
      maxResults,
      maxCourses,
    });

    response.json(serializeRecommendationRun(run, { cached: false }));
  } catch (error) {
    response.status(getRecommendationErrorStatus(error)).json({
      ok: false,
      run_id: error.recommendationRunId || null,
      error: getPublicError(error),
    });
  }
});

app.get('/api/intakes/:code/recommendations/latest', async (request, response) => {
  try {
    const db = getPool();
    const code = normalizeCode(request.params.code);
    const { intake, profile } = await findIntakeProfileByCode(db, code);

    if (!intake) {
      response.status(404).json({
        ok: false,
        error: 'Codigo no encontrado.',
      });
      return;
    }

    if (!profile) {
      response.status(409).json({
        ok: false,
        error: 'Este registro aun no tiene un perfil confirmado.',
      });
      return;
    }

    const run = await findLatestRecommendationRunForIntake(db, intake.id);

    if (!run) {
      response.status(404).json({
        ok: false,
        error: 'Aun no hay recomendaciones para este perfil.',
      });
      return;
    }

    response.json(serializeRecommendationRun(run, { cached: true }));
  } catch (error) {
    response.status(getRecommendationErrorStatus(error)).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/intakes/:code/interview-sessions', async (request, response) => {
  try {
    const db = getPool();
    const code = normalizeCode(request.params.code);
    const jobId = normalizeUuid(request.body.job_id || request.body.jobId);
    const recommendationRunId = normalizeOptionalUuid(
      request.body.recommendation_run_id || request.body.recommendationRunId,
    );
    const agentId = getInterviewAgentId();

    if (!agentId) {
      throw new Error('missing_interview_agent_id');
    }

    const { intake, profile } = await findIntakeProfileByCode(db, code);

    if (!intake) {
      response.status(404).json({
        ok: false,
        error: 'Codigo no encontrado.',
      });
      return;
    }

    if (!profile) {
      response.status(409).json({
        ok: false,
        error: 'Este registro aun no tiene un perfil confirmado.',
      });
      return;
    }

    const recommendedJob = await findRecommendedJobForInterview(db, {
      intakeId: intake.id,
      jobId,
      recommendationRunId,
    });

    if (!recommendedJob) {
      response.status(409).json({
        ok: false,
        error: 'La vacante enviada no pertenece a las recomendaciones de este perfil.',
      });
      return;
    }

    const profileSnapshot = buildInterviewProfileSnapshot(profile, intake);
    const selectedJob = buildSelectedInterviewJob(recommendedJob);
    const session = await insertInterviewSession(db, {
      intakeId: intake.id,
      profileId: profile.id,
      recommendationRunId: recommendedJob.run.id,
      jobVacancyId: selectedJob.job_id,
      selectedJob,
      profileSnapshot,
      agentId,
    });

    response.status(201).json({
      ok: true,
      session: serializeInterviewSession(session),
      session_id: session.id,
      agent_id: agentId,
      context: buildInterviewAgentContext({
        session,
        intake,
        profileSnapshot,
        selectedJob,
      }),
    });
  } catch (error) {
    response.status(getInterviewErrorStatus(error)).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/intakes/:code/interview-sessions/latest', async (request, response) => {
  try {
    const db = getPool();
    const code = normalizeCode(request.params.code);
    const { intake, profile } = await findIntakeProfileByCode(db, code);

    if (!intake) {
      response.status(404).json({
        ok: false,
        error: 'Codigo no encontrado.',
      });
      return;
    }

    if (!profile) {
      response.status(409).json({
        ok: false,
        error: 'Este registro aun no tiene un perfil confirmado.',
      });
      return;
    }

    const session = await findLatestInterviewSessionForIntake(db, intake.id);

    if (!session) {
      response.status(404).json({
        ok: false,
        error: 'Aun no hay simulaciones de entrevista para este perfil.',
      });
      return;
    }

    response.json({
      ok: true,
      session: serializeInterviewSession(session),
    });
  } catch (error) {
    response.status(getInterviewErrorStatus(error)).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/intakes/:code/interview-sessions/:sessionId', async (request, response) => {
  try {
    const db = getPool();
    const code = normalizeCode(request.params.code);
    const sessionId = normalizeUuid(request.params.sessionId);
    const { intake, profile } = await findIntakeProfileByCode(db, code);

    if (!intake) {
      response.status(404).json({
        ok: false,
        error: 'Codigo no encontrado.',
      });
      return;
    }

    if (!profile) {
      response.status(409).json({
        ok: false,
        error: 'Este registro aun no tiene un perfil confirmado.',
      });
      return;
    }

    const session = await findInterviewSessionForIntake(db, {
      intakeId: intake.id,
      sessionId,
    });

    if (!session) {
      response.status(404).json({
        ok: false,
        error: 'Simulacion no encontrada para este codigo.',
      });
      return;
    }

    response.json({
      ok: true,
      session: serializeInterviewSession(session),
    });
  } catch (error) {
    response.status(getInterviewErrorStatus(error)).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/interview-feedback', requireInterviewFeedbackWriter, async (request, response) => {
  try {
    const db = getPool();
    const saved = await saveInterviewFeedback(db, request.body);

    scheduleInterviewFeedbackVoice(db, saved);

    response.json({
      ok: true,
      message: 'Feedback guardado.',
      session: serializeInterviewSession(saved),
    });
  } catch (error) {
    response.status(getInterviewErrorStatus(error)).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/profiles/:profileId/recommendations', requireAdminSession, async (request, response) => {
  try {
    const db = getPool();
    const profileId = normalizeUuid(request.params.profileId);
    const maxResults = getRecommendationMaxResults(request.body);
    const maxCourses = getRecommendationMaxCourses(request.body, maxResults);
    const { intake, profile } = await findProfileWithIntakeById(db, profileId);

    if (!profile) {
      response.status(404).json({
        ok: false,
        error: 'Perfil no encontrado.',
      });
      return;
    }

    const cachedRun = await findFreshRecommendationRun(db, {
      intakeId: intake?.id || null,
      profileId: profile.id,
    });

    if (cachedRun) {
      response.json(serializeRecommendationRun(cachedRun, { cached: true }));
      return;
    }

    const run = await createProfileRecommendations(db, {
      intake,
      profile,
      requestedBy: 'admin',
      maxResults,
      maxCourses,
    });

    response.json(serializeRecommendationRun(run, { cached: false }));
  } catch (error) {
    response.status(getRecommendationErrorStatus(error)).json({
      ok: false,
      run_id: error.recommendationRunId || null,
      error: getPublicError(error),
    });
  }
});

app.get('/api/profiles/:profileId/recommendations', requireAdminSession, async (request, response) => {
  try {
    const db = getPool();
    const profileId = normalizeUuid(request.params.profileId);
    const limit = clampNumber(Number(request.query.limit || 10), 1, 50);
    const { profile } = await findProfileWithIntakeById(db, profileId);

    if (!profile) {
      response.status(404).json({
        ok: false,
        error: 'Perfil no encontrado.',
      });
      return;
    }

    const result = await db.query(
      `
      select *
      from public.candidate_recommendation_runs
      where profile_id = $1
      order by created_at desc
      limit $2
      `,
      [profile.id, limit],
    );

    response.json({
      ok: true,
      recommendations: result.rows.map(serializeRecommendationRunListItem),
    });
  } catch (error) {
    response.status(getRecommendationErrorStatus(error)).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/datasets/courses/upsert', requireDatasetWriter, async (request, response) => {
  try {
    const db = getPool();
    const courses = getCoursePayloads(request.body);
    const source = cleanText(request.body.source) || cleanText(request.body.sync?.source) || '';
    const syncMetadata = request.body.sync && typeof request.body.sync === 'object' ? request.body.sync : {};
    const saved = [];

    if (courses.length === 0) {
      response.status(400).json({
        ok: false,
        error: 'Envia al menos un curso en courses.',
      });
      return;
    }

    for (const course of courses.slice(0, 250)) {
      const normalizedCourse = normalizeCoursePayload(course, source);
      const result = await upsertCourse(db, normalizedCourse);
      saved.push(result);
    }

    await recordDatasetSyncRun(db, {
      dataset: 'courses',
      source: source || 'mixed',
      itemsSeen: courses.length,
      itemsUpserted: saved.length,
      metadata: syncMetadata,
    });

    response.json({
      ok: true,
      dataset: 'courses',
      received: courses.length,
      upserted: saved.length,
      courses: saved,
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/datasets/jobs/upsert', requireDatasetWriter, async (request, response) => {
  try {
    const db = getPool();
    const jobs = getJobPayloads(request.body);
    const source = cleanText(request.body.source) || cleanText(request.body.sync?.source) || '';
    const syncMetadata = request.body.sync && typeof request.body.sync === 'object' ? request.body.sync : {};
    const saved = [];

    if (jobs.length === 0) {
      response.status(400).json({
        ok: false,
        error: 'Envia al menos una vacante en jobs.',
      });
      return;
    }

    for (const job of jobs.slice(0, 250)) {
      const normalizedJob = normalizeJobPayload(job, source);
      const result = await upsertJobVacancy(db, normalizedJob);
      saved.push(result);
    }

    await recordDatasetSyncRun(db, {
      dataset: 'jobs',
      source: source || 'mixed',
      itemsSeen: jobs.length,
      itemsUpserted: saved.length,
      metadata: syncMetadata,
    });

    response.json({
      ok: true,
      dataset: 'jobs',
      received: jobs.length,
      upserted: saved.length,
      jobs: saved,
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.post('/api/cv/extract', upload.single('cv'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({
        ok: false,
        error: 'Subi un archivo PDF o TXT.',
      });
      return;
    }

    const extracted = await extractCvText(request.file);

    response.json({
      ok: true,
      file: {
        name: request.file.originalname,
        type: request.file.mimetype,
        size: request.file.size,
        pages: extracted.pages,
      },
      text: extracted.text,
      preview: extracted.text.slice(0, 1200),
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/health', async (_request, response) => {
  try {
    const db = getPool();
    const result = await db.query('select now() as now');
    response.json({ ok: true, database_time: result.rows[0].now });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/profiles', requireAdminSession, async (request, response) => {
  const limit = clampNumber(Number(request.query.limit || 25), 1, 100);

  try {
    const db = getPool();
    const result = await db.query(
      `
      select
        id,
        intake_id,
        full_name,
        email,
        phone,
        municipality,
        department,
        source,
        status,
        profile,
        conversation_summary,
        created_at,
        updated_at
      from public.candidate_profiles
      order by created_at desc
      limit $1
      `,
      [limit],
    );

    response.json({
      ok: true,
      profiles: result.rows,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/courses', requireAdminSession, async (request, response) => {
  const limit = clampNumber(Number(request.query.limit || 50), 1, 200);
  const source = cleanText(request.query.source);
  const status = cleanText(request.query.status || 'active');
  const query = cleanText(request.query.q);
  const filters = [];
  const values = [];

  if (source) {
    values.push(source);
    filters.push(`source = $${values.length}`);
  }

  if (status && status !== 'all') {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }

  if (query) {
    values.push(`%${query}%`);
    filters.push(`(title ilike $${values.length} or provider ilike $${values.length} or description ilike $${values.length})`);
  }

  values.push(limit);

  try {
    const db = getPool();
    const result = await db.query(
      `
      select *
      from public.courses
      ${filters.length > 0 ? `where ${filters.join(' and ')}` : ''}
      order by last_seen_at desc, updated_at desc
      limit $${values.length}
      `,
      values,
    );

    response.json({
      ok: true,
      courses: result.rows,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.get('/api/jobs', requireAdminSession, async (request, response) => {
  const limit = clampNumber(Number(request.query.limit || 50), 1, 200);
  const source = cleanText(request.query.source);
  const status = cleanText(request.query.status || 'active');
  const query = cleanText(request.query.q);
  const department = cleanText(request.query.department);
  const filters = [];
  const values = [];

  if (source) {
    values.push(source);
    filters.push(`source = $${values.length}`);
  }

  if (status && status !== 'all') {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }

  if (department) {
    values.push(department);
    filters.push(`department = $${values.length}`);
  }

  if (query) {
    values.push(`%${query}%`);
    filters.push(
      `(title ilike $${values.length} or company ilike $${values.length} or provider ilike $${values.length} or description ilike $${values.length})`,
    );
  }

  values.push(limit);

  try {
    const db = getPool();
    const result = await db.query(
      `
      select *
      from public.job_vacancies
      ${filters.length > 0 ? `where ${filters.join(' and ')}` : ''}
      order by last_seen_at desc, updated_at desc
      limit $${values.length}
      `,
      values,
    );

    response.json({
      ok: true,
      jobs: result.rows,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: getPublicError(error),
    });
  }
});

app.use((error, _request, response, next) => {
  if (!error) {
    next();
    return;
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({
      ok: false,
      error: 'El archivo supera 8 MB.',
    });
    return;
  }

  response.status(500).json({
    ok: false,
    error: getPublicError(error),
  });
});

const distDir = join(rootDir, 'dist');

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(join(distDir, 'index.html'));
  });
}

const server = app.listen(port, host, () => {
  console.log(`TrabajoYA API lista en http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await pool?.end();
    process.exit(0);
  });
}

async function saveCandidateProfile(body) {
  const db = getPool();
  const profile = body.profile;

  if (!profile || typeof profile !== 'object') {
    throw new Error('missing_profile');
  }

  const personal = profile.personal || {};
  const fullName = cleanText(personal.full_name);

  if (!fullName) {
    throw new Error('missing_full_name');
  }

  const intakeCode = normalizeOptionalCode(
    body.intake_code ||
      body.intakeCode ||
      body.metadata?.intake_code ||
      profile.intake_code ||
      profile.metadata?.intake_code,
  );
  const intake = intakeCode ? await findIntakeByCode(db, intakeCode) : null;
  const phone = cleanText(personal.phone) || intake?.phone_e164 || '';
  const values = [
    intake?.id || null,
    fullName,
    cleanText(personal.email),
    phone,
    cleanText(personal.municipality),
    cleanText(personal.department),
    cleanText(body.source) || 'voice_agent',
    profile,
    cleanText(body.raw_cv_text),
    cleanText(body.conversation_summary),
  ];

  let profileResult;
  let created = true;

  if (intake?.profile_id) {
    created = false;
    profileResult = await db.query(
      `
      update public.candidate_profiles
      set
        intake_id = $1,
        full_name = $2,
        email = $3,
        phone = $4,
        municipality = $5,
        department = $6,
        source = $7,
        profile = $8,
        raw_cv_text = $9,
        conversation_summary = $10
      where id = $11
      returning *
      `,
      [...values, intake.profile_id],
    );
  } else {
    profileResult = await db.query(
      `
      insert into public.candidate_profiles (
        intake_id,
        full_name,
        email,
        phone,
        municipality,
        department,
        source,
        profile,
        raw_cv_text,
        conversation_summary
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
      `,
      values,
    );
  }

  const savedProfile = profileResult.rows[0];

  if (intake) {
    await db.query(
      `
      update public.candidate_intakes
      set
        profile_id = $1,
        status = 'profile_completed',
        completed_at = coalesce(completed_at, now())
      where id = $2
      `,
      [savedProfile.id, intake.id],
    );
  }

  return {
    created,
    profile: savedProfile,
    intake,
  };
}

async function findIntakeByCode(db, code) {
  const result = await db.query('select * from public.candidate_intakes where code = $1', [code]);

  if (result.rowCount === 0) {
    throw new Error('unknown_intake_code');
  }

  return result.rows[0];
}

async function findIntakeProfileByCode(db, code) {
  const result = await db.query(
    `
    select
      i.*,
      row_to_json(p) as profile_row
    from public.candidate_intakes i
    left join public.candidate_profiles p on p.id = i.profile_id
    where i.code = $1
    `,
    [code],
  );

  if (result.rowCount === 0) {
    return {
      intake: null,
      profile: null,
    };
  }

  const row = result.rows[0];
  const { profile_row: profileRow, ...intake } = row;

  return {
    intake,
    profile: profileRow || null,
  };
}

async function findProfileWithIntakeById(db, profileId) {
  const result = await db.query(
    `
    select
      p.*,
      row_to_json(i) as intake_row
    from public.candidate_profiles p
    left join public.candidate_intakes i on i.id = p.intake_id
    where p.id = $1
    `,
    [profileId],
  );

  if (result.rowCount === 0) {
    return {
      intake: null,
      profile: null,
    };
  }

  const row = result.rows[0];
  const { intake_row: intakeRow, ...profile } = row;

  return {
    intake: intakeRow || null,
    profile,
  };
}

async function createProfileRecommendations(db, { intake, profile, requestedBy, maxResults, maxCourses }) {
  const model = getOpenAiMatchModel();
  const profileSnapshot = buildRecommendationProfileSnapshot(profile, intake);
  const searchQueries = buildRecommendationSearchConfigs(profileSnapshot, maxResults);
  let candidates = {
    jobs: [],
    courses: [],
  };

  try {
    if (!getExaApiKey()) {
      throw new Error('missing_exa_api_key');
    }

    if (!getOpenAiApiKey()) {
      throw new Error('missing_openai_api_key');
    }

    const liveCandidates = await fetchLiveRecommendationCandidates(db, {
      searchQueries,
    });
    const rankedCandidates = preRankRecommendationCandidates(liveCandidates, profileSnapshot);
    candidates = {
      jobs: rankedCandidates.jobs,
      courses: rankedCandidates.courses,
    };

    const result =
      candidates.jobs.length === 0 && candidates.courses.length === 0
        ? buildEmptyRecommendationResult()
        : await buildOpenAiRecommendationMatch({
            profileSnapshot,
            candidates,
            maxResults,
            maxCourses,
            model,
          });

    const resultWithSearch = {
      ...result,
      search: {
        jobs_queries: searchQueries.jobs.map(({ query, includeDomains }) => ({ query, include_domains: includeDomains })),
        courses_queries: searchQueries.courses.map(({ query, includeDomains }) => ({ query, include_domains: includeDomains })),
        live_counts: {
          jobs: liveCandidates.jobs.length,
          courses: liveCandidates.courses.length,
        },
        considered_counts: {
          jobs: candidates.jobs.length,
          courses: candidates.courses.length,
        },
      },
    };

    return insertRecommendationRun(db, {
      intakeId: intake?.id || null,
      profileId: profile.id,
      requestedBy,
      status: 'success',
      model,
      profileSnapshot,
      searchQueries,
      candidates,
      result: resultWithSearch,
    });
  } catch (error) {
    const failedRun = await insertRecommendationRun(db, {
      intakeId: intake?.id || null,
      profileId: profile.id,
      requestedBy,
      status: 'failed',
      model,
      profileSnapshot,
      searchQueries,
      candidates,
      result: {},
      error: getPublicError(error),
    });

    error.recommendationRunId = failedRun.id;
    throw error;
  }
}

async function findFreshRecommendationRun(db, { intakeId, profileId }) {
  const cooldownSeconds = getMatchCooldownSeconds();

  if (cooldownSeconds <= 0) {
    return null;
  }

  const result = await db.query(
    `
    select *
    from public.candidate_recommendation_runs
    where profile_id = $1
      and ($2::uuid is null or intake_id = $2)
      and status = 'success'
      and created_at >= now() - ($3::int * interval '1 second')
    order by created_at desc
    limit 1
    `,
    [profileId, intakeId || null, cooldownSeconds],
  );

  return result.rows[0] || null;
}

async function findLatestRecommendationRunForIntake(db, intakeId) {
  const result = await db.query(
    `
    select *
    from public.candidate_recommendation_runs
    where intake_id = $1
      and status = 'success'
    order by created_at desc
    limit 1
    `,
    [intakeId],
  );

  return result.rows[0] || null;
}

async function insertRecommendationRun(
  db,
  { intakeId, profileId, requestedBy, status, model, profileSnapshot, searchQueries, candidates, result, error = '' },
) {
  const saved = await db.query(
    `
    insert into public.candidate_recommendation_runs (
      intake_id,
      profile_id,
      requested_by,
      status,
      source_mode,
      model,
      profile_snapshot,
      search_queries,
      candidates,
      result,
      error
    )
    values ($1, $2, $3, $4, 'live', $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)
    returning *
    `,
    [
      intakeId,
      profileId,
      requestedBy,
      status,
      model,
      stringifyPostgresJson(profileSnapshot || {}),
      stringifyPostgresJson(searchQueries || {}),
      stringifyPostgresJson(candidates || {}),
      stringifyPostgresJson(result || {}),
      limitChars(error, 1000) || null,
    ],
  );

  return saved.rows[0];
}

function serializeRecommendationRun(run, { cached }) {
  const result = run.result && typeof run.result === 'object' ? run.result : {};

  return {
    ok: true,
    run_id: run.id,
    source: run.source_mode || 'live',
    generated_at: run.created_at,
    model: run.model || '',
    cached,
    summary: cleanText(result.summary),
    recommendations: result.recommendations || { jobs: [], courses: [] },
    profile_gaps: Array.isArray(result.profile_gaps) ? result.profile_gaps : [],
    search: result.search || null,
  };
}

function serializeRecommendationRunListItem(run) {
  return {
    run_id: run.id,
    status: run.status,
    requested_by: run.requested_by,
    source: run.source_mode || 'live',
    model: run.model || '',
    created_at: run.created_at,
    updated_at: run.updated_at,
    error: run.error || '',
    result: run.status === 'success' ? run.result : null,
  };
}

async function findRecommendedJobForInterview(db, { intakeId, jobId, recommendationRunId }) {
  const values = [intakeId];
  const filters = ['intake_id = $1', "status = 'success'"];

  if (recommendationRunId) {
    values.push(recommendationRunId);
    filters.push(`id = $${values.length}`);
  }

  const result = await db.query(
    `
    select *
    from public.candidate_recommendation_runs
    where ${filters.join(' and ')}
    order by created_at desc
    limit ${recommendationRunId ? 1 : 12}
    `,
    values,
  );

  for (const run of result.rows) {
    const recommended = getRecommendedJobFromRun(run, jobId);

    if (!recommended) continue;

    const vacancy = await findJobVacancyById(db, jobId);

    return {
      run,
      recommendation: recommended.recommendation,
      candidate: recommended.candidate,
      vacancy,
    };
  }

  return null;
}

function getRecommendedJobFromRun(run, jobId) {
  const result = run.result && typeof run.result === 'object' ? run.result : {};
  const candidates = run.candidates && typeof run.candidates === 'object' ? run.candidates : {};
  const recommendedJobs = Array.isArray(result.recommendations?.jobs) ? result.recommendations.jobs : [];
  const candidateJobs = Array.isArray(candidates.jobs) ? candidates.jobs : [];
  const recommendation = recommendedJobs.find((job) => cleanText(job.job_id) === jobId);

  if (!recommendation) return null;

  return {
    recommendation,
    candidate: candidateJobs.find((job) => cleanText(job.id) === jobId) || null,
  };
}

async function findJobVacancyById(db, jobId) {
  const result = await db.query(
    `
    select *
    from public.job_vacancies
    where id = $1
    limit 1
    `,
    [jobId],
  );

  return result.rows[0] || null;
}

function buildSelectedInterviewJob(recommendedJob) {
  const source = {
    ...(recommendedJob.candidate || {}),
    ...(recommendedJob.vacancy || {}),
    ...(recommendedJob.recommendation || {}),
  };
  const score = normalizeRecommendationScore(recommendedJob.recommendation?.score, recommendedJob.candidate?.pre_score);

  return pruneUndefined({
    job_id: cleanText(source.id || source.job_id),
    title: cleanText(source.title) || 'Vacante recomendada',
    company: cleanText(source.company),
    provider: cleanText(source.provider || source.source),
    area: cleanText(source.area),
    description: limitChars(source.description, 1300),
    employment_type: cleanText(source.employment_type),
    modality: cleanText(source.modality),
    location_text: cleanText(source.location_text || [source.municipality, source.department].filter(Boolean).join(', ')),
    department: cleanText(source.department),
    municipality: cleanText(source.municipality),
    salary_min: source.salary_min || null,
    salary_max: source.salary_max || null,
    currency: cleanText(source.currency) || 'USD',
    schedule: cleanText(source.schedule),
    requirements: normalizeTextArray(source.requirements).slice(0, 8),
    skills: normalizeTextArray(source.skills).slice(0, 12),
    source_url: cleanText(source.source_url),
    apply_url: cleanText(source.apply_url || source.source_url),
    score,
    fit_level: cleanText(recommendedJob.recommendation?.fit_level) || fitLevelFromScore(score),
    reasons: normalizeTextArray(recommendedJob.recommendation?.reasons).slice(0, 4),
    concerns: normalizeTextArray(recommendedJob.recommendation?.concerns).slice(0, 4),
    next_step: cleanText(recommendedJob.recommendation?.next_step),
  });
}

function buildInterviewProfileSnapshot(profileRow, intake = null) {
  const snapshot = buildRecommendationProfileSnapshot(profileRow, intake);

  return {
    ...snapshot,
    full_name: snapshot.full_name || cleanText(intake?.full_name),
    contact_visibility: 'No pedir telefono ni documentos sensibles durante la simulacion.',
  };
}

async function insertInterviewSession(
  db,
  { intakeId, profileId, recommendationRunId, jobVacancyId, selectedJob, profileSnapshot, agentId },
) {
  const result = await db.query(
    `
    insert into public.candidate_interview_simulations (
      intake_id,
      profile_id,
      recommendation_run_id,
      job_vacancy_id,
      selected_job,
      profile_snapshot,
      agent_id,
      status
    )
    values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'started')
    returning *
    `,
    [
      intakeId,
      profileId,
      recommendationRunId,
      jobVacancyId,
      stringifyPostgresJson(selectedJob || {}),
      stringifyPostgresJson(profileSnapshot || {}),
      agentId,
    ],
  );

  return result.rows[0];
}

async function findInterviewSessionForIntake(db, { intakeId, sessionId }) {
  const result = await db.query(
    `
    select *
    from public.candidate_interview_simulations
    where intake_id = $1 and id = $2
    limit 1
    `,
    [intakeId, sessionId],
  );

  return result.rows[0] || null;
}

async function findLatestInterviewSessionForIntake(db, intakeId) {
  const result = await db.query(
    `
    select *
    from public.candidate_interview_simulations
    where intake_id = $1
    order by created_at desc
    limit 1
    `,
    [intakeId],
  );

  return result.rows[0] || null;
}

async function saveInterviewFeedback(db, body) {
  const payload = body?.parameters && typeof body.parameters === 'object' ? body.parameters : body;
  const sessionId = normalizeUuid(
    payload.interview_session_id || payload.interviewSessionId || payload.session_id || payload.sessionId,
  );
  const feedback = normalizeInterviewFeedback(payload.feedback || payload);
  const scores = normalizeInterviewScores(payload.scores || payload.feedback?.scores || payload);
  const status = cleanText(payload.status) === 'failed' ? 'failed' : 'completed';
  const conversationId = cleanText(
    payload.elevenlabs_conversation_id ||
      payload.elevenLabsConversationId ||
      payload.conversation_id ||
      payload.conversationId ||
      body.conversation_id ||
      body.conversationId,
  );
  const result = await db.query(
    `
    update public.candidate_interview_simulations
    set
      status = $2,
      feedback = $3::jsonb,
      scores = $4::jsonb,
      elevenlabs_conversation_id = coalesce(nullif($5, ''), elevenlabs_conversation_id),
      completed_at = case when $2 = 'completed' then coalesce(completed_at, now()) else completed_at end
    where id = $1
    returning *
    `,
    [
      sessionId,
      status,
      stringifyPostgresJson(feedback),
      stringifyPostgresJson(scores),
      conversationId,
    ],
  );

  if (result.rowCount === 0) {
    throw new Error('unknown_interview_session');
  }

  return result.rows[0];
}

function scheduleInterviewFeedbackVoice(db, session) {
  if (!isVoiceFeedbackConfigured() || !session?.id || session.status !== 'completed') return;

  void sendInterviewFeedbackVoiceIfNeeded(db, session.id).catch((error) => {
    console.error('[interview_voice_feedback]', error?.message || error);
  });
}

async function sendInterviewFeedbackVoiceIfNeeded(db, sessionId) {
  const delivery = await findInterviewVoiceDelivery(db, sessionId);

  if (!delivery || delivery.status !== 'completed') return;
  if (delivery.feedback_voice_attempted_at || delivery.feedback_voice_sent_at) return;

  const phone = cleanText(delivery.phone_e164);
  const text = buildInterviewVoiceFeedbackText(delivery);

  if (!phone || !text) return;

  const claimed = await db.query(
    `
    update public.candidate_interview_simulations
    set
      feedback_voice_text = $2,
      feedback_voice_attempted_at = now(),
      feedback_voice_error = null
    where id = $1
      and status = 'completed'
      and feedback_voice_attempted_at is null
      and feedback_voice_sent_at is null
    returning id
    `,
    [sessionId, text],
  );

  if (claimed.rowCount === 0) return;

  try {
    await postVoiceFeedback({ phone, text });
    await postVoiceFeedbackFollowupMessageIfNeeded({ phone, session: delivery });
    await db.query(
      `
      update public.candidate_interview_simulations
      set feedback_voice_sent_at = now(), feedback_voice_error = null
      where id = $1
      `,
      [sessionId],
    );
  } catch (error) {
    await db.query(
      `
      update public.candidate_interview_simulations
      set feedback_voice_error = $2
      where id = $1
      `,
      [sessionId, limitChars(cleanText(error?.message || 'voice_feedback_failed'), 500)],
    );
  }
}

async function findInterviewVoiceDelivery(db, sessionId) {
  const result = await db.query(
    `
    select
      simulations.*,
      intakes.phone_e164,
      intakes.code as intake_code,
      intakes.full_name as intake_full_name,
      recommendation_runs.result as recommendation_result
    from public.candidate_interview_simulations simulations
    join public.candidate_intakes intakes
      on intakes.id = simulations.intake_id
    left join lateral (
      select runs.result
      from public.candidate_recommendation_runs runs
      where runs.status = 'success'
        and (
          runs.id = simulations.recommendation_run_id
          or runs.intake_id = simulations.intake_id
        )
      order by
        case when runs.id = simulations.recommendation_run_id then 0 else 1 end,
        runs.created_at desc
      limit 1
    ) recommendation_runs on true
    where simulations.id = $1
    limit 1
    `,
    [sessionId],
  );

  return result.rows[0] || null;
}

async function postVoiceFeedback({ phone, text }) {
  const url = getVoiceFeedbackApiUrl();
  const apiKey = getVoiceFeedbackApiKey();

  if (!url || !apiKey) return;

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ text, phone }),
    },
    getVoiceFeedbackTimeoutMs(),
    'voice_feedback_timeout',
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`voice_feedback_failed_${response.status}${detail ? `: ${limitChars(detail, 160)}` : ''}`);
  }
}

async function postVoiceFeedbackFollowupMessageIfNeeded({ phone, session }) {
  if (!isVoiceFeedbackMessageConfigured()) return;

  const text = buildVoiceFeedbackFollowupMessage(session);

  if (!phone || !text) return;

  try {
    await postVoiceFeedbackMessage({ phone, text });
  } catch (error) {
    console.error('[interview_voice_message]', error?.message || error);
  }
}

async function postVoiceFeedbackMessage({ phone, text }) {
  const url = getVoiceFeedbackMessageApiUrl();
  const apiKey = getVoiceFeedbackMessageApiKey();

  if (!url || !apiKey) return;

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ text, phone }),
    },
    getVoiceFeedbackTimeoutMs(),
    'voice_feedback_message_timeout',
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`voice_feedback_message_failed_${response.status}${detail ? `: ${limitChars(detail, 160)}` : ''}`);
  }
}

function buildVoiceFeedbackFollowupMessage(session) {
  const template = getVoiceFeedbackMessageText();
  const code = cleanText(session?.intake_code);
  const link = code ? buildCandidateUrlFromEnv(code) : '';
  const recommendations = buildVoiceFeedbackRecommendationText(session, { link });
  const normalizedTemplate = cleanText(template);

  if (!normalizedTemplate || normalizedTemplate === 'Recomendaciones.' || normalizedTemplate === defaultVoiceFeedbackMessageText) {
    return recommendations || limitChars(['TrabajoYA: recomendaciones disponibles.', link].filter(Boolean).join(' '), 900);
  }

  return limitChars(
    normalizedTemplate
      .replaceAll('{code}', code)
      .replaceAll('{link}', link)
      .replaceAll('{recommendations}', recommendations)
      .replace(/\s+/g, ' ')
      .trim(),
    1800,
  );
}

function buildVoiceFeedbackRecommendationText(session, { link = '' } = {}) {
  const result = session?.recommendation_result && typeof session.recommendation_result === 'object' ? session.recommendation_result : {};
  const recommendations =
    result.recommendations && typeof result.recommendations === 'object' ? result.recommendations : {};
  const jobs = Array.isArray(recommendations.jobs) ? recommendations.jobs.slice(0, 3) : [];
  const courses = Array.isArray(recommendations.courses) ? recommendations.courses.slice(0, 3) : [];
  const lines = ['TrabajoYA: recomendaciones segun tu perfil.'];

  if (jobs.length > 0) {
    lines.push('Empleos:');
    for (const [index, job] of jobs.entries()) {
      lines.push(formatVoiceRecommendationItem(index + 1, job, 'job'));
    }
  }

  if (courses.length > 0) {
    lines.push('Cursos:');
    for (const [index, course] of courses.entries()) {
      lines.push(formatVoiceRecommendationItem(index + 1, course, 'course'));
    }
  }

  if (jobs.length === 0 && courses.length === 0) return '';
  if (link) lines.push(`Abrir perfil: ${link}`);

  return limitChars(lines.filter(Boolean).join('\n'), 1800);
}

function formatVoiceRecommendationItem(index, item, type) {
  const title = cleanText(item.title) || (type === 'job' ? 'Vacante recomendada' : 'Curso recomendado');
  const organization = cleanText(type === 'job' ? item.company : item.provider);
  const score = normalizeOptionalScore(item.score);
  const sourceUrl = cleanText(item.source_url);
  const parts = [
    `${index}. ${title}`,
    organization ? `- ${organization}` : '',
    score !== null ? `(${score}% match)` : '',
    sourceUrl,
  ];

  return parts.filter(Boolean).join(' ');
}

function buildInterviewVoiceFeedbackText(session) {
  const feedback = session.feedback && typeof session.feedback === 'object' ? session.feedback : {};
  const scores = session.scores && typeof session.scores === 'object' ? session.scores : {};
  const selectedJob = session.selected_job && typeof session.selected_job === 'object' ? session.selected_job : {};
  const score = normalizeOptionalScore(feedback.overall_score ?? scores.overall);
  const title = cleanText(selectedJob.title);
  const strengths = normalizeTextArray(feedback.strengths).slice(0, 2);
  const improvements = normalizeTextArray(feedback.improvements).slice(0, 2);
  const nextStep = normalizeTextArray(feedback.next_steps)[0] || cleanText(feedback.closing_note);
  const parts = [
    `TrabajoYA: tu practica de entrevista${title ? ` para ${title}` : ''} ya tiene feedback.`,
    score !== null ? `Puntaje general: ${score} de 100.` : '',
    cleanText(feedback.summary),
    strengths.length ? `Fortalezas: ${strengths.join('; ')}.` : '',
    improvements.length ? `Para mejorar: ${improvements.join('; ')}.` : '',
    nextStep ? `Siguiente paso: ${nextStep}.` : '',
  ];

  return limitVoiceFeedbackText(parts.filter(Boolean).join(' '), getVoiceFeedbackMaxChars());
}

function limitVoiceFeedbackText(text, maxChars) {
  const value = cleanText(text).replace(/\s+/g, ' ');

  if (value.length <= maxChars) return value;

  const sliced = value.slice(0, maxChars).trim();
  const sentenceBreak = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('; '));
  const wordBreak = sliced.lastIndexOf(' ');
  const boundary = sentenceBreak > 240 ? sentenceBreak + 1 : wordBreak > 240 ? wordBreak : sliced.length;

  return `${sliced.slice(0, boundary).trim().replace(/[.,;:]+$/, '')}.`;
}

function normalizeInterviewFeedback(value) {
  const feedback = value && typeof value === 'object' ? value : {};

  return pruneUndefined({
    overall_score: normalizeRecommendationScore(
      feedback.overall_score ?? feedback.overallScore ?? feedback.score ?? feedback.scores?.overall,
      0,
    ),
    summary: limitChars(cleanText(feedback.summary || feedback.resumen || feedback.feedback_summary), 900),
    strengths: normalizeTextArray(feedback.strengths || feedback.fortalezas).slice(0, 5),
    improvements: normalizeTextArray(
      feedback.improvements || feedback.areas_to_improve || feedback.mejoras || feedback.oportunidades,
    ).slice(0, 5),
    suggested_answers: normalizeTextArray(
      feedback.suggested_answers || feedback.respuestas_sugeridas || feedback.answer_tips,
    ).slice(0, 5),
    next_steps: normalizeTextArray(feedback.next_steps || feedback.proximos_pasos || feedback.recommendations).slice(0, 5),
    closing_note: limitChars(cleanText(feedback.closing_note || feedback.nota_final), 500),
  });
}

function normalizeInterviewScores(value) {
  const scores = value && typeof value === 'object' ? value : {};

  return pruneUndefined({
    overall: normalizeRecommendationScore(scores.overall ?? scores.overall_score ?? scores.score, 0),
    communication: normalizeOptionalScore(scores.communication ?? scores.comunicacion),
    role_fit: normalizeOptionalScore(scores.role_fit ?? scores.fit ?? scores.ajuste_puesto),
    examples: normalizeOptionalScore(scores.examples ?? scores.ejemplos),
    confidence: normalizeOptionalScore(scores.confidence ?? scores.confianza),
    clarity: normalizeOptionalScore(scores.clarity ?? scores.claridad),
  });
}

function normalizeOptionalScore(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeRecommendationScore(value, 0);
}

function buildInterviewAgentContext({ session, intake, profileSnapshot, selectedJob }) {
  const profileSummary = [
    profileSnapshot.full_name ? `Nombre: ${profileSnapshot.full_name}` : '',
    profileSnapshot.professional_summary ? `Resumen: ${profileSnapshot.professional_summary}` : '',
    profileSnapshot.desired_roles?.length ? `Roles objetivo: ${profileSnapshot.desired_roles.join(', ')}` : '',
    profileSnapshot.experience?.length ? `Experiencia: ${profileSnapshot.experience.join(' | ')}` : '',
    profileSnapshot.informal_experience?.length
      ? `Experiencia informal: ${profileSnapshot.informal_experience.join(' | ')}`
      : '',
    profileSnapshot.skills?.technical?.length ? `Habilidades tecnicas: ${profileSnapshot.skills.technical.join(', ')}` : '',
    profileSnapshot.skills?.soft?.length ? `Habilidades blandas: ${profileSnapshot.skills.soft.join(', ')}` : '',
    profileSnapshot.availability ? `Disponibilidad: ${profileSnapshot.availability}` : '',
    profileSnapshot.location?.department || profileSnapshot.location?.municipality
      ? `Ubicacion: ${[profileSnapshot.location.municipality, profileSnapshot.location.department].filter(Boolean).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const jobSummary = [
    `Vacante: ${selectedJob.title}`,
    selectedJob.company ? `Empresa: ${selectedJob.company}` : '',
    selectedJob.location_text ? `Lugar: ${selectedJob.location_text}` : '',
    selectedJob.modality ? `Modalidad: ${selectedJob.modality}` : '',
    selectedJob.employment_type ? `Tipo: ${selectedJob.employment_type}` : '',
    selectedJob.skills?.length ? `Habilidades buscadas: ${selectedJob.skills.join(', ')}` : '',
    selectedJob.description ? `Descripcion: ${selectedJob.description}` : '',
    selectedJob.reasons?.length ? `Motivos del match: ${selectedJob.reasons.join(' | ')}` : '',
    selectedJob.concerns?.length ? `Puntos a cuidar: ${selectedJob.concerns.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    interview_session_id: session.id,
    intake_code: intake.code,
    profile_summary: profileSummary,
    selected_job: selectedJob,
    job_summary: jobSummary,
    instructions: [
      'Simula una entrevista corta como empleador para la vacante elegida.',
      'Haz 4 a 6 preguntas maximo, una pregunta por turno.',
      'No pidas DUI, documentos, datos de salud, religion, politica, apariencia, genero, orientacion sexual ni finanzas.',
      'No prometas contratacion.',
      'Al terminar, llama la herramienta save_interview_feedback con feedback estructurado.',
      'Despues de guardar feedback, despídete en una frase breve y termina la llamada. No hagas mas preguntas.',
    ].join(' '),
  };
}

function serializeInterviewSession(session) {
  const selectedJob = session.selected_job && typeof session.selected_job === 'object' ? session.selected_job : {};
  const feedback = session.feedback && typeof session.feedback === 'object' ? session.feedback : {};
  const scores = session.scores && typeof session.scores === 'object' ? session.scores : {};

  return {
    id: session.id,
    session_id: session.id,
    intake_id: session.intake_id,
    profile_id: session.profile_id,
    recommendation_run_id: session.recommendation_run_id,
    job_vacancy_id: session.job_vacancy_id,
    selected_job: selectedJob,
    agent_id: session.agent_id || '',
    elevenlabs_conversation_id: session.elevenlabs_conversation_id || '',
    status: session.status,
    feedback,
    scores,
    feedback_voice_attempted_at: session.feedback_voice_attempted_at || null,
    feedback_voice_sent_at: session.feedback_voice_sent_at || null,
    feedback_voice_error: session.feedback_voice_error || '',
    completed_at: session.completed_at,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function getRecommendationMaxResults(body = {}) {
  const configured = Number(process.env.MATCH_MAX_RESULTS_PER_TYPE || defaultRecommendationMaxResults);
  const requested = Number(body.max_results ?? body.maxResults ?? body.limit ?? configured);

  return clampNumber(requested, 1, maxRecommendationMaxResults);
}

function getRecommendationMaxCourses(body = {}, maxResults = defaultRecommendationMaxResults) {
  const configured = Number(process.env.MATCH_MAX_COURSES || defaultRecommendationMaxCourses);
  const requested = Number(body.max_courses ?? body.maxCourses ?? configured);

  return clampNumber(requested, 1, maxResults);
}

function getMatchCooldownSeconds() {
  return clampNumber(
    Number(process.env.MATCH_MIN_INTERVAL_SECONDS || defaultMatchCooldownSeconds),
    0,
    60 * 60,
  );
}

function getExaJobFreshDays() {
  return clampNumber(Number(process.env.EXA_JOB_FRESH_DAYS || defaultExaJobFreshDays), 1, 365);
}

function getExaJobMaxAgeHours() {
  return clampNumber(Number(process.env.EXA_JOB_MAX_AGE_HOURS || defaultExaJobMaxAgeHours), 0, 24 * 30);
}

function buildRecommendationProfileSnapshot(profileRow, intake = null) {
  const profile = profileRow.profile || {};
  const personal = profile.personal || {};
  const jobGoal = profile.job_goal || {};
  const skills = profile.skills || {};

  return {
    full_name: cleanText(personal.full_name || profileRow.full_name),
    location: {
      municipality: cleanText(personal.municipality || profileRow.municipality || intake?.municipality),
      department: cleanText(personal.department || profileRow.department || intake?.department),
    },
    professional_summary: limitChars(profile.professional_summary, 1200),
    desired_roles: normalizeTextArray(jobGoal.desired_roles || jobGoal.desired_role || intake?.desired_role),
    desired_areas: normalizeTextArray(jobGoal.desired_areas || jobGoal.desired_area),
    availability: cleanText(jobGoal.availability),
    preferred_schedule: cleanText(jobGoal.preferred_schedule),
    can_relocate: parseOptionalBoolean(jobGoal.can_relocate) ?? null,
    education: summarizeProfileItems(profile.education),
    experience: summarizeProfileItems(profile.experience),
    informal_experience: summarizeProfileItems(profile.informal_experience),
    skills: {
      technical: normalizeTextArray(skills.technical),
      soft: normalizeTextArray(skills.soft),
      tools: normalizeTextArray(skills.tools),
      languages: normalizeTextArray(skills.languages),
    },
    certifications_or_courses: summarizeProfileItems(profile.certifications_or_courses),
    cv_gaps: normalizeTextArray(profile.cv_gaps),
    recommended_next_steps: normalizeTextArray(profile.recommended_next_steps),
  };
}

function summarizeProfileItems(value) {
  const items = Array.isArray(value) ? value : cleanText(value) ? [value] : [];

  return items
    .map((item) => {
      if (typeof item !== 'object' || item === null) {
        return cleanText(item);
      }

      return cleanText(
        [
          item.role || item.title || item.position || item.degree || item.name,
          item.company || item.institution || item.organization,
          item.duration || item.years || item.period,
          item.description || item.summary || item.notes,
        ]
          .filter(Boolean)
          .join(' - '),
      );
    })
    .filter(Boolean)
    .slice(0, 8);
}

function buildRecommendationSearchConfigs(profileSnapshot, maxResults) {
  const roleTerms = uniqueCleanTexts([...profileSnapshot.desired_roles, ...profileSnapshot.desired_areas]);
  const skillTerms = uniqueCleanTexts([
    ...profileSnapshot.skills.technical,
    ...profileSnapshot.skills.tools,
    ...profileSnapshot.skills.soft,
  ]);
  const gapTerms = uniqueCleanTexts([...profileSnapshot.cv_gaps, ...profileSnapshot.recommended_next_steps]);
  const primaryGoal = joinSearchTerms(roleTerms, 'empleos');
  const skillQuery = joinSearchTerms(skillTerms.slice(0, 6), '');
  const courseFocus = joinSearchTerms([...gapTerms, ...skillTerms, ...roleTerms].slice(0, 8), primaryGoal);
  const location = joinSearchTerms(
    [profileSnapshot.location.municipality, profileSnapshot.location.department],
    'El Salvador',
  );
  const numResults = Math.max(maxResults * 2, 8);
  const primaryArea = roleTerms[0] || 'Perfil laboral';
  const jobFreshAfter = getIsoDateDaysAgo(getExaJobFreshDays());
  const jobMaxAgeHours = getExaJobMaxAgeHours();
  const jobHighlightQuery = 'vacante vigente fecha publicacion fecha expiracion requisitos ubicacion salario aplicar';

  return {
    jobs: [
      {
        source: 'tecoloco',
        provider: 'Tecoloco',
        query: cleanSearchQuery(
          `site:tecoloco.com.sv empleos vacantes vigentes publicadas recientemente aplicar ${primaryGoal} ${skillQuery} ${location} El Salvador`,
        ),
        includeDomains: ['tecoloco.com.sv', 'www.tecoloco.com.sv'],
        area: primaryArea,
        startCrawlDate: jobFreshAfter,
        maxAgeHours: jobMaxAgeHours,
        highlightQuery: jobHighlightQuery,
        numResults,
      },
      {
        source: 'computrabajo',
        provider: 'Computrabajo',
        query: cleanSearchQuery(
          `site:sv.computrabajo.com empleos vacantes vigentes publicadas recientemente aplicar ${primaryGoal} ${skillQuery} ${location} El Salvador`,
        ),
        includeDomains: ['sv.computrabajo.com'],
        area: primaryArea,
        startCrawlDate: jobFreshAfter,
        maxAgeHours: jobMaxAgeHours,
        highlightQuery: jobHighlightQuery,
        numResults,
      },
      {
        source: 'mtps_oportunidades',
        provider: 'Ministerio de Trabajo - Oportunidades',
        query: cleanSearchQuery(
          `site:oportunidades.mtps.gob.sv/job-offers ofertas laborales vigentes aplicar ${primaryGoal} ${location}`,
        ),
        includeDomains: ['oportunidades.mtps.gob.sv'],
        area: primaryArea,
        startCrawlDate: jobFreshAfter,
        maxAgeHours: jobMaxAgeHours,
        highlightQuery: jobHighlightQuery,
        numResults,
      },
    ],
    courses: [
      {
        source: 'platzi',
        provider: 'Platzi',
        query: cleanSearchQuery(`site:platzi.com/cursos curso Platzi ${courseFocus}`),
        includeDomains: ['platzi.com'],
        urlIncludes: ['/cursos/'],
        area: primaryArea,
        modality: 'online',
        isFree: null,
        numResults,
      },
      {
        source: 'platzi',
        provider: 'Platzi',
        query: cleanSearchQuery(`site:platzi.com/cursos ${primaryGoal} ${skillQuery} habilidades profesionales`),
        includeDomains: ['platzi.com'],
        urlIncludes: ['/cursos/'],
        area: primaryArea,
        modality: 'online',
        isFree: null,
        numResults,
      },
      {
        source: 'incaf',
        provider: 'INCAF',
        query: cleanSearchQuery(`site:incaf.gob.sv cursos formacion ${courseFocus} El Salvador`),
        includeDomains: ['incaf.gob.sv', 'www.incaf.gob.sv'],
        area: primaryArea,
        modality: 'mixta',
        isFree: true,
        numResults,
      },
    ],
  };
}

function joinSearchTerms(values, fallback) {
  const text = uniqueCleanTexts(values).slice(0, 8).join(' ');

  return text || fallback;
}

function cleanSearchQuery(value) {
  return cleanText(value).replace(/\s+/g, ' ');
}

async function fetchLiveRecommendationCandidates(db, { searchQueries }) {
  const [jobSearches, courseSearches] = await Promise.all([
    Promise.all(searchQueries.jobs.map((config) => fetchExaSearch(config, 2600))),
    Promise.all(searchQueries.courses.map((config) => fetchExaSearch(config, 2200))),
  ]);
  const jobs = [];
  const courses = [];
  const seenJobs = new Set();
  const seenCourses = new Set();

  for (const { config, results } of jobSearches) {
    for (const result of results) {
      if (!result?.url || !result?.title) continue;

      const key = `${config.source}|${result.url}`;
      if (seenJobs.has(key)) continue;
      seenJobs.add(key);

      const payload = normalizeExaJobResult(config, result);
      if (!isUsefulJobTitle(payload.title)) continue;

      try {
        const normalized = normalizeJobPayload(payload, config.source);
        const saved = await upsertJobVacancy(db, normalized);
        if (normalized.status !== 'active') continue;
        jobs.push(buildJobCandidate(saved, normalized));
      } catch (error) {
        if (error?.message === 'missing_job_title') continue;
        throw error;
      }
    }
  }

  for (const { config, results } of courseSearches) {
    const allowedUrlParts = Array.isArray(config.urlIncludes) ? config.urlIncludes : [];

    for (const result of results) {
      if (!result?.url || !result?.title) continue;
      if (allowedUrlParts.length > 0 && !allowedUrlParts.some((part) => result.url.includes(part))) continue;

      const key = `${config.source}|${result.url}`;
      if (seenCourses.has(key)) continue;
      seenCourses.add(key);

      const payload = normalizeExaCourseResult(config, result);

      try {
        const normalized = normalizeCoursePayload(payload, config.source);
        const saved = await upsertCourse(db, normalized);
        courses.push(buildCourseCandidate(saved, normalized));
      } catch (error) {
        if (error?.message === 'missing_course_title') continue;
        throw error;
      }
    }
  }

  return {
    jobs,
    courses,
  };
}

async function fetchExaSearch(config, maxCharacters) {
  const body = {
    query: config.query,
    includeDomains: config.includeDomains,
    numResults: config.numResults || 8,
    startCrawlDate: config.startCrawlDate,
    startPublishedDate: config.startPublishedDate,
    userLocation: config.userLocation || 'SV',
    contents: {
      highlights: config.highlightQuery
        ? {
            query: config.highlightQuery,
            maxCharacters: Math.min(maxCharacters, 1200),
          }
        : true,
      text: {
        maxCharacters,
      },
      maxAgeHours: config.maxAgeHours,
    },
  };
  const response = await fetchWithTimeout(
    'https://api.exa.ai/search',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': getExaApiKey(),
      },
      body: JSON.stringify(pruneUndefined(body)),
    },
    exaSearchTimeoutMs,
    'exa_request_timeout',
  );

  if (!response.ok) {
    const error = new Error('exa_request_failed');
    error.details = limitChars(await response.text(), 500);
    throw error;
  }

  const data = await response.json();

  return {
    config,
    results: Array.isArray(data.results) ? data.results : [],
  };
}

function normalizeExaCourseResult(config, result) {
  const title = cleanText(result.title || result.url);
  const description = limitChars(getExaResultText(result) || title, 2500);
  const skills = inferSkillsFromText(`${title} ${description}`);

  return {
    source: config.source,
    external_id: result.url,
    provider: config.provider,
    title,
    area: config.area,
    description,
    modality: config.modality,
    country: 'El Salvador',
    is_free: config.isFree,
    cost: config.isFree ? 0 : null,
    currency: 'USD',
    skills,
    target_roles: inferTargetRolesFromSkills(skills),
    source_url: result.url,
    status: 'active',
    raw: {
      exa_id: result.id,
      published_date: result.publishedDate,
      query: config.query,
      score: result.score,
      highlights: result.highlights || [],
    },
  };
}

function normalizeExaJobResult(config, result) {
  const fullText = getExaResultText(result);
  const title = cleanExaJobTitle(result.title || result.url, config.provider);
  const salary = inferSalaryFromText(fullText);
  const department = inferDepartmentFromText(fullText);
  const expiresAt = inferJobExpirationDateFromText(fullText);
  const status = inferJobStatusFromText(fullText, expiresAt);

  return {
    source: config.source,
    external_id: result.url,
    provider: config.provider,
    title,
    company: '',
    area: config.area,
    description: limitChars(fullText, 4200),
    employment_type: inferEmploymentTypeFromText(fullText),
    modality: inferModalityFromText(fullText),
    country: 'El Salvador',
    department,
    municipality: '',
    location_text: department || 'El Salvador',
    salary_min: salary.min,
    salary_max: salary.max,
    currency: 'USD',
    posted_at: parseOptionalDate(result.publishedDate),
    expires_at: expiresAt,
    skills: inferSkillsFromText(fullText),
    source_url: result.url,
    apply_url: result.url,
    status,
    raw: {
      exa_id: result.id,
      published_date: result.publishedDate,
      query: config.query,
      score: result.score,
      highlights: result.highlights || [],
    },
  };
}

function getExaResultText(result) {
  const highlights = Array.isArray(result.highlights) ? result.highlights.join('\n') : '';

  return [result.title, highlights, result.text].map(cleanText).filter(Boolean).join('\n');
}

function cleanExaJobTitle(title, provider) {
  return cleanText(title)
    .replace(/\s+\|\s+.*$/i, '')
    .replace(/\s+-\s+Computrabajo.*$/i, '')
    .replace(/\s+-\s+Tecoloco.*$/i, '')
    .replace(new RegExp(`\\s+-\\s+${escapeRegExp(provider)}.*$`, 'i'), '')
    .trim();
}

function inferDepartmentFromText(text) {
  const departments = [
    'Ahuachapan',
    'Cabanas',
    'Chalatenango',
    'Cuscatlan',
    'La Libertad',
    'La Paz',
    'La Union',
    'Morazan',
    'San Miguel',
    'San Salvador',
    'San Vicente',
    'Santa Ana',
    'Sonsonate',
    'Usulutan',
  ];
  const normalizedText = normalizeAscii(text).toLowerCase();

  for (const department of departments) {
    if (normalizedText.includes(normalizeAscii(department).toLowerCase())) {
      return department;
    }
  }

  return '';
}

function inferSalaryFromText(text) {
  const normalized = cleanText(text);
  const matches = [
    ...normalized.matchAll(/(?:US\$|\$)\s*([0-9]{3,5}(?:[.,][0-9]{2})?)|([0-9]{3,5}(?:[.,][0-9]{2})?)\s*(?:US\$|dolares)/gi),
  ];
  const amounts = matches
    .map((match) => Number(String(match[1] || match[2]).replace(',', '.')))
    .filter((number) => Number.isFinite(number));

  if (amounts.length === 0) {
    return {
      min: null,
      max: null,
    };
  }

  return {
    min: Math.min(...amounts),
    max: Math.max(...amounts),
  };
}

function inferDateFromText(text) {
  const normalized = cleanText(text);
  const iso = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/);

  if (iso) return iso[0];

  const slash = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);

  if (!slash) return null;

  return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
}

function inferJobExpirationDateFromText(text) {
  const normalized = cleanText(text);
  const patterns = [
    /(?:vence|vencimiento|expira|expiracion|expiración|fecha limite|fecha límite|aplicar antes de|hasta el|finaliza|cierra)\D{0,45}(\d{4}-\d{2}-\d{2})/i,
    /(?:vence|vencimiento|expira|expiracion|expiración|fecha limite|fecha límite|aplicar antes de|hasta el|finaliza|cierra)\D{0,45}(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (!match) continue;

    if (match[1] && /^\d{4}-\d{2}-\d{2}$/.test(match[1])) {
      return match[1];
    }

    if (match[1] && match[2] && match[3]) {
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }
  }

  return null;
}

function inferJobStatusFromText(text, expiresAt) {
  const lower = normalizeAscii(text).toLowerCase();
  const expiredFragments = [
    'oferta expirada',
    'oferta vencida',
    'oferta cerrada',
    'vacante expirada',
    'vacante vencida',
    'vacante cerrada',
    'ya no esta disponible',
    'ya no se encuentra disponible',
    'esta oferta ya no esta disponible',
    'esta vacante ya no esta disponible',
    'proceso cerrado',
    'plaza cubierta',
    'publicacion cerrada',
    'publicacion expirada',
    'postulacion cerrada',
    'postulaciones cerradas',
    'application closed',
    'job expired',
    'position filled',
  ];

  if (expiredFragments.some((fragment) => lower.includes(fragment))) {
    return 'closed';
  }

  return isPastDate(expiresAt) ? 'closed' : 'active';
}

function inferSkillsFromText(text) {
  const lower = normalizeAscii(text).toLowerCase();
  const mappings = [
    ['ventas', ['Ventas', 'Servicio al cliente']],
    ['cliente', ['Atencion al cliente', 'Comunicacion']],
    ['cajero', ['Caja', 'Atencion al cliente']],
    ['bodega', ['Inventario', 'Bodega']],
    ['almacen', ['Inventario', 'Bodega']],
    ['motorista', ['Licencia de conducir', 'Logistica']],
    ['repartidor', ['Logistica', 'Distribucion']],
    ['contabilidad', ['Contabilidad']],
    ['contador', ['Contabilidad']],
    ['administrativo', ['Administracion']],
    ['recursos humanos', ['Recursos humanos']],
    ['excel', ['Excel', 'Ofimatica']],
    ['office', ['Ofimatica']],
    ['software', ['Software', 'Tecnologia']],
    ['programacion', ['Programacion', 'Logica']],
    ['sistemas', ['Sistemas', 'Tecnologia']],
    ['soporte tecnico', ['Soporte tecnico']],
    ['datos', ['Analisis de datos']],
    ['inteligencia artificial', ['Inteligencia artificial']],
    ['call center', ['Call center', 'Atencion al cliente']],
    ['ingles', ['Ingles']],
    ['marketing', ['Marketing digital']],
    ['gastronomia', ['Gastronomia']],
    ['turismo', ['Turismo']],
    ['emprendimiento', ['Emprendimiento']],
  ];
  const skills = [];

  for (const [keyword, mappedSkills] of mappings) {
    if (lower.includes(normalizeAscii(keyword).toLowerCase())) {
      skills.push(...mappedSkills);
    }
  }

  return uniqueCleanTexts(skills).slice(0, 14);
}

function inferTargetRolesFromSkills(skills) {
  const roles = [];

  if (skills.includes('Atencion al cliente') || skills.includes('Servicio al cliente')) {
    roles.push('Asesor de servicio', 'Auxiliar de tienda');
  }

  if (skills.includes('Ventas')) roles.push('Vendedor', 'Ejecutivo comercial');
  if (skills.includes('Programacion')) roles.push('Desarrollador junior');
  if (skills.includes('Ofimatica') || skills.includes('Excel')) roles.push('Auxiliar administrativo');
  if (skills.includes('Gastronomia')) roles.push('Auxiliar de cocina');
  if (skills.includes('Turismo')) roles.push('Atencion turistica');

  return uniqueCleanTexts(roles).slice(0, 8);
}

function inferModalityFromText(text) {
  const lower = normalizeAscii(text).toLowerCase();

  if (lower.includes('remoto') || lower.includes('remote')) return 'remoto';
  if (lower.includes('hibrido') || lower.includes('hybrid')) return 'hibrido';
  if (lower.includes('presencial')) return 'presencial';

  return '';
}

function inferEmploymentTypeFromText(text) {
  const lower = normalizeAscii(text).toLowerCase();

  if (lower.includes('medio tiempo') || lower.includes('part time')) return 'medio tiempo';
  if (lower.includes('temporal')) return 'temporal';
  if (lower.includes('pasantia') || lower.includes('practica')) return 'pasantia';
  if (lower.includes('tiempo completo') || lower.includes('full time')) return 'tiempo completo';

  return '';
}

function isUsefulJobTitle(title) {
  const lower = normalizeAscii(title).toLowerCase();
  const generic = [
    'bolsa de trabajo',
    'portal de empleo',
    'buscar empleo',
    'consejos para encontrar empleo',
    'salarios',
    'evaluaciones de empresa',
  ];

  return cleanText(title).length >= 4 && !generic.some((fragment) => lower.includes(fragment));
}

function buildJobCandidate(saved, job) {
  return {
    id: saved.id,
    source: job.source,
    external_id: job.external_id,
    provider: job.provider,
    title: job.title,
    company: job.company,
    area: job.area,
    description: limitChars(job.description, 1200),
    employment_type: job.employment_type,
    modality: job.modality,
    country: job.country,
    department: job.department,
    municipality: job.municipality,
    location_text: job.location_text,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    currency: job.currency,
    schedule: job.schedule,
    posted_at: job.posted_at,
    expires_at: job.expires_at,
    experience_level: job.experience_level,
    education_level: job.education_level,
    requirements: job.requirements,
    skills: job.skills,
    benefits: job.benefits,
    source_url: job.source_url,
    apply_url: job.apply_url,
  };
}

function buildCourseCandidate(saved, course) {
  return {
    id: saved.id,
    source: course.source,
    external_id: course.external_id,
    provider: course.provider,
    title: course.title,
    area: course.area,
    description: limitChars(course.description, 1000),
    modality: course.modality,
    country: course.country,
    department: course.department,
    municipality: course.municipality,
    is_free: course.is_free,
    cost: course.cost,
    currency: course.currency,
    duration_hours: course.duration_hours,
    schedule: course.schedule,
    start_date: course.start_date,
    end_date: course.end_date,
    level: course.level,
    requirements: course.requirements,
    skills: course.skills,
    target_roles: course.target_roles,
    certificate: course.certificate,
    source_url: course.source_url,
  };
}

function preRankRecommendationCandidates(candidates, profileSnapshot) {
  return {
    jobs: candidates.jobs
      .map((candidate) => ({
        ...candidate,
        pre_score: scoreRecommendationCandidate(candidate, profileSnapshot, 'job'),
      }))
      .sort((left, right) => right.pre_score - left.pre_score)
      .slice(0, recommendationPreRankLimit),
    courses: candidates.courses
      .map((candidate) => ({
        ...candidate,
        pre_score: scoreRecommendationCandidate(candidate, profileSnapshot, 'course'),
      }))
      .sort((left, right) => right.pre_score - left.pre_score)
      .slice(0, recommendationPreRankLimit),
  };
}

function scoreRecommendationCandidate(candidate, profileSnapshot, type) {
  const candidateText = normalizeAscii(buildCandidateText(candidate)).toLowerCase();
  const desiredRoles = profileSnapshot.desired_roles;
  const desiredAreas = profileSnapshot.desired_areas;
  const skills = uniqueCleanTexts([
    ...profileSnapshot.skills.technical,
    ...profileSnapshot.skills.tools,
    ...profileSnapshot.skills.soft,
  ]);
  let score = 0;

  score += countTermMatches(candidateText, desiredRoles) * 18;
  score += countTermMatches(candidateText, desiredAreas) * 12;
  score += Math.min(countTermMatches(candidateText, skills) * 8, 40);

  if (
    profileSnapshot.location.department &&
    normalizeAscii(candidate.department || candidate.location_text || '').toLowerCase().includes(
      normalizeAscii(profileSnapshot.location.department).toLowerCase(),
    )
  ) {
    score += 10;
  }

  if (type === 'course' && candidate.is_free === true) score += 5;
  if (type === 'job' && candidate.source_url) score += 5;

  return score;
}

function buildCandidateText(candidate) {
  return [
    candidate.title,
    candidate.company,
    candidate.provider,
    candidate.area,
    candidate.description,
    candidate.modality,
    candidate.location_text,
    candidate.department,
    candidate.municipality,
    ...(candidate.skills || []),
    ...(candidate.requirements || []),
    ...(candidate.target_roles || []),
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(' ');
}

function countTermMatches(text, terms) {
  return uniqueCleanTexts(terms).filter((term) => text.includes(normalizeAscii(term).toLowerCase())).length;
}

async function buildOpenAiRecommendationMatch({ profileSnapshot, candidates, maxResults, maxCourses, model }) {
  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getOpenAiApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content:
              'Eres el motor de matching de TrabajoYA para El Salvador. Rankea cursos y empleos usando solo los candidatos provistos. No inventes IDs, empresas, cursos, empleos ni enlaces. Responde en espanol claro y accionable.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              profile: profileSnapshot,
              candidates: getCandidatesForModel(candidates),
              max_jobs: maxResults,
              max_courses: maxCourses,
              rules: [
                'Selecciona maximo max_jobs empleos y maximo max_courses cursos.',
                'Incluye hasta 3 cursos si hay cursos aplicables; si no aplican, devuelve menos cursos.',
                'Usa solo job_id y course_id existentes en candidates.',
                'Prioriza coincidencia de rol, habilidades, ubicacion, disponibilidad y brechas de aprendizaje.',
                'Si un candidato es debil, explica concerns brevemente en vez de ocultarlo.',
              ],
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'trabajoya_recommendation_match',
            strict: true,
            schema: getRecommendationMatchSchema(),
          },
        },
        max_output_tokens: 4500,
      }),
    },
    openAiMatchTimeoutMs,
    'openai_request_timeout',
  );

  if (!response.ok) {
    const error = new Error('openai_request_failed');
    error.details = limitChars(await response.text(), 500);
    throw error;
  }

  const data = await response.json();
  const outputText = extractOpenAiOutputText(data);
  let parsed;

  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error('openai_invalid_json');
  }

  return validateAndReconcileRecommendationResult(parsed, candidates, maxResults, maxCourses);
}

function getCandidatesForModel(candidates) {
  return {
    jobs: candidates.jobs.map((job) => ({
      job_id: job.id,
      title: job.title,
      company: job.company || '',
      provider: job.provider,
      area: job.area || '',
      description: limitChars(job.description, 700),
      location: job.location_text || [job.municipality, job.department].filter(Boolean).join(', '),
      modality: job.modality || '',
      employment_type: job.employment_type || '',
      schedule: job.schedule || '',
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      skills: job.skills || [],
      requirements: job.requirements || [],
      source_url: job.source_url || '',
      pre_score: job.pre_score || 0,
    })),
    courses: candidates.courses.map((course) => ({
      course_id: course.id,
      title: course.title,
      provider: course.provider,
      area: course.area || '',
      description: limitChars(course.description, 650),
      modality: course.modality || '',
      is_free: course.is_free,
      cost: course.cost,
      duration_hours: course.duration_hours,
      skills: course.skills || [],
      target_roles: course.target_roles || [],
      source_url: course.source_url || '',
      pre_score: course.pre_score || 0,
    })),
  };
}

function getRecommendationMatchSchema() {
  const stringArray = {
    type: 'array',
    items: {
      type: 'string',
    },
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'recommendations', 'profile_gaps'],
    properties: {
      summary: {
        type: 'string',
      },
      recommendations: {
        type: 'object',
        additionalProperties: false,
        required: ['jobs', 'courses'],
        properties: {
          jobs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['job_id', 'title', 'company', 'source_url', 'score', 'fit_level', 'reasons', 'concerns', 'next_step'],
              properties: {
                job_id: { type: 'string' },
                title: { type: 'string' },
                company: { type: 'string' },
                source_url: { type: 'string' },
                score: { type: 'number' },
                fit_level: { type: 'string', enum: ['alto', 'medio', 'bajo'] },
                reasons: stringArray,
                concerns: stringArray,
                next_step: { type: 'string' },
              },
            },
          },
          courses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['course_id', 'title', 'provider', 'source_url', 'score', 'reasons', 'skill_gaps_addressed', 'next_step'],
              properties: {
                course_id: { type: 'string' },
                title: { type: 'string' },
                provider: { type: 'string' },
                source_url: { type: 'string' },
                score: { type: 'number' },
                reasons: stringArray,
                skill_gaps_addressed: stringArray,
                next_step: { type: 'string' },
              },
            },
          },
        },
      },
      profile_gaps: stringArray,
    },
  };
}

function extractOpenAiOutputText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (data.output_parsed && typeof data.output_parsed === 'object') {
    return JSON.stringify(data.output_parsed);
  }

  const texts = [];

  for (const output of data.output || []) {
    for (const content of output.content || []) {
      if (content.type === 'refusal' || content.refusal) {
        throw new Error('openai_refusal');
      }

      if (typeof content.text === 'string') {
        texts.push(content.text);
      }
    }
  }

  const text = texts.join('\n').trim();

  if (!text) {
    throw new Error('openai_empty_response');
  }

  return text;
}

function validateAndReconcileRecommendationResult(result, candidates, maxResults, maxCourses = maxResults) {
  const fallback = buildFallbackRecommendationResult(candidates, maxResults, maxCourses);
  const jobMap = new Map(candidates.jobs.map((job) => [job.id, job]));
  const courseMap = new Map(candidates.courses.map((course) => [course.id, course]));
  const rawJobs = Array.isArray(result?.recommendations?.jobs) ? result.recommendations.jobs : [];
  const rawCourses = Array.isArray(result?.recommendations?.courses) ? result.recommendations.courses : [];
  const jobs = rawJobs
    .map((item) => {
      const candidate = jobMap.get(cleanText(item.job_id));
      if (!candidate) return null;

      return {
        job_id: candidate.id,
        title: candidate.title,
        company: candidate.company || '',
        source_url: candidate.source_url || '',
        score: normalizeRecommendationScore(item.score, candidate.pre_score),
        fit_level: ['alto', 'medio', 'bajo'].includes(cleanText(item.fit_level)) ? cleanText(item.fit_level) : fitLevelFromScore(item.score),
        reasons: normalizeTextArray(item.reasons).slice(0, 4),
        concerns: normalizeTextArray(item.concerns).slice(0, 3),
        next_step: cleanText(item.next_step) || 'Revisar requisitos y aplicar desde la fuente original.',
      };
    })
    .filter(Boolean)
    .slice(0, maxResults);
  const courses = rawCourses
    .map((item) => {
      const candidate = courseMap.get(cleanText(item.course_id));
      if (!candidate) return null;

      return {
        course_id: candidate.id,
        title: candidate.title,
        provider: candidate.provider || '',
        source_url: candidate.source_url || '',
        score: normalizeRecommendationScore(item.score, candidate.pre_score),
        reasons: normalizeTextArray(item.reasons).slice(0, 4),
        skill_gaps_addressed: normalizeTextArray(item.skill_gaps_addressed).slice(0, 5),
        next_step: cleanText(item.next_step) || 'Revisar el temario y guardar el curso como siguiente paso.',
      };
    })
    .filter(Boolean)
    .slice(0, maxCourses);

  return {
    summary:
      cleanText(result?.summary) ||
      'Estas recomendaciones se generaron cruzando el perfil con oportunidades encontradas en vivo.',
    recommendations: {
      jobs: jobs.length > 0 ? jobs : fallback.recommendations.jobs,
      courses: courses.length > 0 ? courses : fallback.recommendations.courses,
    },
    profile_gaps: normalizeTextArray(result?.profile_gaps).slice(0, 8),
  };
}

function buildEmptyRecommendationResult() {
  return {
    summary: 'No se encontraron oportunidades suficientes en la busqueda en vivo para generar recomendaciones.',
    recommendations: {
      jobs: [],
      courses: [],
    },
    profile_gaps: ['Probar con mas informacion del perfil o ampliar fuentes de busqueda.'],
  };
}

function buildFallbackRecommendationResult(candidates, maxResults, maxCourses = maxResults) {
  return {
    summary: 'Estas recomendaciones se basan en coincidencias directas entre el perfil y los resultados encontrados.',
    recommendations: {
      jobs: candidates.jobs.slice(0, maxResults).map(buildFallbackJobRecommendation),
      courses: candidates.courses.slice(0, maxCourses).map(buildFallbackCourseRecommendation),
    },
    profile_gaps: [],
  };
}

function buildFallbackJobRecommendation(candidate) {
  const score = normalizeRecommendationScore(undefined, candidate.pre_score);

  return {
    job_id: candidate.id,
    title: candidate.title,
    company: candidate.company || '',
    source_url: candidate.source_url || '',
    score,
    fit_level: fitLevelFromScore(score),
    reasons: buildCandidateReasons(candidate, 'job'),
    concerns: candidate.department || candidate.location_text ? [] : ['La ubicacion no esta completamente clara en la fuente.'],
    next_step: 'Revisar requisitos y aplicar desde la fuente original.',
  };
}

function buildFallbackCourseRecommendation(candidate) {
  const score = normalizeRecommendationScore(undefined, candidate.pre_score);

  return {
    course_id: candidate.id,
    title: candidate.title,
    provider: candidate.provider || '',
    source_url: candidate.source_url || '',
    score,
    reasons: buildCandidateReasons(candidate, 'course'),
    skill_gaps_addressed: normalizeTextArray(candidate.skills).slice(0, 5),
    next_step: 'Revisar el temario y guardar el curso como siguiente paso.',
  };
}

function buildCandidateReasons(candidate, type) {
  const reasons = [];

  if (candidate.area) reasons.push(`Coincide con el area ${candidate.area}.`);
  if (candidate.skills?.length) reasons.push(`Refuerza habilidades como ${candidate.skills.slice(0, 3).join(', ')}.`);
  if (type === 'job' && (candidate.department || candidate.location_text)) {
    reasons.push(`La ubicacion reportada es ${candidate.location_text || candidate.department}.`);
  }
  if (type === 'course' && candidate.modality) reasons.push(`Modalidad ${candidate.modality}.`);

  return reasons.slice(0, 4);
}

function normalizeRecommendationScore(value, fallback) {
  const number = Number(value);
  const base = Number.isFinite(number) ? number : 55 + Number(fallback || 0);

  return clampNumber(base, 0, 100);
}

function fitLevelFromScore(score) {
  const number = Number(score);

  if (number >= 80) return 'alto';
  if (number >= 60) return 'medio';

  return 'bajo';
}

async function fetchWithTimeout(url, options, timeoutMs, timeoutErrorMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(timeoutErrorMessage);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getRecommendationErrorStatus(error) {
  if (['missing_openai_api_key', 'missing_exa_api_key'].includes(error?.message)) return 503;

  if (
    [
      'exa_request_failed',
      'exa_request_timeout',
      'openai_request_failed',
      'openai_request_timeout',
      'openai_empty_response',
      'openai_invalid_json',
      'openai_refusal',
    ].includes(error?.message)
  ) {
    return 502;
  }

  if (error?.message === 'invalid_uuid') return 400;
  if (error?.message === 'missing_db_password') return 503;

  return 400;
}

function getInterviewErrorStatus(error) {
  if (['missing_interview_agent_id', 'missing_interview_api_key', 'missing_db_password'].includes(error?.message)) {
    return 503;
  }

  if (error?.message === 'unknown_interview_session') return 404;
  if (error?.message === 'invalid_uuid') return 400;

  return 400;
}

function getCoursePayloads(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.courses)) return body.courses;
  if (Array.isArray(body?.items)) return body.items;
  if (body?.course && typeof body.course === 'object') return [body.course];
  if (body && typeof body === 'object') return [body];
  return [];
}

function normalizeCoursePayload(course, fallbackSource = '') {
  const source = cleanText(course.source || fallbackSource || 'exa');
  const provider = cleanText(course.provider || course.organization || course.institution || source);
  const title = cleanText(course.title || course.name || course.course_title);
  const sourceUrl = cleanText(course.source_url || course.url || course.link);
  const externalId =
    cleanText(course.external_id || course.externalId || course.id || course.slug) ||
    createStableExternalId(source, title, sourceUrl);
  const cost = parseOptionalNumber(course.cost ?? course.price);
  const isFree =
    parseOptionalBoolean(course.is_free ?? course.free ?? course.isFree) ??
    (cost === 0 ? true : undefined);

  if (!title) {
    throw new Error('missing_course_title');
  }

  return {
    source,
    external_id: externalId,
    provider,
    title,
    area: cleanText(course.area || course.category || course.topic),
    description: limitChars(cleanText(course.description || course.summary || course.text), 4000),
    modality: cleanText(course.modality || course.mode || course.format),
    country: cleanText(course.country) || 'El Salvador',
    department: cleanText(course.department || course.state),
    municipality: cleanText(course.municipality || course.city),
    is_free: isFree ?? null,
    cost,
    currency: cleanText(course.currency) || 'USD',
    duration_hours: parseOptionalInteger(course.duration_hours ?? course.durationHours ?? course.hours),
    schedule: cleanText(course.schedule || course.timetable),
    start_date: parseOptionalDate(course.start_date || course.startDate),
    end_date: parseOptionalDate(course.end_date || course.endDate),
    level: cleanText(course.level),
    requirements: normalizeTextArray(course.requirements),
    skills: normalizeTextArray(course.skills),
    target_roles: normalizeTextArray(course.target_roles || course.targetRoles || course.roles),
    certificate: parseOptionalBoolean(course.certificate ?? course.has_certificate ?? course.hasCertificate) ?? null,
    source_url: sourceUrl,
    status: normalizeCourseStatus(course.status),
    raw: sanitizeForPostgresJson(course),
  };
}

async function upsertCourse(db, course) {
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        ...course,
        raw: undefined,
      }),
    )
    .digest('hex');
  const values = [
    course.source,
    course.external_id,
    course.provider,
    course.title,
    course.area,
    course.description,
    course.modality,
    course.country,
    course.department,
    course.municipality,
    course.is_free,
    course.cost,
    course.currency,
    course.duration_hours,
    course.schedule,
    course.start_date,
    course.end_date,
    course.level,
    JSON.stringify(course.requirements),
    JSON.stringify(course.skills),
    JSON.stringify(course.target_roles),
    course.certificate,
    course.source_url,
    course.status,
    stringifyPostgresJson(course.raw),
    contentHash,
  ];
  const result = await db.query(
    `
    insert into public.courses (
      source,
      external_id,
      provider,
      title,
      area,
      description,
      modality,
      country,
      department,
      municipality,
      is_free,
      cost,
      currency,
      duration_hours,
      schedule,
      start_date,
      end_date,
      level,
      requirements,
      skills,
      target_roles,
      certificate,
      source_url,
      status,
      raw,
      content_hash
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb,
      $21::jsonb, $22, $23, $24, $25::jsonb, $26
    )
    on conflict (source, external_id)
    do update set
      provider = excluded.provider,
      title = excluded.title,
      area = excluded.area,
      description = excluded.description,
      modality = excluded.modality,
      country = excluded.country,
      department = excluded.department,
      municipality = excluded.municipality,
      is_free = excluded.is_free,
      cost = excluded.cost,
      currency = excluded.currency,
      duration_hours = excluded.duration_hours,
      schedule = excluded.schedule,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      level = excluded.level,
      requirements = excluded.requirements,
      skills = excluded.skills,
      target_roles = excluded.target_roles,
      certificate = excluded.certificate,
      source_url = excluded.source_url,
      status = excluded.status,
      raw = excluded.raw,
      content_hash = excluded.content_hash,
      last_seen_at = now()
    returning id, source, external_id, title, provider, status, source_url, updated_at
    `,
    values,
  );

  return result.rows[0];
}

function getJobPayloads(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.jobs)) return body.jobs;
  if (Array.isArray(body?.vacancies)) return body.vacancies;
  if (Array.isArray(body?.items)) return body.items;
  if (body?.job && typeof body.job === 'object') return [body.job];
  if (body?.vacancy && typeof body.vacancy === 'object') return [body.vacancy];
  if (body && typeof body === 'object') return [body];
  return [];
}

function normalizeJobPayload(job, fallbackSource = '') {
  const source = cleanText(job.source || fallbackSource || 'exa');
  const provider = cleanText(job.provider || job.job_board || job.platform || source);
  const title = cleanText(job.title || job.name || job.position || job.role);
  const company = cleanText(job.company || job.company_name || job.employer || job.organization);
  const sourceUrl = cleanText(job.source_url || job.url || job.link);
  const applyUrl = cleanText(job.apply_url || job.applyUrl || job.application_url || sourceUrl);
  const expiresAt = parseOptionalDate(job.expires_at || job.expiresAt || job.deadline || job.application_deadline);
  const normalizedStatus = normalizeJobStatus(job.status);
  const externalId =
    cleanText(job.external_id || job.externalId || job.id || job.slug) ||
    createStableExternalId(source, title, sourceUrl);

  if (!title) {
    throw new Error('missing_job_title');
  }

  return {
    source,
    external_id: externalId,
    provider,
    title,
    company,
    area: cleanText(job.area || job.category || job.department_area || job.job_area),
    description: limitChars(cleanText(job.description || job.summary || job.text), 5000),
    employment_type: cleanText(job.employment_type || job.employmentType || job.contract_type || job.contractType),
    modality: cleanText(job.modality || job.mode || job.work_mode || job.workMode),
    country: cleanText(job.country) || 'El Salvador',
    department: cleanText(job.department || job.state),
    municipality: cleanText(job.municipality || job.city),
    location_text: cleanText(job.location_text || job.location || job.locationText),
    salary_min: parseOptionalNumber(job.salary_min ?? job.salaryMin ?? job.min_salary ?? job.minSalary),
    salary_max: parseOptionalNumber(job.salary_max ?? job.salaryMax ?? job.max_salary ?? job.maxSalary),
    currency: cleanText(job.currency) || 'USD',
    schedule: cleanText(job.schedule || job.timetable),
    posted_at: parseOptionalDate(job.posted_at || job.postedAt || job.published_at || job.publishedAt),
    expires_at: expiresAt,
    experience_level: cleanText(job.experience_level || job.experienceLevel || job.experience),
    education_level: cleanText(job.education_level || job.educationLevel || job.education),
    requirements: normalizeTextArray(job.requirements || job.requisitos),
    skills: normalizeTextArray(job.skills || job.habilidades),
    benefits: normalizeTextArray(job.benefits || job.beneficios),
    source_url: sourceUrl,
    apply_url: applyUrl,
    status: normalizedStatus === 'active' && isPastDate(expiresAt) ? 'closed' : normalizedStatus,
    raw: sanitizeForPostgresJson(job),
  };
}

async function upsertJobVacancy(db, job) {
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        ...job,
        raw: undefined,
      }),
    )
    .digest('hex');
  const values = [
    job.source,
    job.external_id,
    job.provider,
    job.title,
    job.company,
    job.area,
    job.description,
    job.employment_type,
    job.modality,
    job.country,
    job.department,
    job.municipality,
    job.location_text,
    job.salary_min,
    job.salary_max,
    job.currency,
    job.schedule,
    job.posted_at,
    job.expires_at,
    job.experience_level,
    job.education_level,
    JSON.stringify(job.requirements),
    JSON.stringify(job.skills),
    JSON.stringify(job.benefits),
    job.source_url,
    job.apply_url,
    job.status,
    stringifyPostgresJson(job.raw),
    contentHash,
  ];
  const result = await db.query(
    `
    insert into public.job_vacancies (
      source,
      external_id,
      provider,
      title,
      company,
      area,
      description,
      employment_type,
      modality,
      country,
      department,
      municipality,
      location_text,
      salary_min,
      salary_max,
      currency,
      schedule,
      posted_at,
      expires_at,
      experience_level,
      education_level,
      requirements,
      skills,
      benefits,
      source_url,
      apply_url,
      status,
      raw,
      content_hash
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22::jsonb, $23::jsonb, $24::jsonb, $25, $26, $27, $28::jsonb, $29
    )
    on conflict (source, external_id)
    do update set
      provider = excluded.provider,
      title = excluded.title,
      company = excluded.company,
      area = excluded.area,
      description = excluded.description,
      employment_type = excluded.employment_type,
      modality = excluded.modality,
      country = excluded.country,
      department = excluded.department,
      municipality = excluded.municipality,
      location_text = excluded.location_text,
      salary_min = excluded.salary_min,
      salary_max = excluded.salary_max,
      currency = excluded.currency,
      schedule = excluded.schedule,
      posted_at = excluded.posted_at,
      expires_at = excluded.expires_at,
      experience_level = excluded.experience_level,
      education_level = excluded.education_level,
      requirements = excluded.requirements,
      skills = excluded.skills,
      benefits = excluded.benefits,
      source_url = excluded.source_url,
      apply_url = excluded.apply_url,
      status = excluded.status,
      raw = excluded.raw,
      content_hash = excluded.content_hash,
      last_seen_at = now()
    returning id, source, external_id, title, company, provider, status, source_url, updated_at
    `,
    values,
  );

  return result.rows[0];
}

async function recordDatasetSyncRun(db, { dataset, source, itemsSeen, itemsUpserted, metadata }) {
  await db.query(
    `
    insert into public.dataset_sync_runs (
      dataset,
      source,
      status,
      items_seen,
      items_upserted,
      metadata
    )
    values ($1, $2, 'completed', $3, $4, $5::jsonb)
    `,
    [
      dataset,
      source,
      itemsSeen,
      itemsUpserted,
      stringifyPostgresJson(metadata || {}),
    ],
  );
}

function requireAdminSession(request, response, next) {
  if (isAdminRequest(request)) {
    next();
    return;
  }

  response.status(401).json({
    ok: false,
    error: 'Sesion admin requerida.',
  });
}

function requireIntakeCreator(request, response, next) {
  if (isAdminRequest(request) || hasValidIntakeApiKey(request)) {
    next();
    return;
  }

  response.status(401).json({
    ok: false,
    error: 'API key requerida para crear registros.',
  });
}

function requireDatasetWriter(request, response, next) {
  if (isAdminRequest(request) || hasValidDatasetApiKey(request)) {
    next();
    return;
  }

  response.status(401).json({
    ok: false,
    error: 'API key requerida para sincronizar datasets.',
  });
}

function requireInterviewFeedbackWriter(request, response, next) {
  if (!getInterviewApiKey()) {
    response.status(503).json({
      ok: false,
      error: getPublicError(new Error('missing_interview_api_key')),
    });
    return;
  }

  if (isAdminRequest(request) || hasValidInterviewApiKey(request)) {
    next();
    return;
  }

  response.status(401).json({
    ok: false,
    error: 'API key requerida para guardar feedback de entrevista.',
  });
}

function isAdminAuthConfigured() {
  return Boolean(getAdminPassword() && getSessionSecret());
}

function isAdminRequest(request) {
  const token = parseCookies(request.headers.cookie || '')[adminCookieName];
  return verifyAdminSessionToken(token);
}

function hasValidIntakeApiKey(request) {
  const expectedKey = getIntakeApiKey();
  const providedKey = getApiKeyFromRequest(request);

  return Boolean(expectedKey && providedKey && timingSafeTextEqual(providedKey, expectedKey));
}

function hasValidDatasetApiKey(request) {
  const expectedKey = getDatasetApiKey();
  const providedKey = getApiKeyFromRequest(request);

  return Boolean(expectedKey && providedKey && timingSafeTextEqual(providedKey, expectedKey));
}

function hasValidInterviewApiKey(request) {
  const expectedKey = getInterviewApiKey();
  const providedKey = getApiKeyFromRequest(request);

  return Boolean(expectedKey && providedKey && timingSafeTextEqual(providedKey, expectedKey));
}

function getApiKeyFromRequest(request) {
  const headerKey = cleanText(request.get('x-trabajoya-key'));
  const authorization = cleanText(request.get('authorization'));

  if (headerKey) return headerKey;

  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return '';
}

function getAdminPassword() {
  return cleanText(process.env.TRABAJOYA_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD);
}

function getSessionSecret() {
  return cleanText(process.env.TRABAJOYA_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET);
}

function getIntakeApiKey() {
  return cleanText(process.env.TRABAJOYA_INTAKE_API_KEY || process.env.INTAKE_API_KEY);
}

function getDatasetApiKey() {
  return cleanText(
    process.env.TRABAJOYA_DATASET_API_KEY ||
      process.env.DATASET_API_KEY ||
      process.env.TRABAJOYA_INTAKE_API_KEY ||
      process.env.INTAKE_API_KEY,
  );
}

function getExaApiKey() {
  return cleanText(process.env.EXA_API_KEY);
}

function getOpenAiApiKey() {
  return cleanText(process.env.OPENAI_API_KEY);
}

function getOpenAiMatchModel() {
  return cleanText(process.env.OPENAI_MATCH_MODEL) || 'gpt-5.4-mini';
}

function getInterviewAgentId() {
  return cleanText(process.env.ELEVENLABS_INTERVIEW_AGENT_ID);
}

function getInterviewApiKey() {
  return cleanText(process.env.TRABAJOYA_INTERVIEW_API_KEY || process.env.INTERVIEW_API_KEY);
}

function getInterviewFeedbackWebhookUrl() {
  return cleanText(process.env.N8N_INTERVIEW_FEEDBACK_WEBHOOK_URL);
}

function getVoiceFeedbackApiUrl() {
  return cleanText(process.env.VOICE_FEEDBACK_API_URL || process.env.INTERVIEW_VOICE_FEEDBACK_API_URL);
}

function getVoiceFeedbackApiKey() {
  return cleanText(process.env.VOICE_FEEDBACK_API_KEY || process.env.INTERVIEW_VOICE_FEEDBACK_API_KEY);
}

function getVoiceFeedbackMessageApiUrl() {
  return cleanText(
    process.env.VOICE_FEEDBACK_MESSAGE_API_URL ||
      process.env.INTERVIEW_VOICE_FEEDBACK_MESSAGE_API_URL ||
      deriveVoiceFeedbackMessageApiUrl(getVoiceFeedbackApiUrl()),
  );
}

function getVoiceFeedbackMessageApiKey() {
  return cleanText(
    process.env.VOICE_FEEDBACK_MESSAGE_API_KEY ||
      process.env.INTERVIEW_VOICE_FEEDBACK_MESSAGE_API_KEY ||
      getVoiceFeedbackApiKey(),
  );
}

function getVoiceFeedbackMessageText() {
  return cleanText(process.env.VOICE_FEEDBACK_MESSAGE_TEXT || process.env.INTERVIEW_VOICE_FEEDBACK_MESSAGE_TEXT) || defaultVoiceFeedbackMessageText;
}

function getVoiceFeedbackMaxChars() {
  return clampNumber(Number(process.env.VOICE_FEEDBACK_MAX_CHARS || defaultVoiceFeedbackMaxChars), 300, 900);
}

function getVoiceFeedbackTimeoutMs() {
  return clampNumber(Number(process.env.VOICE_FEEDBACK_TIMEOUT_MS || defaultVoiceFeedbackTimeoutMs), 3000, 30000);
}

function isVoiceFeedbackConfigured() {
  return Boolean(getVoiceFeedbackApiUrl() && getVoiceFeedbackApiKey());
}

function isVoiceFeedbackMessageConfigured() {
  return Boolean(getVoiceFeedbackMessageApiUrl() && getVoiceFeedbackMessageApiKey() && getVoiceFeedbackMessageText());
}

function deriveVoiceFeedbackMessageApiUrl(url) {
  const value = cleanText(url);

  if (!value) return '';

  try {
    const parsed = new URL(value);
    if (parsed.pathname.endsWith('/api/voice/send')) {
      parsed.pathname = parsed.pathname.replace(/\/api\/voice\/send$/, '/api/message/send');
      return parsed.toString();
    }

    if (parsed.pathname.endsWith('/voice/send')) {
      parsed.pathname = parsed.pathname.replace(/\/voice\/send$/, '/message/send');
      return parsed.toString();
    }
  } catch {
    return '';
  }

  return '';
}

function buildCandidateUrlFromEnv(code) {
  const baseUrl = cleanText(process.env.PUBLIC_APP_URL);

  if (!baseUrl || !code) return '';

  return `${baseUrl.replace(/\/$/, '')}/c/${code}`;
}

function setAdminSessionCookie(response) {
  const token = createAdminSessionToken();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';

  response.setHeader(
    'Set-Cookie',
    `${adminCookieName}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${adminSessionTtlSeconds}${secure}`,
  );
}

function clearAdminSessionCookie(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';

  response.setHeader(
    'Set-Cookie',
    `${adminCookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  );
}

function createAdminSessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iat: now,
      exp: now + adminSessionTtlSeconds,
    }),
  ).toString('base64url');
  const signature = signAdminSessionPayload(payload);

  return `${payload}.${signature}`;
}

function verifyAdminSessionToken(token) {
  const [payload, signature] = String(token || '').split('.');

  if (!payload || !signature || !getSessionSecret()) return false;

  const expectedSignature = signAdminSessionPayload(payload);

  if (!timingSafeTextEqual(signature, expectedSignature)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    return Number(parsed.exp) > now;
  } catch {
    return false;
  }
}

function signAdminSessionPayload(payload) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');

      if (separator === -1) return cookies;

      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();

      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function timingSafeTextEqual(value, expectedValue) {
  const valueHash = createHash('sha256').update(String(value || '')).digest();
  const expectedHash = createHash('sha256').update(String(expectedValue || '')).digest();

  return timingSafeEqual(valueHash, expectedHash);
}

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL && !process.env.PGPASSWORD) {
      throw new Error('missing_db_password');
    }

    pool = new Pool(
      process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.PGHOST || '127.0.0.1',
            port: Number(process.env.PGPORT || 15432),
            database: process.env.PGDATABASE || 'trabajoya',
            user: process.env.PGUSER || 'trabajoya_dbeaver',
            password: process.env.PGPASSWORD,
            max: 4,
          },
    );
  }

  return pool;
}

function getPublicError(error) {
  if (error?.message === 'missing_db_password') {
    return 'Configura PGPASSWORD en .env.local o en la terminal antes de iniciar la API.';
  }

  if (error?.message === 'unsupported_cv_file') {
    return 'Por ahora se aceptan PDF y TXT.';
  }

  if (error?.message === 'empty_cv_text') {
    return 'No pude extraer texto del archivo. Probablemente es un PDF escaneado como imagen.';
  }

  if (error?.message === 'invalid_phone') {
    return 'Usa un telefono de El Salvador: 8 digitos o +503 seguido de 8 digitos.';
  }

  if (error?.message === 'missing_profile') {
    return 'Falta el objeto profile.';
  }

  if (error?.message === 'missing_full_name') {
    return 'Falta el nombre completo del candidato.';
  }

  if (error?.message === 'unknown_intake_code') {
    return 'El codigo de registro no existe.';
  }

  if (error?.message === 'missing_course_title') {
    return 'Cada curso necesita titulo.';
  }

  if (error?.message === 'missing_job_title') {
    return 'Cada vacante necesita titulo.';
  }

  if (error?.message === 'missing_exa_api_key') {
    return 'Configura EXA_API_KEY en Dokploy para buscar oportunidades en vivo.';
  }

  if (error?.message === 'missing_openai_api_key') {
    return 'Configura OPENAI_API_KEY en Dokploy para generar el match del perfil.';
  }

  if (error?.message === 'missing_interview_agent_id') {
    return 'Configura ELEVENLABS_INTERVIEW_AGENT_ID en Dokploy para iniciar simulaciones de entrevista.';
  }

  if (error?.message === 'missing_interview_api_key') {
    return 'Configura TRABAJOYA_INTERVIEW_API_KEY en Dokploy para guardar feedback de entrevista.';
  }

  if (error?.message === 'unknown_interview_session') {
    return 'La simulacion de entrevista no existe.';
  }

  if (error?.message === 'exa_request_failed') {
    return 'Exa no pudo completar la busqueda en vivo.';
  }

  if (error?.message === 'exa_request_timeout') {
    return 'Exa tardo demasiado en responder.';
  }

  if (error?.message === 'openai_request_failed') {
    return 'OpenAI no pudo generar el match del perfil.';
  }

  if (error?.message === 'openai_request_timeout') {
    return 'OpenAI tardo demasiado en responder.';
  }

  if (error?.message === 'openai_invalid_json' || error?.message === 'openai_empty_response') {
    return 'OpenAI respondio sin el formato esperado.';
  }

  if (error?.message === 'openai_refusal') {
    return 'OpenAI rechazo generar recomendaciones para esta solicitud.';
  }

  if (error?.message === 'invalid_uuid') {
    return 'ID invalido.';
  }

  return error?.message || 'No se pudo conectar a Postgres.';
}

async function createUniqueCode(db) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateShortCode();
    const existing = await db.query('select 1 from public.candidate_intakes where code = $1', [code]);

    if (existing.rowCount === 0) {
      return code;
    }
  }

  throw new Error('No se pudo generar un codigo unico.');
}

function generateShortCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[randomInt(0, alphabet.length)];
  }

  return code;
}

function normalizeCode(value) {
  const code = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (!code) {
    throw new Error('Codigo requerido.');
  }

  return code;
}

function normalizeOptionalCode(value) {
  if (!value) return '';
  return normalizeCode(value);
}

function normalizeUuid(value) {
  const id = cleanText(value).toLowerCase();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('invalid_uuid');
  }

  return id;
}

function normalizeOptionalUuid(value) {
  const id = cleanText(value);

  if (!id) return null;

  return normalizeUuid(id);
}

function normalizePhoneSV(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('503') && digits.length === 11 ? digits.slice(3) : digits;

  if (local.length !== 8 || !['2', '6', '7'].includes(local[0])) {
    throw new Error('invalid_phone');
  }

  return `+503${local}`;
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return sanitizePostgresText(String(value)).trim();
}

function limitChars(text, maxLength) {
  const value = cleanText(text);

  if (value.length <= maxLength) return value;

  return value.slice(0, maxLength);
}

function normalizeTextArray(value) {
  const rawValues = Array.isArray(value)
    ? value
    : cleanText(value)
      ? cleanText(value).split(/[,;\n]/)
      : [];
  const seen = new Set();
  const normalized = [];

  for (const item of rawValues) {
    const text = cleanText(typeof item === 'object' ? item?.name || item?.title || item?.value : item);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) continue;

    seen.add(key);
    normalized.push(text);
  }

  return normalized.slice(0, 50);
}

function uniqueCleanTexts(values) {
  const seen = new Set();
  const normalized = [];

  for (const value of values || []) {
    const text = cleanText(value);
    const key = normalizeAscii(text).toLowerCase();

    if (!text || seen.has(key)) continue;

    seen.add(key);
    normalized.push(text);
  }

  return normalized;
}

function pruneUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const pruned = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (childValue === undefined || childValue === '') continue;

    pruned[key] = pruneUndefined(childValue);
  }

  return pruned;
}

function normalizeAscii(value) {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(value) {
  return cleanText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizePostgresText(value) {
  return String(value).replace(/\u0000/g, '');
}

function sanitizeForPostgresJson(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizePostgresText(value);
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPostgresJson(item, seen));
  }

  const sanitized = {};

  for (const [key, childValue] of Object.entries(value)) {
    sanitized[sanitizePostgresText(key)] = sanitizeForPostgresJson(childValue, seen);
  }

  return sanitized;
}

function stringifyPostgresJson(value) {
  return JSON.stringify(sanitizeForPostgresJson(value));
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/[^0-9.-]/g, ''));

  return Number.isFinite(number) ? number : null;
}

function parseOptionalInteger(value) {
  const number = parseOptionalNumber(value);

  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function parseOptionalBoolean(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const text = cleanText(value).toLowerCase();

  if (['true', 'si', 'sí', 'yes', 'gratis', 'free', 'gratuito', '1'].includes(text)) return true;
  if (['false', 'no', '0', 'pagado', 'paid'].includes(text)) return false;

  return undefined;
}

function parseOptionalDate(value) {
  const text = cleanText(value);

  if (!text) return null;

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);

  if (isoMatch) return isoMatch[0];

  const parsed = Date.parse(text);

  if (Number.isNaN(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10);
}

function getIsoDateDaysAgo(days) {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isPastDate(value) {
  const date = parseOptionalDate(value);

  if (!date) return false;

  const today = new Date().toISOString().slice(0, 10);
  return date < today;
}

function normalizeCourseStatus(value) {
  const status = cleanText(value).toLowerCase();
  const allowedStatuses = ['active', 'inactive', 'archived', 'draft'];

  return allowedStatuses.includes(status) ? status : 'active';
}

function normalizeJobStatus(value) {
  const status = cleanText(value).toLowerCase();
  const allowedStatuses = ['active', 'closed', 'inactive', 'archived', 'draft'];

  return allowedStatuses.includes(status) ? status : 'active';
}

function createStableExternalId(source, title, sourceUrl) {
  const input = [source, title, sourceUrl].filter(Boolean).join('|') || String(Date.now());

  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

function buildInitialData(body) {
  const initialData = {
    full_name: cleanText(body.full_name),
    email: cleanText(body.email),
    municipality: cleanText(body.municipality),
    department: cleanText(body.department),
    desired_role: cleanText(body.desired_role),
    notes: cleanText(body.notes),
  };
  const cvText = normalizeIncomingCvText(body);
  const cvFileName = cleanText(body.cv_file_name || body.cv_filename || body.cv?.file_name || body.cv?.filename);
  const cvSource = cleanText(body.cv_source || body.cv?.source);

  if (cvText) {
    initialData.cv_text = cvText;
    initialData.cv_text_length = cvText.length;
  }

  if (cvFileName) {
    initialData.cv_file_name = cvFileName;
  }

  if (cvSource) {
    initialData.cv_source = cvSource;
  }

  return initialData;
}

function serializeIntake(intake, options = {}) {
  return {
    id: intake.id,
    code: intake.code,
    phone: options.includePhone ? intake.phone_e164 : maskPhone(intake.phone_e164),
    phone_last4: intake.phone_last4,
    full_name: intake.full_name || '',
    email: intake.email || '',
    municipality: intake.municipality || '',
    department: intake.department || '',
    desired_role: intake.desired_role || '',
    source: intake.source,
    status: intake.status,
    initial_data: serializeInitialData(intake.initial_data, options),
    profile_id: intake.profile_id,
    created_at: intake.created_at,
    updated_at: intake.updated_at,
    last_accessed_at: intake.last_accessed_at,
    completed_at: intake.completed_at,
  };
}

function serializeInitialData(initialData = {}, options = {}) {
  const data = { ...initialData };
  const cvText = cleanText(data.cv_text);

  if (!cvText || options.includeCvText) {
    return data;
  }

  delete data.cv_text;
  data.cv_text_present = true;
  data.cv_text_preview = cvText.slice(0, 500);
  data.cv_text_length = data.cv_text_length || cvText.length;
  return data;
}

function normalizeIncomingCvText(body) {
  const rawText =
    body.cv_text ||
    body.raw_cv_text ||
    body.cvText ||
    body.cv?.text ||
    body.cv?.raw_text ||
    body.cv?.rawText;
  const text = normalizeExtractedText(rawText);

  return text ? limitText(text) : '';
}

function maskPhone(phone) {
  const text = String(phone || '');
  return text ? `+503 ****-${text.slice(-4)}` : '';
}

function buildIntakeUrl(request, code) {
  const baseUrl =
    process.env.PUBLIC_APP_URL ||
    `${request.get('x-forwarded-proto') || request.protocol}://${request.get('x-forwarded-host') || request.get('host')}`;

  return `${baseUrl.replace(/\/$/, '')}/c/${code}`;
}

async function extractCvText(file) {
  const filename = file.originalname.toLowerCase();
  const isPdf = file.mimetype === 'application/pdf' || filename.endsWith('.pdf');
  const isText =
    file.mimetype === 'text/plain' ||
    (file.mimetype === 'application/octet-stream' && filename.endsWith('.txt')) ||
    filename.endsWith('.txt');

  if (isPdf) {
    const parsed = await pdfParse(file.buffer);
    const text = normalizeExtractedText(parsed.text);

    if (!text) {
      throw new Error('empty_cv_text');
    }

    return {
      text: limitText(text),
      pages: parsed.numpages || null,
    };
  }

  if (isText) {
    const text = normalizeExtractedText(file.buffer.toString('utf8'));

    if (!text) {
      throw new Error('empty_cv_text');
    }

    return {
      text: limitText(text),
      pages: null,
    };
  }

  throw new Error('unsupported_cv_file');
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function limitText(text) {
  if (text.length <= maxCvTextLength) return text;

  return `${text.slice(0, maxCvTextLength)}\n\n[Texto truncado para la conversacion]`;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
