// Supabase Edge Function: tmdb-proxy
// Deploy: supabase functions deploy tmdb-proxy

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY") ?? "";
const TMDB_BASE_URL = Deno.env.get("TMDB_BASE_URL") ?? "https://api.themoviedb.org/3";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,apikey",
      ...(init.headers ?? {})
    }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,apikey"
    }});
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!TMDB_API_KEY) {
    return json({ error: "TMDB_API_KEY is not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => null) as
    | { action: "search"; query: string }
    | { action: "movie"; id: number }
    | { action: "tv"; id: number }
    | null;

  if (!body || !("action" in body)) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  let path = "";
  if (body.action === "search") {
    const q = body.query?.trim();
    if (!q) return json({ error: "Query required" }, { status: 400 });
    path = `/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}`;
  } else if (body.action === "movie") {
    path = `/movie/${body.id}?api_key=${TMDB_API_KEY}`;
  } else if (body.action === "tv") {
    path = `/tv/${body.id}?api_key=${TMDB_API_KEY}`;
  } else {
    return json({ error: "Unsupported action" }, { status: 400 });
  }

  const res = await fetch(`${TMDB_BASE_URL}${path}`);
  const payload = await res.text();

  return new Response(payload, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,apikey"
    }
  });
});
