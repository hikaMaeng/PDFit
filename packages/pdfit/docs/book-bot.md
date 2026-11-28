# Viewer Bot

Free enables Bot from [the viewer entry](../../../apps/pdfit/src/front/viewer-main.tsx) and mounts its router with the [Settings model resolver](../../../apps/pdfit/src/server/index.ts#resolveChatModel). [The floating view](../src/front/components/book-bot/BookBot.tsx#BookBotPanel) and [book-scoped model](../src/front/components/book-bot/model.ts#getBookBotModel) can be composed into another reading surface. The current PostgreSQL adapter uses the local library's book identity.

## Answer context

Opening a chat loads the open book's title and original table of contents. The [viewer model](../src/front/components/book-bot/model.ts) reads the PDF's embedded outline if the server has no stored copy. An empty stored outline records a deletion. The model receives the full available outline, the active dialogue and the reader's question before any search.

Free sends three function definitions with the first model request. [Agent loop](../src/server/book-bot/agent.ts#runBookAgent) · [LM Studio tool use](https://lmstudio.ai/docs/developer/openai-compat/tools)

| Tool | Arguments and result |
| --- | --- |
| `search_current_book` | A semantic query. Search the open book for page OCR or reader annotations. |
| `list_related_books` | No arguments. List up to 10 other books by the number of tags they share with the open book. |
| `search_library_book` | A title or filename, an optional folder and a semantic query. Resolve one other book before searching it. An ambiguous name returns candidates for the model to disambiguate. Results carry the other book's identity and viewer page links. |

For either search tool, PostgreSQL limits candidates to one exact folder and filename before ranking. Each lookup returns up to 12 excerpts with source type, optional PDF page and index status. The [catalog queries](../src/server/postgres/bookBot.ts#createPostgresBookBot) use existing book and tag records. [Book-scoped vector lookup](../src/server/embedding/store.ts#searchBook)

The model may answer directly or return structured tool calls. The server appends the model's calls and one tool result per call ID before asking the model again. Each turn allows six tool invocations, then asks for a final answer. Answer deltas stay buffered until the round is classified so text accompanying tool calls stays out of the chat. The session stores one final reply. The [outline lookup](../src/server/book-bot/outlineLookup.ts) remains available to callers that explicitly use that flow.

Set **Bot context limit (tokens)** on the LLM server to the available model window. Bot [counts Qwen3.6 and ToolSpace 35B A3B tokens locally](../src/server/book-bot/promptTokens.ts#bookBotPromptTokenCounter). Other models use a byte estimate. The default window is 16,384 tokens. The answer reserves 4,096 output tokens and 128 tokens for chat-template differences. When the matches exceed the space left for evidence, Bot sends the best-ranked matches that fit and reports the omitted count.

Once the active dialogue reaches 80% of the model window, a separate model call updates its hidden summary before the agent starts. The summary combines the previous summary and unsummarized turns. The original outline remains a separate field. Earlier page references remain in dialogue metadata and can inform later searches. Bot compacts sooner when the base context and active conversation cannot fit together. Oversized history is summarized in fitting batches. A model window too small to fit the full outline and question fails the turn.

The bundled tokenizer is the [Qwen3.6-35B-A3B release asset](https://huggingface.co/Qwen/Qwen3.6-35B-A3B/blob/main/tokenizer.json) with its Apache-2.0 license. The SHA-256 of the uncompressed file is `5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42`.

## API

The [wire contract](../src/common/protocol/book-bot/index.ts) identifies each book with the `folder` and `filename` query parameters. These endpoints use the Free runtime's local library.

| Method and route | Behavior |
|---|---|
| GET `/api/book-bot/sessions` | Start times and titles in newest-first order. |
| GET `/api/book-bot/sessions?id=latest` | Latest session or a null session, plus the base book context. |
| GET `/api/book-bot/sessions?id=<uuid>` | Full visible transcript and base book context. |
| POST `/api/book-bot/sessions?id=<uuid>` | Start an empty session with a retry-safe operation ID and read the base book context. |
| POST `/api/book-bot/turns` | Send a question with a session ID or null, a turn ID and the known turn count. The first successful answer includes a generated title. |

Send `Accept: text/event-stream` to receive `delta` frames for answer text and a `saved` frame for the persisted turn, session metadata and revision. Send `X-PDFit-Bot-Progress: 3` for context preparation, queue wait, query analysis, book evidence lookup, answer generation and saving. Version `2` reports analysis and book evidence lookup as preparation. Version `1` also omits the queue phase. Thinking activity uses a phase event. Keep-alive comments may arrive while the server prepares the answer. After the stream opens, generation or persistence failures arrive as a terminal `error` frame. Without the SSE accept header, the route returns the existing JSON session document.

Each model call within the turn enters the [shared AI queue](api.md#ai-model-requests) with the same priority as automatic tagging. The viewer shows `queued` while the call waits and resumes the active phase when the worker takes it. All model rounds share a worker-time deadline. Each foreground embedding call uses the embedding queue and starts its own timeout when dispatched.

The [router](../src/server/book-bot/router.ts#createBookBotRouter) returns 409 for a stale revision or a concurrent turn and 503 for missing LLM configuration before opening the stream. An interrupted or incomplete reply or a reply containing raw model tool syntax reports 502. Retrying a valid completed turn ID returns the saved turn without generating it again.

## Storage

[PostgreSQL](../src/server/postgres/bookBot.ts#createPostgresBookBot) keeps session IDs, initial timestamps, first-turn titles, and ordered exchanges. The book foreign key follows a rename or move and drops conversations when the library record is deleted. The initial draft is stored with its first successful turn. A user-created **New chat** is stored immediately. PostgreSQL admits one append per session revision. The same write stores added page references and advances the hidden summary when needed. The public transcript includes the original exchanges. No database connection stays checked out during model generation.

During generation, the server accumulates the answer in memory while sending visible text to the viewer. It commits the complete exchange once the upstream model finishes successfully, then emits `saved`. If the browser disconnects, the upstream request can still finish and commit. After a generation failure, the viewer retains the draft for retry. A historic reply containing raw tool syntax has an empty public answer and appears as a retry notice. The original row and session revision remain in storage.

## Verification

The [page selection test plan](../../../apps/pdfit/tests/plans/book-bot-page-selection-20261127.md) checks both model inputs, OCR selection, repeated rollovers and viewer streaming.

Locate the toolbar button and nonmodal dialog by **Bot**. Inside the dialog, locate **Question**, **Send question**, **Chat history**, and **New chat** by label or role. The drag handle is titled **Move Bot window** and accepts arrow keys. History is a named list of buttons with title text and a `time[datetime]` start time.

The [browser test plan](../../../apps/pdfit/tests/plans/viewer-book-bot-20261126.md) uses the deployed viewer build, PostgreSQL, a synthetic library and an OpenAI-compatible fixture upstream.

The [streaming test plan](../../../apps/pdfit/tests/plans/ai-streaming-20261126.md) checks early rendering, commit timing, disconnects and retries.

Bot renders text such as `p.9`, `P. 9` and `[PDF p. 9]` as [viewer page links](../src/front/components/book-bot/pageCitations.ts#remarkPdfPageCitations). A link targets the first page of an inline range. Page numbers must fit the current PDF. Existing saved replies use the same renderer.

The [context and page links test plan](../../../apps/pdfit/tests/plans/bot-context-links-20261126.md) checks progress before answer text and navigation from both fresh and restored messages.
