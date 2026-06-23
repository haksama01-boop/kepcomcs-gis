const KEY = 'shared-data-v1';

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.GIS_KV) {
    return json({ error: 'Cloudflare KV 바인딩 GIS_KV가 설정되지 않았습니다.' }, 500);
  }

  const value = await env.GIS_KV.get(KEY);
  if (!value) {
    return json({ rows: [], updatedAt: null });
  }

  return new Response(value, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GIS_KV) {
    return json({ error: 'Cloudflare KV 바인딩 GIS_KV가 설정되지 않았습니다.' }, 500);
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

  const payload = JSON.stringify({
    updatedAt: body.updatedAt || new Date().toISOString(),
    rows: body.rows
  });

  await env.GIS_KV.put(KEY, payload);

  return json({
    ok: true,
    updatedAt: body.updatedAt || new Date().toISOString(),
    count: body.rows.length
  });
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
