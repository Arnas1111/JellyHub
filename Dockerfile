FROM node:22-alpine
WORKDIR /app
COPY package.json registration.js my-list.js profiles.js collection-visibility.js server.js static-assets.js diagnostics.js features.js media.js playback.js personalization.js core.js plugins.js extensions.js docker-entrypoint.sh ./
COPY public ./public
ENV NODE_ENV=production PORT=3000 CONFIG_DIR=/config
RUN apk add --no-cache su-exec && mkdir -p /config && chown node:node /config
VOLUME ["/config"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["node","server.js"]
