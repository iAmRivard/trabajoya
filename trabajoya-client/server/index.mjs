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
app.use(express.json());
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
      message: 'Perfil guardado. El siguiente paso es revisar recomendaciones de empleo.',
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
