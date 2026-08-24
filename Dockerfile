FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_OTA_URL=https://bong-ai-esp.bcserver.xyz/xiaozhi/ota/
ARG VITE_WS_URL=wss://bong-ai-esp.bcserver.xyz/xiaozhi/v1/
ENV VITE_OTA_URL=${VITE_OTA_URL} \
    VITE_WS_URL=${VITE_WS_URL}

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
