# Server API Contract

Server calls are centralized in `src/integrations/server/keepApi.ts` and use the Obsidian
`requestUrl` wrapper in `src/services/http.ts`.

## Endpoints

- Download (standard): `GET /keep/sync/v2`
- Download (premium): `POST /keep/sync/premium/v2` with `feature_flags` in the request body
- Upload: `POST /keep/push` with `{ notes: PushNotePayload[] }`

## Query parameters (download)

- `offset`: pagination offset.
- `limit`: page size.
- Optional filters:
  - `created_gt`, `created_lt`
  - `updated_gt`, `updated_lt`

## Headers

- `X-User-Email`: user email from settings
- `Authorization`: `Bearer <token>`

## Base URL

- The base URL comes from `KEEPSIDIAN_SERVER_URL` (injected at build time).
- The runtime constant strips a trailing slash so endpoint concatenation is stable.

## Payload validation

- Incoming sync responses are validated with Zod schemas in `src/schemas/keep.ts`.
- Premium feature flags are validated before being sent.
