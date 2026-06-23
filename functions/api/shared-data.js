const KEY = 'shared-data-v1';
const CHUNK_SIZE = 250;

export async function onRequestGet(context) {
  const { env } = context;

  try {
    if (!env.GIS_DB) {
      return json({ error: 'Cloudflare D1 바인딩 GIS_DB가 설정되지 않았습니다.' }, 500);
    }

    await ensureTable(env);

    const meta = await env.GIS_DB
      .prepare('SELECT updated_at, row_count, chunk_count FROM shared_meta WHERE key = ?')
      .bind(KEY)
      .first();

    if (!meta) {
      return json({ rows: [], updatedAt: null });
    }

    const chunks = await env.GIS_DB
      .prepare('SELECT chunk_index, value FROM shared_chunks WHERE key = ? ORDER BY chunk_index ASC')
      .bind(KEY)
      .all();

    const rows = [];
    for (const item of (chunks.results || [])) {
      try {
        const part = JSON.parse(item.value || '[]');
        if (Array.isArray(part)) rows.push(...part);
      } catch {
        return json({ error: `공용자료 조각 ${item.chunk_index}번을 읽는 중 오류가 발생했습니다.` }, 500);
      }
    }

    return json({
      rows,
      updatedAt: meta.updated_at || null,
      rowCount: meta.row_count || rows.length,
      chunkCount: meta.chunk_count || (chunks.results || []).length
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
    const rows = body.rows;
    const chunkCount = Math.ceil(rows.length / CHUNK_SIZE);

    await ensureTable(env);

    // 기존 공용자료 삭제
    await env.GIS_DB.prepare('DELETE FROM shared_chunks WHERE key = ?').bind(KEY).run();
    await env.GIS_DB.prepare('DELETE FROM shared_meta WHERE key = ?').bind(KEY).run();

    // 새 공용자료 메타 저장
    await env.GIS_DB
      .prepare('INSERT INTO shared_meta (key, updated_at, row_count, chunk_count) VALUES (?, ?, ?, ?)')
      .bind(KEY, updatedAt, rows.length, chunkCount)
      .run();

    // 자료를 여러 조각으로 나누어 저장
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SIZE;
      const end = start + CHUNK_SIZE;
      const part = rows.slice(start, end);
      const value = JSON.stringify(part);

      await env.GIS_DB
        .prepare('INSERT INTO shared_chunks (key, chunk_index, value) VALUES (?, ?, ?)')
        .bind(KEY, i, value)
        .run();
    }

    await env.GIS_DB
      .prepare('INSERT INTO upload_logs (kind, count, chunk_count, updated_at) VALUES (?, ?, ?, ?)')
      .bind('shared', rows.length, chunkCount, updatedAt)
      .run();

    return json({
      ok: true,
      updatedAt,
      count: rows.length,
      chunkCount
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
    .prepare(`CREATE TABLE IF NOT EXISTS shared_meta (
      key TEXT PRIMARY KEY,
      updated_at TEXT,
      row_count INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0
    )`)
    .run();

  await env.GIS_DB
    .prepare(`CREATE TABLE IF NOT EXISTS shared_chunks (
      key TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (key, chunk_index)
    )`)
    .run();

  await env.GIS_DB
    .prepare(`CREATE TABLE IF NOT EXISTS upload_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      count INTEGER,
      chunk_count INTEGER DEFAULT 0,
      updated_at TEXT
    )`)
    .run();

  // v3.2 이전 테이블이 있어도 문제 없도록 유지
  await env.GIS_DB
    .prepare(`CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
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
