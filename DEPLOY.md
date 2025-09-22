# Deployment (Docker)

- Requirements: Docker and Docker Compose v2

Steps
- Copy `.env.example` to `.env` and set values (`JWT_SECRET`, `API_URL`).
- Build and run containers:
  - `docker compose up --build -d`
- Services:
  - App at `http://localhost:6002`
  - MongoDB at `mongodb://localhost:27017`
- Environment variables consumed by the app:
  - `PORT` (default 6002)
  - `DB_HOST` (default 127.0.0.1; in Compose set to `mongo`)
  - `DB_PORT` (default 27017)
  - `DB_NAME` (default `spectra_db`)
  - `JWT_SECRET` (required for auth)
  - `API_URL` (backend API base, default `http://localhost:8000/api`)

Useful commands
- Show logs: `docker compose logs -f app`
- Restart app: `docker compose restart app`
- Stop: `docker compose down`
- Wipe data: `docker compose down -v` (drops Mongo volume)

Security notes
- Use a strong `JWT_SECRET` in production.
- Consider binding Mongo to a private network only; remove `ports` from `mongo` service.
- Terminate TLS at a reverse proxy (nginx/Traefik) in front of the app.

