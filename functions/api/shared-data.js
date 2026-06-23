const KEY = 'shared-data-v1';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.GIS_DB) {
    return json({ error: 'Cloudflare D1 바인딩 GIS_DB가 설정되지 않았습니다.' }, 500);
  }

  await ensureTable(env);
  const row = await env.GIS_DB.prepare(
    'SELECT value, updated_at FROM app_data WHERE key = ?'
  ).bind(KEY).first();

  if (!row || !row.value) {
    return json({ rows: [], updatedAt: null });
  }

  try {
    const parsed = JSON.parse(row.value);
    return json({
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      updatedAt: parsed.updatedAt || row.updated_at || null
    });
  } catch {
    return json({ error: '저장된 공용자료 형식이 올바르지 않습니다.' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GIS_DB) {
    return json({ error: 'Cloudflare D1 바인딩 GIS_DB가 설정되지 않았습니다.' }, 500);
  }
  if (!env.ADMIN_PASSWORD) {
    return json({ error: '관리자 비밀번호 환경변수 ADMIN_PASSWORD가 설정되지 않았습니다.' }, 500);
  }

  const password = request.headers.get('x-admin-password') || '';
  if (password !== env.ADMIN_PASSWORD) {
    return json({ error: '관리자 비밀번호가 올바르지 않습니다.' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON 형식이 올바르지 않습니다.' }, 400);
  }

  if (!body || !Array.isArray(body.rows)) {
    return json({ error: 'rows 데이터가 없습니다.' }, 400);
  }

  await ensureTable(env);

  const updatedAt = body.updatedAt || new Date().toISOString();
  const value = JSON.stringify({
    updatedAt,
    rows: body.rows
  });

  await env.GIS_DB.prepare(
    `INSERT INTO app_data (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(KEY, value, updatedAt).run();

  await env.GIS_DB.prepare(
    `INSERT INTO upload_logs (kind, count, updated_at)
     VALUES (?, ?, ?)`
  ).bind('shared', body.rows.length, updatedAt).run();

  return json({
    ok: true,
    updatedAt,
    count: body.rows.length
  });
}

async function ensureTable(env) {
  await env.GIS_DB.prepare(
    `CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    )`
  ).run();

  await env.GIS_DB.prepare(
    `CREATE TABLE IF NOT EXISTS upload_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      count INTEGER,
      updated_at TEXT
    )`
  ).run();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
