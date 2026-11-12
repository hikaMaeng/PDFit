# Display-name translation timeout plan (20261112)

## Target

`POST /api/settings/translations` must survive a local reasoning model that needs tens of seconds per reply. The upstream chat-completions abort in `apps/pdfit/src/server/services/displayTranslation.ts` was 20 s; the requirement is "very generous, about 5 minutes".

## Fixtures

- Free standalone container `pdfit-pdfit-1` on `http://127.0.0.1:15203`.
- AI server row: `openai-compat`, url `http://host.docker.internal:18180/v1`, `models.llm = qwen36-35b` (apibond server on the Docker host, port 18180).

## Cases

1. Container reachability: `127.0.0.1:18180` must fail and `host.docker.internal:18180` must answer `200` from inside the container.
2. Upstream path: `POST /v1/chat/completions` answers `200`; `POST /chat/completions` answers `404`, so the stored url keeps `/v1`.
3. Before the change: translation of two labels aborts with `TimeoutError`.
4. After the change and redeploy: the same request answers `200` with Korean strings, and its wall time is above the old 20 s limit and below the new one.
5. `/settings` renders the stored AI server row in a headless browser.

## Reproduce

```
npm run deploy:standalone
curl -s -X POST http://127.0.0.1:15203/api/settings/translations -H 'Content-Type: application/json' -d '{"texts":["Science Fiction","History"],"language":"ko"}'
```
