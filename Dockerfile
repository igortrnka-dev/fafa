FROM node:24-alpine
WORKDIR /app
ENV TZ=Europe/Bratislava
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.js"]
