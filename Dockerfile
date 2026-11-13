FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000
RUN mkdir -p /config && chown node:node /config
VOLUME ["/config"]
USER node
EXPOSE 3000
CMD ["node","server.js"]
