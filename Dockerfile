FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Create session directory
RUN mkdir -p /usr/src/app/sessions

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create data directory if it doesn't exist
RUN mkdir -p data

# Set environment variables
ENV NODE_ENV=production
# Default password (override during deployment)
ENV APP_PASSWORD="#race4fun"

# Expose port
EXPOSE 3000

# Run the app
CMD ["npm", "start"] 