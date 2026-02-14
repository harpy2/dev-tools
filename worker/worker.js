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

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
