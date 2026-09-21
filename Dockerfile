FROM node:22-slim

ENV NODE_ENV=production \
    DOWNLOAD_DIR=/tmp/tg-downloads

# m3u8fetch.js shells out to yt-dlp (Python) for HLS streams, which in turn
# needs ffmpeg on PATH to stitch fragments into one file.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      ffmpeg \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 8000
CMD ["node", "src/server.js"]
