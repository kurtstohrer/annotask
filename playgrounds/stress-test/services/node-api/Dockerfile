FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./

ENV PORT=4340
EXPOSE 4340

CMD ["node", "index.js"]
