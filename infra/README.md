# infra

Images blaze runs that are not the app itself. Both enforce their policy in the image,
because Dokploy drops `command` for database services and overrides ENTRYPOINT/CMD, so a
runtime flag can silently disappear.

| Directory | Image | Runs as |
|---|---|---|
| `mongo-tls/` | `127.0.0.1:5000/blaze/mongo-tls:<n>` | the shared MongoDB instance, compose stack `blaze-mongo-tls` |
| `redis-tls/` | `127.0.0.1:5000/blaze/redis-tls:<n>` | one container per Redis tenant (`BLAZE_REDIS_IMAGE`) |

Images are served from the registry on the VPS (`blaze-registry`, `127.0.0.1:5000`).
Swarm services resolve every image through a registry, so a locally built image they
cannot pull is invisible to them.

## Certificates

Self-signed, generated on the VPS and **never committed** (`*.pem` is gitignored). The
private key never leaves the box. Clients connect with "encrypt, do not verify"
(`tlsAllowInvalidCertificates=true` for Mongo, `rejectUnauthorized: false` for Redis), the
same posture as Postgres's `sslmode=require`; see DEPLOY.md, "Residual gap".

```bash
# On the VPS. Mongo: the certificate goes in infra's certs/ directory.
mkdir -p /opt/blaze/mongo-tls/certs && cd /opt/blaze/mongo-tls/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=mongo.blaze.crafter.run \
  -addext "subjectAltName=DNS:mongo.blaze.crafter.run,DNS:localhost,DNS:mongo,DNS:blaze-mongo-tls-ocj5zh-mongo-1,IP:127.0.0.1" \
  -keyout key.pem -out cert.pem
chmod 600 key.pem

# Redis: cert.pem and key.pem sit next to the Dockerfile.
cd /opt/blaze/redis-tls
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=redis.blaze.crafter.run \
  -keyout key.pem -out cert.pem
```

Without `certs/cert.pem` and `certs/key.pem`, the Mongo Dockerfile generates a throwaway
certificate at build time. That is what `docker-compose.dev.yaml` relies on locally.

## Build and push

The sources live here; the build runs on the VPS, where the certificates are.

```bash
# From the repo root
scp infra/mongo-tls/Dockerfile infra/mongo-tls/entrypoint.sh root@95.111.248.246:/opt/blaze/mongo-tls/
ssh root@95.111.248.246 '
  cd /opt/blaze/mongo-tls &&
  docker build -t 127.0.0.1:5000/blaze/mongo-tls:<n> . &&
  docker push 127.0.0.1:5000/blaze/mongo-tls:<n>'

scp infra/redis-tls/Dockerfile infra/redis-tls/entrypoint.sh root@95.111.248.246:/opt/blaze/redis-tls/
ssh root@95.111.248.246 '
  cd /opt/blaze/redis-tls &&
  docker build -t 127.0.0.1:5000/blaze/redis-tls:<n> . &&
  docker push 127.0.0.1:5000/blaze/redis-tls:<n>'
```

Bump `<n>` on every change and never retag: Redis tenants record the tag they were created
from in `instances.version`.

Then:

- **Mongo**: change the `image:` tag in the `blaze-mongo-tls` compose (Dokploy, raw
  compose) and deploy it. Data is on the `mongo-data` volume and survives. Do not add a
  `command:`; the entrypoint refuses caller-supplied TLS, auth and bind flags.
- **Redis**: set `BLAZE_REDIS_IMAGE` in the `blaze-web` environment. Existing tenants keep
  the image they were created with.

## mongo-tls in one paragraph

`entrypoint.sh` appends `--auth --bind_ip_all --tlsMode requireTLS
--tlsCertificateKeyFile /etc/mongo-tls/mongo.pem --tlsCAFile /etc/mongo-tls/ca.pem
--tlsAllowConnectionsWithoutCertificates` to any `mongod` invocation, then hands over to
the official `docker-entrypoint.sh`. Flags rather than a config file, because the official
entrypoint knows how to downgrade `--tlsMode` for its temporary first-start mongod. The
`--tlsCAFile` is the certificate itself: mongod 7+ refuses to start TLS without one
(SERVER-72839), which is why every earlier attempt never listened. The statement timeout
(`defaultMaxTimeMS`) is a cluster parameter, applied by `scripts/bootstrap-instance.ts`.
