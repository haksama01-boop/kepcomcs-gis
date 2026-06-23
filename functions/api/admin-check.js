export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ADMIN_PASSWORD) {
    return json({ error: '관리자 비밀번호 환경변수 ADMIN_PASSWORD가 설정되지 않았습니다.' }, 500);
  }

  const password = request.headers.get('x-admin-password') || '';
  if (password !== env.ADMIN_PASSWORD) {
    return json({ error: '관리자 비밀번호가 올바르지 않습니다.' }, 401);
  }

  return json({ ok: true });
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
