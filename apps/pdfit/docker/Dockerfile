FROM node:22-bookworm-slim AS node-runtime

FROM pgvector/pgvector:pg17

RUN apt-get update && apt-get install -y \
    curl make g++ patch git \
    automake autoconf libtool \
    postgresql-server-dev-17 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LO https://bitbucket.org/eunjeon/mecab-ko/downloads/mecab-0.996-ko-0.9.2.tar.gz \
    && tar zxf mecab-0.996-ko-0.9.2.tar.gz \
    && cd mecab-0.996-ko-0.9.2 \
    && ./configure && make && make install \
    && ldconfig \
    && cd .. && rm -rf mecab-0.996-ko-0.9.2 mecab-0.996-ko-0.9.2.tar.gz

RUN curl -LO https://bitbucket.org/eunjeon/mecab-ko-dic/downloads/mecab-ko-dic-2.1.1-20180720.tar.gz \
    && tar zxf mecab-ko-dic-2.1.1-20180720.tar.gz \
    && cd mecab-ko-dic-2.1.1-20180720 \
    && ./autogen.sh && ./configure && make && make install \
    && echo "dicdir = /usr/local/lib/mecab/dic/mecab-ko-dic" > /usr/local/etc/mecabrc \
    && cd .. && rm -rf mecab-ko-dic-2.1.1-20180720 mecab-ko-dic-2.1.1-20180720.tar.gz

RUN git clone --depth 1 https://github.com/i0seph/textsearch_ko.git \
    && cd textsearch_ko \
    && make USE_PGXS=1 \
    && make USE_PGXS=1 install \
    && cd .. && rm -rf textsearch_ko

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/npm/bin/npm-cli.js "$@"\n' > /usr/local/bin/npm \
    && printf '#!/bin/sh\nexec node /usr/local/lib/node_modules/npm/bin/npx-cli.js "$@"\n' > /usr/local/bin/npx \
    && chmod +x /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app
COPY docker/package.json ./package.json
RUN npm install --omit=dev --no-fund --no-audit

COPY dist/ ./dist/
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV SERVER_PORT=15201
ENV BOOKS_ROOT=/app/data/books
ENV BOOKS_ROOT_NAME=이북
ENV PGDATA=/app/data/pgvector
ENV PGDATABASE=books
ENV PGHOST=127.0.0.1
ENV PGPORT=5432
ENV PGUSER=books
ENV PGPASSWORD=books
ENV POSTGRES_USER=books
ENV POSTGRES_PASSWORD=books

VOLUME ["/app/data"]
EXPOSE 15201

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:15201/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

ENTRYPOINT ["/entrypoint.sh"]
