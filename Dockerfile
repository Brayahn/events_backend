# Use official Node.js LTS (Long Term Support) image
FROM node:18-alpine

# Set working directory inside container
WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose the port the app runs on
EXPOSE 4455

# Set environment variables (can be overridden at runtime)
ENV PORT=3000
ENV NODE_ENV=production

# Run the application
CMD ["npm", "start"]
