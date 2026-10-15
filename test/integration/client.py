"""Public n8n API + registered test-only 1C bridge; no UI/session cookies."""
from __future__ import annotations
import base64
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class RequestFailure(RuntimeError):
    pass


class Http:
    def __init__(self, secrets=()):
        self.secrets=list(filter(None,secrets))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, method, url, data=None, headers=None, timeout=90, binary=False):
        request = urllib.request.Request(url, method=method,
            data=None if data is None else json.dumps(data, ensure_ascii=False).encode(),
            headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            with self.opener.open(request, timeout=timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            # Do not expose request URLs, credentials, pairing secrets or payloads.
            
            detail=''
            try:
                detail=str((lambda value:value.get('error',value.get('message','')))(json.loads(error.read())))
                for secret in self.secrets:
                    if secret:detail=detail.replace(str(secret),'[redacted]')
                for value in (headers or {}).values():
                    if len(str(value))>12:detail=detail.replace(str(value),'[redacted]')
                detail=re.sub(r'[A-Za-z0-9_-]{32,}', '[redacted]', detail)
                detail=re.sub(r'https?://[^\s]+', '[url]', detail)[:600]
            except (ValueError,AttributeError):pass
            raise RequestFailure(f'HTTP {error.code}'+(': '+detail if detail else '')) from None
        except urllib.error.URLError:
            raise RequestFailure('Connection unavailable') from None
        if binary:
            return raw
        return json.loads(raw) if raw else None


def registered_database(name):
    codex = Path(os.environ.get('CODEX_HOME', Path.home()/'.codex'))
    resolver = codex/'skills/test-databases/scripts/resolve-registry.py'
    result = subprocess.run([sys.executable, str(resolver)], capture_output=True, text=True)
    if result.returncode:
        raise RequestFailure('Test database registry resolver failed')
    databases = json.loads(Path(result.stdout.strip()).read_text())['databases']
    matches = [d for d in databases if d.get('Ref', '').casefold() == name.casefold()]
    if len(matches) != 1 or not matches[0].get('Bridge', {}).get('BaseUrl'):
        raise RequestFailure('Exactly one registered test database with bridge is required')
    return matches[0]


class Bridge:
    def __init__(self, database):
        self.http = Http([database.get('Password','')])
        self.url = database['Bridge']['BaseUrl'].rstrip('/')
        self.auth = {'Authorization': 'Basic '+base64.b64encode(
            (database.get('User', '')+':'+database.get('Password', '')).encode()).decode()}

    def command(self, name, **values):
        response = self.http.call('POST', self.url+'/command', {'command': name, **values}, self.auth)
        if response.get('ok') is not True:
            # Normalized code only, never raw bridge errors/settings snapshots.
            error = str(response.get('error', 'Bridge command failed'))
            known = ['access_denied','field_not_allowed','field_value_invalid','revision_conflict',
                     'document_not_editable','object_not_found','cycle_capture_requires_transaction']
            raise RequestFailure(next((v for v in known if v in error), 'Bridge command failed'))
        return response.get('result')

    def bsl(self, code, params=None):
        return self.command('ExecuteBSL', code=code, params=params or [])

    def fixture(self, name, params=None):
        return self.bsl((Path(__file__).parent/'fixtures'/name).read_text(), params)

    def preflight(self):
        health = self.http.call('GET', self.url+'/health', headers=self.auth)
        assert health.get('ok') is True
        self.command('Capabilities')


class N8n:
    def __init__(self, url, key):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ['http', 'https'] or parsed.username or parsed.password:
            raise RequestFailure('Use a plain test n8n HTTP(S) URL')
        if parsed.hostname and (parsed.hostname.rstrip('.').endswith('.msrv.tech') or parsed.hostname.rstrip('.') == 'msrv.tech'):
            raise RequestFailure('Standalone tests cannot target MSRV')
        self.url = url.rstrip('/')
        self.headers = {'X-N8N-API-KEY': key}
        self.http = Http([key])

    def api(self, method, path, body=None):
        return self.http.call(method, self.url+'/api/v1'+path, body, self.headers)
