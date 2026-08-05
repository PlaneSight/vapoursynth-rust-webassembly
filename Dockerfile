FROM node:22-bookworm

ARG RUST_VERSION=1.85.0
ARG EMSCRIPTEN_VERSION=3.1.68
ARG UV_VERSION=0.12.1

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        bash \
        build-essential \
        ca-certificates \
        curl \
        git \
        ninja-build \
        pkg-config \
        python3 \
        python3-venv \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/opt/uv:/opt/emsdk:/opt/emsdk/upstream/emscripten:$PATH \
    EMSDK=/opt/emsdk \
    RUSTUP_TOOLCHAIN=1.85.0 \
    UV_LINK_MODE=copy

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rustup component add rustfmt clippy \
    && rustup target add wasm32-unknown-unknown wasm32-unknown-emscripten \
    && curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | env UV_INSTALL_DIR=/opt/uv sh \
    && git clone --branch "${EMSCRIPTEN_VERSION}" --depth 1 https://github.com/emscripten-core/emsdk.git /opt/emsdk \
    && /opt/emsdk/emsdk install "${EMSCRIPTEN_VERSION}" \
    && /opt/emsdk/emsdk activate "${EMSCRIPTEN_VERSION}"

COPY docker/entrypoint.sh /usr/local/bin/vapoursynth-container-entrypoint

ENTRYPOINT ["/usr/local/bin/vapoursynth-container-entrypoint"]
