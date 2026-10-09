FROM redis:8
COPY cert.pem key.pem /etc/redis-tls/
COPY entrypoint.sh /usr/local/bin/blaze-entrypoint.sh
RUN mv /usr/local/bin/redis-server /usr/local/bin/redis-server-real \
 && cp /usr/local/bin/blaze-entrypoint.sh /usr/local/bin/redis-server \
 && chmod 755 /usr/local/bin/redis-server /usr/local/bin/redis-server-real \
 && chmod 644 /etc/redis-tls/cert.pem /etc/redis-tls/key.pem
