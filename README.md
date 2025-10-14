# qBittorrent Port Sync

Small Node.js service that periodically reads the VPN-forwarded port from a Gluetun control server and updates qBittorrent’s listening port via its Web API.

## Files

- Dockerfile — builds the runtime image
- docker-compose-example.yml — sample Compose service
- .env.example — template for configuration

## Build the image

- Linux/macOS:
  ```
  (sudo) docker build -t qbittorrent-port-sync:latest .
  ```
- Windows PowerShell:
  ```
  docker build -t qbittorrent-port-sync:latest .
  ```

## Configure environment

Create a .env from the example and edit values.

- Linux/macOS:
  ```
  cp .env.example .env
  nano .env
  ```
- Windows PowerShell:
  ```
  Copy-Item .env.example .env
  notepad .env
  ```

Important:

- The image exposes port 5000 and the example compose maps 5000:5000.
- Either set SERVER_PORT=5000 in .env, or change the compose mapping to 5050:5050 if you keep SERVER_PORT=5050.

If running Gluetun/qBittorrent in Docker, do not use localhost inside the container. Prefer service names, for example:

- GLUETUN_SERVER_URL=http://gluetun:8000/v1/openvpn/portforwarded
- QBITTORRENT_URL=http://qbittorrent:8080

## Run with Docker Compose

- Start:
  ```
  docker compose -f docker-compose-example.yml up -d
  ```
- View logs:
  ```
  docker logs -f server
  ```
- Stop:
  ```
  docker compose -f docker-compose-example.yml down
  ```

## Quick checks

- Gluetun control server (adjust host/port if needed):
  ```
  curl http://localhost:8000/v1/openvpn/portforwarded
  ```
- qBittorrent API reachable (adjust URL/port):
  ```
  curl -i http://localhost:8087/api/v2/app/version
  ```

## Troubleshooting

- **Port mismatch:** align `SERVER_PORT` with the Compose port mapping.
- **Connectivity:** from the updater container, ensure it can reach `GLUETUN_SERVER_URL` and `QBITTORRENT_URL` (avoid `localhost`; use service names on the same Docker network).
- **Auth:** verify `QBITTORRENT_USER`/`PASS` and that the Web UI is enabled.
- **Copy button doesn’t work:**  
  If you can’t copy the port using the "Copy" button, your browser probably blocks clipboard access when the page isn’t served securely.  
  Try opening the page via `http://localhost` or using HTTPS instead of a direct IP (like `http://192.168.x.x`).

## Screenshots
<p align="center">
  <img src="https://github.com/user-attachments/assets/05de14cf-bea3-42f4-b407-7e6282124d65" style="width:48%; margin-right:1%;" />
  <img src="https://github.com/user-attachments/assets/b0b8e28f-44a8-4571-841e-a67f3b49d6ef" style="width:48%;" />
</p>

