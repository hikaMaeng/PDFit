# Viewer Bot

Free enables Bot from [the viewer entry](../../../apps/pdfit/src/front/viewer-main.tsx) and mounts its router with the [Settings model resolver](../../../apps/pdfit/src/server/index.ts#resolveChatModel). [The floating view](../src/front/components/book-bot/BookBot.tsx#BookBotPanel) and [book-scoped model](../src/front/components/book-bot/model.ts#getBookBotModel) can be composed into another reading surface. The current PostgreSQL adapter uses the local library's book identity.

## Answer context

[Answer preparation](../src/server/book-bot/answer.ts#answerBookQuestion) reads the book title, stored or embedded outline, current-version indexed page OCR, clip page and region, clip OCR and comments, vision descriptions, and book comments at each turn. If a page is near the index text length limit, it reads the full page OCR cache when available. If the server has no stored outline, the viewer reads the PDF's embedded outline with the existing range-reader. An explicitly removed outline stays removed.

Context that fits is supplied directly. Larger sources are split at text boundaries with repeated source labels. The model reads each group and combines its evidence before answering. Recent turns retain their roles and wording. Older turns follow the same bounded dialogue reduction, and the complete exchange remains in PostgreSQL. Reduction can lose detail, and latency grows with the amount of material. The Bot prompt directs the model to cite viewer page numbers, distinguish reader comments from the author, and describe gaps in available OCR.

The first Settings server with an LLM model supplies chat completions. Clip images are described by the first configured vision model or a multimodal LLM. A failed image read leaves the clip's metadata, OCR and memo available. Successful descriptions are cached per clip and model. Original clips go to the visual model, and dialogue, OCR, and derived descriptions go to the configured chat model.

## API

The [wire contract](../src/common/protocol/book-bot/index.ts) identifies each book with the `folder` and `filename` query parameters. These endpoints use the Free runtime's local library.

| Method and route | Behavior |
|---|---|
| GET `/api/book-bot/sessions` | Start times and titles in newest-first order. |
| GET `/api/book-bot/sessions?id=latest` | Latest session or a null session. |
| GET `/api/book-bot/sessions?id=<uuid>` | Full session for that book. |
| POST `/api/book-bot/sessions?id=<uuid>` | Start an empty session with a retry-safe operation ID. |
| POST `/api/book-bot/turns` | Send a question with a session ID or null, a turn ID and the known turn count. The first successful answer includes a generated title. |

The [router](../src/server/book-bot/router.ts#createBookBotRouter) returns 409 for a stale revision or a concurrent turn, 503 for missing LLM configuration, and 502 for a failed or incomplete model reply. A repeated completed turn ID returns the stored session. The client can retry with the same ID.

## Storage

[PostgreSQL](../src/server/postgres/bookBot.ts#createPostgresBookBot) keeps session IDs, initial timestamps, first-turn titles, and ordered exchanges. The book foreign key follows a rename or move and drops conversations when the library record is deleted. The initial draft is stored with its first successful turn. A user-created **New chat** is stored immediately. PostgreSQL admits one append per session revision. No database connection stays checked out during model generation.

## Verification

Locate the toolbar button and nonmodal dialog by **Bot**. Inside the dialog, locate **Question**, **Send question**, **Chat history**, and **New chat** by label or role. The drag handle is titled **Move Bot window** and accepts arrow keys. History is a named list of buttons with title text and a `time[datetime]` start time.

The [browser test plan](../../../apps/pdfit/tests/plans/viewer-book-bot-20261126.md) uses the deployed viewer build, PostgreSQL, a synthetic library and an OpenAI-compatible fixture upstream.
