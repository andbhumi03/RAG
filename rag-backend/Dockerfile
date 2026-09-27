FROM node:20-slim

# Install system dependencies required for Tesseract OCR
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better Docker caching
COPY package*.json ./
RUN npm install

# Copy the rest of the backend code
COPY . .

EXPOSE 5000

CMD ["node", "Server.js"]