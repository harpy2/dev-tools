#!/usr/bin/env python3
"""Dev Tools 서버 — 정적 파일 + HTTP 프록시 API"""
import http.server
import json
import urllib.request
import urllib.error
import urllib.parse
import ssl
import time
from http.cookies import SimpleCookie

class DevToolsHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/request':
            self.handle_proxy_request()
        elif self.path == '/api/redirect-trace':
            self.handle_redirect_trace()
        else:
            self.send_error(404)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def _json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def handle_proxy_request(self):
        """HTTP 요청 프록시 — 요청 보내고 응답 반환"""
        try:
            params = self._read_body()
            url = params.get('url', '')
            method = params.get('method', 'GET').upper()
            headers = params.get('headers', {})
            body = params.get('body', None)

            if not url:
                return self._json_response({'error': 'URL이 필요합니다'}, 400)

            if not url.startswith(('http://', 'https://')):
                url = 'https://' + url

            # 요청 생성
            req_body = body.encode('utf-8') if body else None
            req = urllib.request.Request(url, data=req_body, method=method)

            # 기본 헤더
            req.add_header('User-Agent', 'DevTools-HTTP-Client/1.0')
            for k, v in headers.items():
                if k.lower() != 'host':
                    req.add_header(k, v)

            # SSL 검증 옵션
            ctx = ssl.create_default_context()
            if params.get('insecure'):
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE

            start = time.time()
            try:
                resp = urllib.request.urlopen(req, timeout=params.get('timeout', 30), context=ctx)
                elapsed = round((time.time() - start) * 1000)
                resp_body = resp.read()

                # 인코딩 감지
                charset = resp.headers.get_content_charset() or 'utf-8'
                try:
                    body_text = resp_body.decode(charset)
                except:
                    body_text = resp_body.decode('utf-8', errors='replace')

                resp_headers = dict(resp.headers.items())

                self._json_response({
                    'status': resp.status,
                    'statusText': resp.reason,
                    'headers': resp_headers,
                    'body': body_text[:500000],  # 500KB 제한
                    'size': len(resp_body),
                    'time': elapsed,
                    'url': resp.url,
                })
            except urllib.error.HTTPError as e:
                elapsed = round((time.time() - start) * 1000)
                body_text = ''
                try:
                    raw = e.read()
                    body_text = raw.decode('utf-8', errors='replace')[:500000]
                except:
                    pass
                self._json_response({
                    'status': e.code,
                    'statusText': e.reason,
                    'headers': dict(e.headers.items()),
                    'body': body_text,
                    'size': len(body_text),
                    'time': elapsed,
                    'url': url,
                })
            except urllib.error.URLError as e:
                elapsed = round((time.time() - start) * 1000)
                self._json_response({
                    'status': 0,
                    'statusText': str(e.reason),
                    'headers': {},
                    'body': '',
                    'size': 0,
                    'time': elapsed,
                    'url': url,
                    'error': str(e.reason),
                })

        except Exception as e:
            self._json_response({'error': str(e)}, 500)

    def handle_redirect_trace(self):
        """리다이렉트 추적 — 각 홉을 기록"""
        try:
            params = self._read_body()
            url = params.get('url', '')
            max_redirects = params.get('maxRedirects', 20)

            if not url:
                return self._json_response({'error': 'URL이 필요합니다'}, 400)

            if not url.startswith(('http://', 'https://')):
                url = 'https://' + url

            ctx = ssl.create_default_context()
            if params.get('insecure'):
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE

            hops = []
            current_url = url
            visited = set()

            for i in range(max_redirects + 1):
                if current_url in visited:
                    hops.append({'url': current_url, 'status': 0, 'statusText': '🔄 무한 루프 감지', 'location': '', 'time': 0, 'headers': {}})
                    break
                visited.add(current_url)

                # 리다이렉트 안 따라가는 opener
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self, req, fp, code, msg, headers, newurl):
                        return None

                opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ctx))
                req = urllib.request.Request(current_url, method='GET')
                req.add_header('User-Agent', 'DevTools-Redirect-Tracer/1.0')

                start = time.time()
                try:
                    resp = opener.open(req, timeout=15)
                    elapsed = round((time.time() - start) * 1000)
                    resp_headers = dict(resp.headers.items())
                    location = resp_headers.get('Location', resp_headers.get('location', ''))

                    hops.append({
                        'step': i + 1,
                        'url': current_url,
                        'status': resp.status,
                        'statusText': resp.reason,
                        'location': location,
                        'time': elapsed,
                        'headers': resp_headers,
                        'final': resp.status < 300 or resp.status >= 400,
                    })

                    if 300 <= resp.status < 400 and location:
                        # 상대 URL 처리
                        current_url = urllib.parse.urljoin(current_url, location)
                    else:
                        break

                except urllib.error.HTTPError as e:
                    elapsed = round((time.time() - start) * 1000)
                    resp_headers = dict(e.headers.items()) if e.headers else {}
                    location = resp_headers.get('Location', resp_headers.get('location', ''))

                    hops.append({
                        'step': i + 1,
                        'url': current_url,
                        'status': e.code,
                        'statusText': e.reason,
                        'location': location,
                        'time': elapsed,
                        'headers': resp_headers,
                        'final': e.code < 300 or e.code >= 400,
                    })

                    if 300 <= e.code < 400 and location:
                        current_url = urllib.parse.urljoin(current_url, location)
                    else:
                        break

                except urllib.error.URLError as e:
                    elapsed = round((time.time() - start) * 1000)
                    hops.append({
                        'step': i + 1,
                        'url': current_url,
                        'status': 0,
                        'statusText': str(e.reason),
                        'location': '',
                        'time': elapsed,
                        'headers': {},
                        'final': True,
                        'error': str(e.reason),
                    })
                    break

            total_time = sum(h.get('time', 0) for h in hops)
            self._json_response({
                'hops': hops,
                'totalHops': len(hops),
                'totalTime': total_time,
                'finalUrl': hops[-1]['url'] if hops else url,
            })

        except Exception as e:
            self._json_response({'error': str(e)}, 500)

    def log_message(self, format, *args):
        # API 호출만 로그
        if '/api/' in (args[0] if args else ''):
            super().log_message(format, *args)


if __name__ == '__main__':
    import os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('0.0.0.0', 3200), DevToolsHandler)
    print('🛠 Dev Tools server running on http://0.0.0.0:3200')
    server.serve_forever()
