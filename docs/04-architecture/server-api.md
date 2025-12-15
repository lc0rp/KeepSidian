# Server API Contract

Server calls are centralized in `src/integrations/server/keepApi.ts` and use the Obsidian `requestUrl` wrapper in
`src/services/http.ts`.

## Endpoints

- Download (standard): `GET /keep/sync/v2`
- Download (premium): `POST /keep/sync/premium/v2` with `feature_flags`
- Upload: `POST /keep/push` with `{ notes: PushNotePayload[] }`

## Headers

- `X-User-Email`: user email from settings
- `Authorization`: `Bearer <token>`

## Payload validation

- Incoming sync responses are validated with Zod schemas in `src/schemas/keep.ts`.
- Premium feature flags are validated before being sent.
