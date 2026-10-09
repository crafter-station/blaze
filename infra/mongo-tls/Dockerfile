# blaze/mongo-tls — the shared MongoDB instance tenants connect to.
#
# TLS and auth live in the image, not in the service definition, for the same reason as
# blaze/redis-tls: Dokploy drops `command` for database services and overrides
# ENTRYPOINT/CMD, so anything expressed as a runtime flag can silently disappear. Here the
# entrypoint appends the policy to whatever `mongod` invocation it is given.
#
# The certificate comes from certs/cert.pem + certs/key.pem when present (production: see
# infra/README.md). Without them a throwaway self-signed one is generated at build time,
# which is what local development uses. Neither file is ever committed.
FROM mongo:8

COPY certs/ /tmp/blaze-certs/
COPY entrypoint.sh /usr/local/bin/blaze-entrypoint.sh

RUN set -eu; \
	mkdir -p /etc/mongo-tls; \
	if [ -s /tmp/blaze-certs/cert.pem ] && [ -s /tmp/blaze-certs/key.pem ]; then \
		cp /tmp/blaze-certs/cert.pem /tmp/blaze-certs/key.pem /etc/mongo-tls/; \
	else \
		openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=blaze-dev-mongo \
			-addext "subjectAltName=DNS:localhost,DNS:mongo,IP:127.0.0.1" \
			-keyout /etc/mongo-tls/key.pem -out /etc/mongo-tls/cert.pem 2>/dev/null; \
	fi; \
	# mongod wants the key and the certificate in one PEM file.
	cat /etc/mongo-tls/key.pem /etc/mongo-tls/cert.pem > /etc/mongo-tls/mongo.pem; \
	# Self-signed, so the certificate is its own chain of trust. mongod 7+ refuses to start
	# TLS without a CA file at all (SERVER-72839) - that was the original failure.
	cp /etc/mongo-tls/cert.pem /etc/mongo-tls/ca.pem; \
	rm -f /etc/mongo-tls/key.pem; \
	rm -rf /tmp/blaze-certs; \
	# mongod runs as `mongodb` (the image's entrypoint drops to it with gosu), so that user
	# has to be able to read the key - and nobody else needs to.
	chown -R mongodb:mongodb /etc/mongo-tls; \
	chmod 400 /etc/mongo-tls/mongo.pem; \
	chmod 444 /etc/mongo-tls/ca.pem /etc/mongo-tls/cert.pem; \
	chmod 755 /usr/local/bin/blaze-entrypoint.sh

# `ping` needs no authentication, and TLS is the only way in.
HEALTHCHECK --interval=10s --timeout=10s --start-period=60s --retries=5 \
	CMD mongosh --quiet --tls --tlsAllowInvalidCertificates --tlsAllowInvalidHostnames \
		--eval "db.adminCommand('ping').ok" mongodb://127.0.0.1:27017/admin | grep -q 1

ENTRYPOINT ["blaze-entrypoint.sh"]
CMD ["mongod"]
