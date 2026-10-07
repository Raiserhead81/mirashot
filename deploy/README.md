# Deploy (gemivo-Server)

Live: https://mirashot.gemivo.de · Server-Pfad `/opt/mirashot` · Port 3119

```bash
# 1. Code
git clone https://github.com/Raiserhead81/mirashot.git /opt/mirashot
cd /opt/mirashot && npm install
npx playwright install --with-deps chromium

# 2. Konfiguration (root-only)
#    /etc/mirashot.env — Vorlage: .env.example, chmod 600

# 3. systemd
cp deploy/mirashot.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mirashot

# 4. nginx (Härtung identisch zu anderen vHosts, Access-Log OHNE Query-String)
cp deploy/nginx-mirashot.gemivo.de.conf /etc/nginx/sites-available/mirashot.gemivo.de.conf
ln -sf /etc/nginx/sites-available/mirashot.gemivo.de.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## TLS-Hinweis (Stand 2026-10-07)

Auf dem Server existiert KEIN Wildcard-Zertifikat — jede Subdomain hat ein eigenes
LE-Zertifikat (`sauf.gemivo.de`, `ainews.gemivo.de`, …). Die vHost-Config referenziert
übergangsweise `gemivo-tenants` (SAN-Mismatch für mirashot). Sobald ein Zertifikat
freigegeben ist, genügt:

```bash
certbot certonly --webroot -w /var/www/html -d mirashot.gemivo.de
# dann in deploy/nginx-mirashot.gemivo.de.conf die Pfade auf
# /etc/letsencrypt/live/mirashot.gemivo.de/fullchain.pem umstellen, nginx -t && reload
```

## Datenschutz-Entscheidungen im vHost

- `access_log … noquery;` — Format `"$request_method $uri"`: die abgelichtete URL
  erscheint NIE im Log (verifiziert: 0 Treffer für Test-URLs).
- Keine Cookies, keine Weiterleitung an Dritte, `client_max_body_size 15m` nur wegen
  der Opt-in-KI-Bilder.
