FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
COPY tools ./tools
ENV PORT=8484 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 8484
USER node
CMD ["node", "server.js"]
