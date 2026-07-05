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
    raw: course,
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
    JSON.stringify(course.raw),
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
    expires_at: parseOptionalDate(job.expires_at || job.expiresAt || job.deadline || job.application_deadline),
    experience_level: cleanText(job.experience_level || job.experienceLevel || job.experience),
    education_level: cleanText(job.education_level || job.educationLevel || job.education),
    requirements: normalizeTextArray(job.requirements || job.requisitos),
    skills: normalizeTextArray(job.skills || job.habilidades),
    benefits: normalizeTextArray(job.benefits || job.beneficios),
    source_url: sourceUrl,
    apply_url: applyUrl,
    status: normalizeJobStatus(job.status),
    raw: job,
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
    JSON.stringify(job.raw),
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
      JSON.stringify(metadata || {}),
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
  return String(value).trim();
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
