# Monday.com Webhook Server - Docker Setup

## Building and Running with Docker

### Option 1: Using Docker directly

**Build the image:**
```bash
docker build -t monday-webhook-server .
```

**Run the container:**
```bash
docker run -p 3000:3000 \
  -e MONDAY_API_KEY=your_api_key_here \
  monday-webhook-server
```

### Option 2: Using Docker Compose (Recommended)

**Create a .env file:**
```bash
MONDAY_API_KEY=your_api_key_here
```

**Start the service:**
```bash
docker-compose up -d
```

**View logs:**
```bash
docker-compose logs -f
```

**Stop the service:**
```bash
docker-compose down
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `MONDAY_API_KEY` - Your Monday.com API key (required)

## Endpoints

- `POST /webhook/monday` - Handles Monday.com webhook events

## Security Note

⚠️ **Important:** Remove the hardcoded API key from your `index.js` file before deploying to production. Always use environment variables for sensitive data.
