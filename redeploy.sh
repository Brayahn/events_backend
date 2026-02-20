#!/bin/bash

echo "Stopping and removing old container..."
docker stop events_webhook_server 2>/dev/null
docker rm events_webhook_server 2>/dev/null
docker rmi events_webhook_server 2>/dev/null

echo "Rebuilding Docker image..."
docker build -t events_webhook_server .

echo "Starting new container..."
docker run -d \
  --name events_webhook_server \
  --restart unless-stopped \
  -p 4455:4455 \
  -e PORT=4455 \
  -e MONDAY_API_KEY='eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjMzMzg0NDUzNiwiYWFpIjoxMSwidWlkIjo1NzI1NDM4OSwiaWFkIjoiMjAyNC0wMy0xNlQxOTo1MTo1My4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTQ5Mjc2NzgsInJnbiI6InVzZTEifQ.GzG-PARLDqJnQBQkff9Nj95pWdbc9CTRziyF4QdFNH4' \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  events_webhook_server

echo "Container started!"
echo "Viewing logs (Ctrl+C to exit):"
docker logs -f events_webhook_server




