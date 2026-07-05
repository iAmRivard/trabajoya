FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
ARG VITE_TRABAJOYA_WHATSAPP_NUMBER
ARG VITE_TRABAJOYA_WHATSAPP_MESSAGE
ENV VITE_TRABAJOYA_WHATSAPP_NUMBER=${VITE_TRABAJOYA_WHATSAPP_NUMBER}
ENV VITE_TRABAJOYA_WHATSAPP_MESSAGE=${VITE_TRABAJOYA_WHATSAPP_MESSAGE}
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV API_PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
COPY migrations ./migrations
EXPOSE 8787
CMD ["npm", "run", "start"]
