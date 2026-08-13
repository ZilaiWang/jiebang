FROM python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db

LABEL io.knowbalance.role-c.runner="1"
LABEL org.opencontainers.image.title="KnowBalance Role C Python Runner"
LABEL org.opencontainers.image.version="1.0.0"

COPY --chown=65534:65534 runner.py /opt/role-c/runner.py

USER 65534:65534
WORKDIR /tmp

ENTRYPOINT ["python3", "-I", "-S", "-B", "/opt/role-c/runner.py"]
