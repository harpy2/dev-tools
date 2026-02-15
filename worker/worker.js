/**
 * Salmon Tools — Cloudflare Worker Proxy
 * HTTP Request Proxy + Redirect Tracer + Skill Check Share
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function handleProxyRequest(params) {
  let { url, method = 'GET', headers = {}, body } = params;
  if (!url) return jsonResponse({ error: 'URL is required' }, 400);
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

  const blocked = /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|\[::1\])/i;
  if (blocked.test(url)) return jsonResponse({ error: 'Private/internal URLs are not allowed' }, 403);

  const fetchHeaders = { 'User-Agent': 'SalmonTools-HTTP-Client/1.0', ...headers };
  delete fetchHeaders['host'];
  delete fetchHeaders['Host'];

  const start = Date.now();
  try {
    const resp = await fetch(url, {
      method: method.toUpperCase(),
      headers: fetchHeaders,
      body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : body,
      redirect: 'follow',
    });
    const elapsed = Date.now() - start;
    const respBody = await resp.text();
    const respHeaders = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });

    return jsonResponse({
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
      body: respBody.substring(0, 500000),
      size: respBody.length,
      time: elapsed,
      url: resp.url,
    });
  } catch (e) {
    return jsonResponse({ error: e.message, status: 0, statusText: e.message, headers: {}, body: '', size: 0, time: Date.now() - start, url });
  }
}

async function handleRedirectTrace(params) {
  let { url, maxRedirects = 20 } = params;
  if (!url) return jsonResponse({ error: 'URL is required' }, 400);
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

  const blocked = /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|\[::1\])/i;
  if (blocked.test(url)) return jsonResponse({ error: 'Private/internal URLs are not allowed' }, 403);

  const hops = [];
  let currentUrl = url;
  const visited = new Set();

  for (let i = 0; i <= maxRedirects; i++) {
    if (visited.has(currentUrl)) {
      hops.push({ step: i + 1, url: currentUrl, status: 0, statusText: 'Infinite loop detected', location: '', time: 0, headers: {}, final: true });
      break;
    }
    visited.add(currentUrl);

    if (i > 0 && blocked.test(currentUrl)) {
      hops.push({ step: i + 1, url: currentUrl, status: 0, statusText: 'Redirect to private URL blocked', location: '', time: 0, headers: {}, final: true });
      break;
    }

    const start = Date.now();
    try {
      const resp = await fetch(currentUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'SalmonTools-Redirect-Tracer/1.0' },
        redirect: 'manual',
      });
      const elapsed = Date.now() - start;
      const respHeaders = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });
      const location = respHeaders['location'] || '';

      const isRedirect = resp.status >= 300 && resp.status < 400;
      hops.push({
        step: i + 1,
        url: currentUrl,
        status: resp.status,
        statusText: resp.statusText,
        location,
        time: elapsed,
        headers: respHeaders,
        final: !isRedirect || !location,
      });

      if (isRedirect && location) {
        currentUrl = new URL(location, currentUrl).href;
      } else {
        break;
      }
    } catch (e) {
      hops.push({ step: i + 1, url: currentUrl, status: 0, statusText: e.message, location: '', time: Date.now() - start, headers: {}, final: true, error: e.message });
      break;
    }
  }

  const totalTime = hops.reduce((s, h) => s + (h.time || 0), 0);
  return jsonResponse({
    hops,
    totalHops: hops.length,
    totalTime,
    finalUrl: hops.length ? hops[hops.length - 1].url : url,
  });
}

// ===== Skill Check Share =====
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
const GRADE_COLORS = { challenger:'#ff4466', master:'#c084fc', diamond:'#67e8f9', gold:'#ffd700', silver:'#c0c0c0', bronze:'#cd7f32', S:'#ff4466', A:'#ffd700', B:'#4ade80', C:'#60a5fa', D:'#888' };
const GRADE_LABELS = { challenger:'Challenger', master:'Master', diamond:'Diamond', gold:'Gold', silver:'Silver', bronze:'Bronze' };
const GRADE_EMOJI = { challenger:'🏆', master:'👑', diamond:'💎', gold:'🥇', silver:'🥈', bronze:'🥉' };

function handleSkillCheckShare(params) {
  const s = esc(params.get('s') || '0');
  const g = esc(params.get('g') || '?');
  const r = esc(params.get('r') || '0');
  const l = esc(params.get('l') || 'EASY');
  const a = esc(params.get('a') || '0');
  const mc = esc(params.get('mc') || '0');
  const gr = esc(params.get('gr') || '0');
  const go = esc(params.get('go') || '0');
  const m = esc(params.get('m') || '0');

  const gc = GRADE_COLORS[g] || '#888';
  const gl = GRADE_LABELS[g] || g;
  const ge = GRADE_EMOJI[g] || '';
  const qs = `s=${s}&g=${g}&r=${r}&l=${l}&a=${a}&mc=${mc}&gr=${gr}&go=${go}&m=${m}`;
  const gameUrl = `https://skillcheck.salmonholic.com/?${qs}`;
  const ogImgUrl = `https://salmon-tools-api.harpy922.workers.dev/share/skillcheck/og?${qs}`;

  const title = `Skill Check - ${ge} ${gl} | Score ${s}`;
  const desc = `Round ${r} | Level ${l} | Accuracy ${a}% | Great ${gr} | Combo ${mc} - Can you beat this score?`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="${gameUrl}">
<meta property="og:image" content="${ogImgUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${ogImgUrl}">
<meta http-equiv="refresh" content="0;url=${gameUrl}">
<title>${title}</title>
</head>
<body style="background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;">
<h1 style="font-size:3em;color:${gc};">${ge} ${gl}</h1>
<p>Score: ${s} | Round: ${r}</p>
<p><a href="${gameUrl}" style="color:#ff4466;">Play Skill Check</a></p>
</div></body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function handleSkillCheckOG(params) {
  const s = esc(params.get('s') || '0');
  const g = esc(params.get('g') || '?');
  const r = esc(params.get('r') || '0');
  const l = esc(params.get('l') || 'EASY');
  const a = esc(params.get('a') || '0');
  const mc = esc(params.get('mc') || '0');
  const gr = esc(params.get('gr') || '0');
  const go = esc(params.get('go') || '0');
  const m = esc(params.get('m') || '0');

  const gc = GRADE_COLORS[g] || '#888';
  const gl = GRADE_LABELS[g] || g;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect width="1200" height="630" fill="#0a0a0f"/>
<rect width="1200" height="6" fill="${gc}"/>
<text x="600" y="190" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="100" font-weight="900" fill="${gc}">${gl}</text>
<text x="600" y="270" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="700" fill="#eeeeee">Score: ${s}</text>
<text x="600" y="340" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#999999">Round ${r}  |  Level ${l}  |  Accuracy ${a}%</text>
<text x="600" y="400" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#ffd700">Great ${gr}  |  Good ${go}  |  Miss ${m}  |  Combo ${mc}</text>
<text x="600" y="510" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" fill="#ff4466">Skill Check</text>
<text x="600" y="560" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#555555">Can you beat this score?  |  skillcheck.salmonholic.com</text>
</svg>`;

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/request') {
      const params = await request.json();
      return handleProxyRequest(params);
    }

    if (request.method === 'POST' && url.pathname === '/api/redirect-trace') {
      const params = await request.json();
      return handleRedirectTrace(params);
    }

    if (url.pathname === '/share/skillcheck') {
      return handleSkillCheckShare(url.searchParams);
    }
    if (url.pathname === '/share/skillcheck/og') {
      return handleSkillCheckOG(url.searchParams);
    }

    // Score submission
    if (request.method === 'POST' && url.pathname === '/api/skillcheck/score') {
      const params = await request.json();
      return handleScoreSubmit(params, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

// ===== Score System =====
const SCORE_SECRET = 'sk_salmon_2026_xK9mP'; // 서명 검증용

async function hmacSign(data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SCORE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleScoreSubmit(params, env) {
  const { score, round, greats, goods, misses, maxCombo, token, ts } = params;

  // 기본 검증
  if (!score || !round || !token || !ts) return jsonResponse({ error: 'Missing fields' }, 400);
  if (typeof score !== 'number' || score < 0 || score > 999999) return jsonResponse({ error: 'Invalid score' }, 400);
  if (typeof round !== 'number' || round < 1 || round > 9999) return jsonResponse({ error: 'Invalid round' }, 400);

  // 시간 검증 (5분 이내)
  const now = Date.now();
  if (Math.abs(now - ts) > 300000) return jsonResponse({ error: 'Expired' }, 400);

  // HMAC 검증
  const payload = `${score}:${round}:${greats}:${goods}:${misses}:${maxCombo}:${ts}`;
  const expected = await hmacSign(payload);
  if (token !== expected) return jsonResponse({ error: 'Invalid token' }, 403);

  // 점수 합산 검증 (대략적)
  const totalRounds = (greats || 0) + (goods || 0) + (misses || 0);
  if (totalRounds !== round) return jsonResponse({ error: 'Mismatch' }, 400);
  if ((misses || 0) > 3) return jsonResponse({ error: 'Invalid misses' }, 400);

  // KV에 점수 저장 — 버킷 시스템으로 퍼센타일 계산
  // scores:distribution — JSON { "buckets": { "0": count, "1000": count, ... } , "total": N }
  const distKey = 'scores:distribution';
  let dist = await env.SCORES.get(distKey, { type: 'json' }) || { buckets: {}, total: 0 };

  // 1000점 단위 버킷
  const bucket = Math.floor(score / 1000) * 1000;
  dist.buckets[bucket] = (dist.buckets[bucket] || 0) + 1;
  dist.total += 1;

  await env.SCORES.put(distKey, JSON.stringify(dist));

  // 퍼센타일 계산 (이 점수보다 낮은 사람의 비율)
  let below = 0;
  for (const [b, count] of Object.entries(dist.buckets)) {
    if (parseInt(b) < bucket) below += count;
    else if (parseInt(b) === bucket) below += Math.floor(count / 2); // 같은 버킷은 절반
  }
  const percentile = Math.max(1, Math.round((1 - below / dist.total) * 100));

  return jsonResponse({
    percentile,
    totalPlayers: dist.total,
    rank: `Top ${percentile}%`,
  });
}
