import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Solo usuarios logueados en la plataforma y autorizados pueden usar esta función.
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') || 'administracion@grossoarg.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

async function requireAdmin(req: Request): Promise<Response | null> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearers+/i, '');
  const deny = (msg: string) => new Response(JSON.stringify({ error: msg }), {
    status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
  if (!jwt) return deny('No autorizado');
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return deny('Sesión inválida o vencida');
  const user = await res.json();
  if (!ADMIN_EMAILS.includes(String(user?.email || '').toLowerCase())) return deny('Usuario no autorizado');
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const { to, subject, html } = await req.json();
    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'to, subject y html son requeridos' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY no configurada' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Grosso Argentina <administracion@grossoarg.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.message || 'Error de Resend', details: data }), {
        status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
