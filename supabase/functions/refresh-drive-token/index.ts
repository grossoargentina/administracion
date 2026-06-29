import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { refresh_token } = await req.json();
    if (!refresh_token) return new Response('refresh_token requerido', { status: 400, headers: CORS });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: '664461187683-b145984eib5l1k1h2e0up30dvs86k50i.apps.googleusercontent.com',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        grant_type: 'refresh_token',
        refresh_token,
      }),
    });

    const data = await res.json();
    if (!res.ok) return new Response(JSON.stringify(data), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({ access_token: data.access_token, expires_in: data.expires_in }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(String(e), { status: 500, headers: CORS });
  }
});
