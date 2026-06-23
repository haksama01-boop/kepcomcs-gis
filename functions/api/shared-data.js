const KEY = 'shared-data-v1';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    if (!env.GIS_DB) {
      return json({ error: 'Cloudflare D1 바인딩 GIS_DB가 설정되지 않았습니다.' }, 500);
    }

    await ensureTable(env);

    const row = await env.GIS_DB
      .prepare('SELECT value, updated_at FROM app_data WHERE key = ?')
      .bind(KEY)
      .first();

    if (!row || !row.value) {
      return json({ rows: [], updatedAt: null });
    }

    const parsed = JSON.parse(row.value);
    return json({
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      updatedAt: parsed.updatedAt || row.updated_at || null
    });
  } catch (err) {
    return json({
      error: '공용자료를 불러오는 중 오류가 발생했습니다.',
      detail: String(err && err.message ? err.message : err)
    }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
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
      return json({ error: '전송 데이터가 JSON 형식이 아닙니다.' }, 400);
    }

    if (!body || !Array.isArray(body.rows)) {
      return json({ error: 'rows 데이터가 없습니다.' }, 400);
    }

    const updatedAt = body.updatedAt || new Date().toISOString();
    const payload = JSON.stringify({
      updatedAt,
      rows: body.rows
    });

    await ensureTable(env);

    // D1 호환성을 높이기 위해 UPSERT 대신 DELETE 후 INSERT 방식 사용
    await env.GIS_DB
      .prepare('DELETE FROM app_data WHERE key = ?')
      .bind(KEY)
      .run();

    await env.GIS_DB
      .prepare('INSERT INTO app_data (key, value, updated_at) VALUES (?, ?, ?)')
      .bind(KEY, payload, updatedAt)
      .run();

    await env.GIS_DB
      .prepare('INSERT INTO upload_logs (kind, count, updated_at) VALUES (?, ?, ?)')
      .bind('shared', body.rows.length, updatedAt)
      .run();

    return json({
      ok: true,
      updatedAt,
      count: body.rows.length
    });
  } catch (err) {
    return json({
      error: '공용자료 저장 중 서버 오류가 발생했습니다.',
      detail: String(err && err.message ? err.message : err)
    }, 500);
  }
}

async function ensureTable(env) {
  await env.GIS_DB
    .prepare(`CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    )`)
    .run();

  await env.GIS_DB
    .prepare(`CREATE TABLE IF NOT EXISTS upload_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      count INTEGER,
      updated_at TEXT
    )`)
    .run();
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
