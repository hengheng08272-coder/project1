FROM node:22-slim

ENV NODE_ENV=production \
    DOWNLOAD_DIR=/tmp/tg-downloads

# ytdlp.js/pageResolve.js shell out to yt-dlp (Python) for HLS streams, which
# in turn needs ffmpeg on PATH to stitch fragments into one file. The
# curl-cffi extra backs yt-dlp's --impersonate flag, which some CDNs
# (Cloudflare-fronted ones especially) require: they wave through a cached
# manifest but bot-check every uncached request past it -- by TLS/HTTP
# fingerprint, not just headers -- so even a request with a correct Referer
# and User-Agent gets a 403 on the actual segments without it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      ffmpeg \
    && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default,curl-cffi]" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
# Images the service draws with (the KHQR mark on the payment ticket). Only
# src/ used to be copied, so the logo never reached the container and every
# tap on "Buy" crashed on a missing file.
COPY assets ./assets

EXPOSE 8000
CMD ["node", "src/server.js"]
