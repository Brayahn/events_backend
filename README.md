# Monday.com Webhook Server

A simple Express.js server to receive and log webhooks from Monday.com.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

Or for development with auto-restart:
```bash
npm run dev
```

## Endpoints

- **POST** `/webhook/monday` - Receives Monday.com webhooks
- **GET** `/health` - Health check endpoint

## Usage

The server will:
1. Listen for POST requests on `/webhook/monday`
2. Log the received headers and body to the console
3. Respond with a success JSON message containing the received data

## Configuring Monday.com

1. Go to your Monday.com board
2. Navigate to Integrations → Webhooks
3. Set the webhook URL to: `http://your-server-url:3000/webhook/monday`
4. Choose the events you want to subscribe to
5. Save the webhook

## Testing Locally

For local testing, you'll need to expose your local server using a tool like:
- [ngrok](https://ngrok.com/)
- [localtunnel](https://localtunnel.github.io/www/)

Example with ngrok:
```bash
ngrok http 3000
```

Then use the ngrok URL in Monday.com webhook configuration.

## Environment Variables

- `PORT` - Server port (default: 3000)

## Response Format

The server responds to webhooks with:
```json
{
  "success": true,
  "message": "Webhook received successfully",
  "data": { ... received webhook data ... }
}
```
