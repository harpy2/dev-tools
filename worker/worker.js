/**
 * Salmon Tools — Cloudflare Worker Proxy
 * HTTP Request Proxy + Redirect Tracer
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

  // Block private/internal IPs
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
      hops.push({ step: i + 1, url: currentUrl, status: 0, statusText: '🔄 Infinite loop detected', location: '', time: 0, headers: {}, final: true });
      break;
    }
    visited.add(currentUrl);

    // Block private URLs in redirects too
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

export default {
  async fetch(request) {
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

    // Skill Check share
    if (url.pathname === '/share/skillcheck') {
      return handleSkillCheckShare(url.searchParams);
    }
    if (url.pathname === '/share/skillcheck/og') {
      return handleSkillCheckOG(url.searchParams);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

function handleSkillCheckShare(params) {
  const score = params.get('s') || '0';
  const grade = params.get('g') || '?';
  const round = params.get('r') || '0';
  const level = params.get('l') || 'EASY';
  const accuracy = params.get('a') || '0';
  const maxCombo = params.get('mc') || '0';
  const greats = params.get('gr') || '0';
  const goods = params.get('go') || '0';
  const misses = params.get('m') || '0';

  const gradeColors = { S: '#ff4466', A: '#ffd700', B: '#4ade80', C: '#60a5fa', D: '#888888' };
  const gradeColor = gradeColors[grade] || '#888';
  const gameUrl = `https://skillcheck.salmonholic.com/?s=${score}&g=${grade}&r=${round}&l=${level}&a=${accuracy}&mc=${maxCombo}&gr=${greats}&go=${goods}&m=${misses}`;

  // Generate OG image as SVG data URI
  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#0a0a0f"/>
    <rect width="1200" height="6" fill="${gradeColor}"/>
    <text x="600" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-size="120" font-weight="900" fill="${gradeColor}">${grade}</text>
    <text x="600" y="260" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" fill="#eeeeee">Score: ${score}  |  Round: ${round}</text>
    <text x="600" y="330" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#888888">Level: ${level}  |  Accuracy: ${accuracy}%  |  Combo: ${maxCombo}</text>
    <text x="600" y="400" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#ffd700">Great: ${greats}  |  Good: ${goods}  |  Miss: ${misses}</text>
    <text x="600" y="510" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" fill="#ff4466">⚡ Skill Check</text>
    <text x="600" y="560" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#555555">Can you beat this score?</text>
  </svg>`;
  const ogImage = `data:image/svg+xml;base64,${btoa(ogSvg)}`;

  const title = `⚡ Skill Check — Grade ${grade} | Score ${score}`;
  const description = `Round ${round} | Level ${level} | Accuracy ${accuracy}% | Great ${greats} | Combo ${maxCombo} — Can you beat this score?`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${gameUrl}">
<meta property="og:image" content="https://salmon-tools-api.harpy922.workers.dev/share/skillcheck/og?s=${score}&g=${grade}&r=${round}&l=${level}&a=${accuracy}&mc=${maxCombo}&gr=${greats}&go=${goods}&m=${misses}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="https://salmon-tools-api.harpy922.workers.dev/share/skillcheck/og?s=${score}&g=${grade}&r=${round}&l=${level}&a=${accuracy}&mc=${maxCombo}&gr=${greats}&go=${goods}&m=${misses}">
<meta http-equiv="refresh" content="0;url=${gameUrl}">
<title>${title}</title>
</head>
<body style="background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;">
<h1 style="font-size:4em;color:${gradeColor};">${grade}</h1>
<p>Score: ${score} | Round: ${round}</p>
<p><a href="${gameUrl}" style="color:#ff4466;">Play Skill Check →</a></p>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
  });
}

function handleSkillCheckOG(params) {
  const score = params.get('s') || '0';
  const grade = params.get('g') || '?';
  const round = params.get('r') || '0';
  const level = params.get('l') || 'EASY';
  const accuracy = params.get('a') || '0';
  const maxCombo = params.get('mc') || '0';
  const greats = params.get('gr') || '0';
  const goods = params.get('go') || '0';
  const misses = params.get('m') || '0';

  const gradeColors = { S: '#ff4466', A: '#ffd700', B: '#4ade80', C: '#60a5fa', D: '#888888' };
  const gc = gradeColors[grade] || '#888';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#0a0a0f"/>
    <rect width="1200" height="6" fill="${gc}"/>
    <text x="600" y="190" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="140" font-weight="900" fill="${gc}">${grade}</text>
    <text x="600" y="270" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="700" fill="#eeeeee">Score: ${score}</text>
    <text x="600" y="340" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#999999">Round ${round}  ·  Level ${level}  ·  Accuracy ${accuracy}%</text>
    <text x="600" y="400" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#ffd700">✨ Great ${greats}   👍 Good ${goods}   💨 Miss ${misses}   🔥 Combo ${maxCombo}</text>
    <text x="600" y="510" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" fill="#ff4466">⚡ Skill Check</text>
    <text x="600" y="560" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#555555">Can you beat this score?  ·  skillcheck.salmonholic.com</text>
  </svg>`;

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400', ...CORS_HEADERS },
  });
}
