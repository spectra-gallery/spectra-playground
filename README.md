# Spectra Playground Server

This lightweight Express server provides a simple playground with three ACE editors (HTML, JavaScript and CSS) rendered through EJS templates. It reuses the persistence logic from the main backend so sketches can be saved and loaded.

## Setup

```bash
cd spectra-playground-server
npm install
node server.js
```

The server runs on `http://localhost:6002` by default. It expects the API from `spectra-backend` to be available on `http://localhost:8000`.

## Usage

- Visit `/` to open the playground.
- Use the **Save** button to persist your sketch. A sketch id is returned and reused for subsequent saves.
- A **Generate Hash** button is provided to create a random 64‑character hexadecimal hash.

Additional routes expose neural map creation helpers that proxy the existing API:

- `POST /lab/neuralmap/create`
- `POST /lab/node/create/:id`
- `POST /lab/link/create/:id`

These endpoints forward the request payload to the backend API so you can create maps, nodes and links directly from this server.
