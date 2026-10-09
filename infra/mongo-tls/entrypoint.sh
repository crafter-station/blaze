#!/bin/bash
# Appends blaze's policy to any `mongod` invocation, then hands over to the official
# image's docker-entrypoint.sh (which creates the root user on first start and drops to the
# `mongodb` user).
#
# Passed as flags rather than a config file on purpose: the official entrypoint knows how
# to rewrite `--tlsMode` for its temporary first-start mongod (it downgrades it to
# allowTLS on 127.0.0.1 so its own init scripts can connect), and that is what keeps first
# start working with requireTLS.
set -euo pipefail

if [ "${1:0:1}" = '-' ]; then
	set -- mongod "$@"
fi

if [ "$1" = 'mongod' ]; then
	# The policy is the image's to decide. A caller passing its own TLS or auth flags is a
	# misconfiguration that could only weaken it, so refuse loudly instead of merging.
	for arg in "$@"; do
		case "$arg" in
		--tls* | --ssl* | --noauth | --auth | --bind_ip*)
			echo >&2 "blaze-mongo-tls: refusing caller-supplied '$arg'; TLS, auth and binding are set by the image"
			exit 64
			;;
		esac
	done

	set -- "$@" \
		--auth \
		--bind_ip_all \
		--tlsMode requireTLS \
		--tlsCertificateKeyFile /etc/mongo-tls/mongo.pem \
		--tlsCAFile /etc/mongo-tls/ca.pem \
		--tlsAllowConnectionsWithoutCertificates
fi

exec docker-entrypoint.sh "$@"
