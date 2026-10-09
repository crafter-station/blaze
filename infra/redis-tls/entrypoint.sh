#!/bin/sh
# Dokploy runs `sh -c "redis-server --requirepass <pw>"`, so those args arrive as "$@".
# It overrides ENTRYPOINT/CMD and ignores its own `command` field for database services,
# which is why policy lives in the image instead of in the service definition.
set -e

# TLS only: `--port 0` closes the plaintext listener entirely.
set -- "$@" --port 0 --tls-port 6379 \
  --tls-cert-file /etc/redis-tls/cert.pem \
  --tls-key-file /etc/redis-tls/key.pem \
  --tls-auth-clients no

# Durability. Dokploy mounts a volume at /data, but stock Redis writes to it only on
# snapshot thresholds it can take an hour to reach -- a tenant that wrote one key and was
# restarted five minutes later came back empty, with the volume never having been touched.
# The append-only log makes every write durable within a second, which is the promise a
# database product is actually making.
set -- "$@" --appendonly yes --appendfsync everysec

# The storage quota, enforced by Redis itself rather than by a sweep that runs every five
# minutes. `noeviction` makes an over-quota tenant fail writes instead of silently losing
# keys it believes it stored.
if [ -n "$BLAZE_MAXMEMORY" ]; then
  set -- "$@" --maxmemory "$BLAZE_MAXMEMORY" --maxmemory-policy noeviction
fi

# The tenant connects as `default`. It owns this container, so FLUSHALL and KEYS stay --
# what is removed is everything that would let it rewrite its own quota (CONFIG SET),
# lock blaze out (ACL), reach another host (REPLICAOF, MIGRATE), or stop the server.
if [ -n "$REDIS_PASSWORD" ]; then
  set -- "$@" --user default on ">$REDIS_PASSWORD" "~*" "&*" +@all \
    -acl -config'|'set -config'|'rewrite -config'|'resetstat \
    -shutdown -debug -module -replicaof -slaveof -migrate -failover \
    -reset -cluster -save -bgsave -bgrewriteaof
fi

# blaze's own account, deliberately separate from `default`: suspending a tenant means
# turning `default` off, and doing that while sharing its account would lock blaze out of
# the container it still has to administer.
if [ -n "$BLAZE_ADMIN_PASSWORD" ]; then
  set -- "$@" --user blazeadmin on ">$BLAZE_ADMIN_PASSWORD" "~*" "&*" +@all
fi

exec /usr/local/bin/redis-server-real "$@"
