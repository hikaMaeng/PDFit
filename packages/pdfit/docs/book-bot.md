# Viewer Bot

Free enables Bot from [the viewer entry](../../../apps/pdfit/src/front/viewer-main.tsx) and mounts its router with the [Settings model resolver](../../../apps/pdfit/src/server/index.ts#resolveChatModel). [The floating view](../src/front/components/book-bot/BookBot.tsx#BookBotPanel) and [book-scoped model](../src/front/components/book-bot/model.ts#getBookBotModel) can be composed into another reading surface. The current PostgreSQL adapter uses the local library's book identity.

## Answer context

[Answer preparation](../src/server/book-bot/answer.ts#answerBookQuestion) reads the book title, stored or embedded outline, current-version indexed page OCR, clip page and region, clip OCR and comments, vision descriptions, and book comments at each turn. If a page is near the index text length limit, it reads the full page OCR cache when available. If the server has no stored outline, the viewer reads the PDF's embedded outline with the existing range-reader. An explicitly removed outline stays removed.

A [single numbered chapter summary](../src/server/book-bot/chapterScope.ts#chapterSummaryScope) uses the chapter's outline, OCR and clips when the outline gives a unique start page and the next top-level entry gives a later page. The prompt reports the selected PDF page range and the number of saved OCR pages in it. Questions outside the supported summary patterns and outlines with missing or ambiguous boundaries use the book-wide context.

Set **Bot context limit (tokens)** on the active AI server to its available model window. For Qwen3.6 and ToolSpace 35B A3B, the Bot [counts tokens locally](../src/server/book-bot/promptTokens.ts#bookBotPromptTokenCounter) across instructions, evidence and past turns. It reserves 4,096 tokens for the reply and 128 for chat-template differences. When the prompt fits, the model receives it in one request. For other models, the existing byte estimate applies. Without a configured window, evidence is grouped in 18 KB chunks as needed.

When a counted prompt exceeds the window, the Bot checks again after reducing older dialogue. If evidence still needs reduction, the token count sets the initial group size and the Bot checks each group before sending it. Reduction can lose detail and add model calls. The Bot asks the model to cite viewer page numbers, distinguish reader comments from the author, and describe gaps in available OCR.

The bundled tokenizer is the [Qwen3.6-35B-A3B release asset](https://huggingface.co/Qwen/Qwen3.6-35B-A3B/blob/main/tokenizer.json) with its Apache-2.0 license. The SHA-256 of the uncompressed file is `5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42`.

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

Send `Accept: text/event-stream` to receive `delta` frames for answer text and a `saved` frame for the persisted turn, session metadata and revision. Send `X-PDFit-Bot-Progress: 2` to receive `progress` frames for context preparation, clip or evidence groups, queue wait, model generation and saving. Version `1` omits the queue phase for already-open viewers. Thinking activity uses a phase event. Keep-alive comments may arrive while the server prepares the answer. After the stream opens, generation or persistence failures arrive as a terminal `error` frame. Without the SSE accept header, the route returns the existing JSON session document.

Each model call within the turn enters the [shared AI queue](api.md#ai-model-requests) with the same priority as automatic tagging. The viewer shows `queued` while the call waits and resumes the active phase when the worker takes it. A long answer may pass through the queue again for later evidence groups or title generation.

The [router](../src/server/book-bot/router.ts#createBookBotRouter) returns 409 for a stale revision or a concurrent turn and 503 for missing LLM configuration before opening the stream. An interrupted or incomplete model reply reports 502. Retrying a completed turn ID returns the saved turn without generating it again.

## Storage

[PostgreSQL](../src/server/postgres/bookBot.ts#createPostgresBookBot) keeps session IDs, initial timestamps, first-turn titles, and ordered exchanges. The book foreign key follows a rename or move and drops conversations when the library record is deleted. The initial draft is stored with its first successful turn. A user-created **New chat** is stored immediately. PostgreSQL admits one append per session revision. No database connection stays checked out during model generation.

During generation, the server accumulates the answer in memory while sending visible text to the viewer. It commits the complete exchange once the upstream model finishes successfully, then emits `saved`. If the browser disconnects, the upstream request can still finish and commit. If the upstream response is incomplete, the turn is discarded and the viewer retains the draft for retry.

## Verification

Locate the toolbar button and nonmodal dialog by **Bot**. Inside the dialog, locate **Question**, **Send question**, **Chat history**, and **New chat** by label or role. The drag handle is titled **Move Bot window** and accepts arrow keys. History is a named list of buttons with title text and a `time[datetime]` start time.

The [browser test plan](../../../apps/pdfit/tests/plans/viewer-book-bot-20261126.md) uses the deployed viewer build, PostgreSQL, a synthetic library and an OpenAI-compatible fixture upstream.

The [streaming test plan](../../../apps/pdfit/tests/plans/ai-streaming-20261126.md) checks early rendering, commit timing, disconnects and retries.

Bot renders text such as `p.9`, `P. 9` and `[PDF p. 9]` as [viewer page links](../src/front/components/book-bot/pageCitations.ts#remarkPdfPageCitations). A link targets the first page of an inline range. Page numbers must fit the current PDF. Existing saved replies use the same renderer.

The [context and page links test plan](../../../apps/pdfit/tests/plans/bot-context-links-20261126.md) checks progress before answer text and navigation from both fresh and restored messages.
