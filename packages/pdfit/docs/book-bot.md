# Viewer Bot

Free enables Bot from [the viewer entry](../../../apps/pdfit/src/front/viewer-main.tsx) and mounts its router with the [Settings model resolver](../../../apps/pdfit/src/server/index.ts#resolveChatModel). [The floating view](../src/front/components/book-bot/BookBot.tsx#BookBotPanel) and [book-scoped model](../src/front/components/book-bot/model.ts#getBookBotModel) can be composed into another reading surface. The current PostgreSQL adapter uses the local library's book identity.

## Answer context

Opening a chat loads the book title and original table of contents. The [viewer model](../src/front/components/book-bot/model.ts) reads the PDF's embedded outline if the server has no stored copy. An empty stored outline records a deletion. Both stages receive the complete available outline with its original titles and PDF page numbers.

1. [Plan the turn](../src/server/book-bot/turnPlan.ts) with the question, outline and active dialogue. Previous OCR enters this prompt as page references. The model selects outline keys to fill gaps in the available material. An outline-only question can return no keys.
2. [Stream the answer](../src/server/book-bot/answer.ts#answerBookQuestion) after PostgreSQL reads current OCR in the selected sections and restores OCR referenced by active turns. A section stops before the next page-bearing entry outside its subtree. The last section can run to the end of the PDF. The prompt includes PDF page numbers and how many indexed pages fit, so the answer can report gaps. When an indexed page reaches the text length limit, Bot tries the full page OCR cache.

The answer call receives the title, outline, dialogue and OCR in a reference message. The reader's request is a separate final user message. It sets the scope and form of the answer. The model uses the reference message to support its response. Only answer text reaches the browser as deltas.

A turn can also request reader comments and clips. Clips supply their OCR, notes and any saved visual description. The answer reports missing image details when they matter.

Set **Bot context limit (tokens)** on the LLM server to the available model window. Bot [counts Qwen3.6 and ToolSpace 35B A3B tokens locally](../src/server/book-bot/promptTokens.ts#bookBotPromptTokenCounter). Other models use a byte estimate. The default window is 16,384 tokens. The answer reserves 4,096 output tokens and 128 tokens for chat-template differences. If the selected OCR exceeds the remaining window, the answer gets a subset with the omitted page count.

Once dialogue and its retained OCR reach 80% of the model window, the next planner call creates a rolling summary from the previous summary and the unsummarized turns. The answer then uses the new summary and the pages requested for this turn. The outline stays in its own prompt field. Source pages are referenced by PDF page number in storage and can be selected again after a rollover. Bot compacts sooner when the available space cannot fit the base context next to the active conversation. When existing history already exceeds the planner window, Bot summarizes it in fitting batches before planning. A model window too small to fit the full outline and question fails the turn.

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

Send `Accept: text/event-stream` to receive `delta` frames for answer text and a `saved` frame for the persisted turn, session metadata and revision. Send `X-PDFit-Bot-Progress: 3` for context preparation, queue wait, query analysis, selected OCR loading, answer generation and saving. Version `2` reports analysis and OCR loading as preparation. Version `1` also omits the queue phase. Thinking activity uses a phase event. Keep-alive comments may arrive while the server prepares the answer. After the stream opens, generation or persistence failures arrive as a terminal `error` frame. Without the SSE accept header, the route returns the existing JSON session document.

Each model call within the turn enters the [shared AI queue](api.md#ai-model-requests) with the same priority as automatic tagging. The viewer shows `queued` while the call waits and resumes the active phase when the worker takes it. Planning and answering enter the queue separately. The timeout counts worker time across the turn.

The [router](../src/server/book-bot/router.ts#createBookBotRouter) returns 409 for a stale revision or a concurrent turn and 503 for missing LLM configuration before opening the stream. An interrupted or incomplete model reply reports 502. Retrying a completed turn ID returns the saved turn without generating it again.

## Storage

[PostgreSQL](../src/server/postgres/bookBot.ts#createPostgresBookBot) keeps session IDs, initial timestamps, first-turn titles, and ordered exchanges. The book foreign key follows a rename or move and drops conversations when the library record is deleted. The initial draft is stored with its first successful turn. A user-created **New chat** is stored immediately. PostgreSQL admits one append per session revision. The same write stores added page references and advances the hidden summary when needed. The public transcript includes the original exchanges. No database connection stays checked out during model generation.

During generation, the server accumulates the answer in memory while sending visible text to the viewer. It commits the complete exchange once the upstream model finishes successfully, then emits `saved`. If the browser disconnects, the upstream request can still finish and commit. If the upstream response is incomplete, the turn is discarded and the viewer retains the draft for retry.

## Verification

The [page selection test plan](../../../apps/pdfit/tests/plans/book-bot-page-selection-20261127.md) checks both model inputs, OCR selection, repeated rollovers and viewer streaming.

Locate the toolbar button and nonmodal dialog by **Bot**. Inside the dialog, locate **Question**, **Send question**, **Chat history**, and **New chat** by label or role. The drag handle is titled **Move Bot window** and accepts arrow keys. History is a named list of buttons with title text and a `time[datetime]` start time.

The [browser test plan](../../../apps/pdfit/tests/plans/viewer-book-bot-20261126.md) uses the deployed viewer build, PostgreSQL, a synthetic library and an OpenAI-compatible fixture upstream.

The [streaming test plan](../../../apps/pdfit/tests/plans/ai-streaming-20261126.md) checks early rendering, commit timing, disconnects and retries.

Bot renders text such as `p.9`, `P. 9` and `[PDF p. 9]` as [viewer page links](../src/front/components/book-bot/pageCitations.ts#remarkPdfPageCitations). A link targets the first page of an inline range. Page numbers must fit the current PDF. Existing saved replies use the same renderer.

The [context and page links test plan](../../../apps/pdfit/tests/plans/bot-context-links-20261126.md) checks progress before answer text and navigation from both fresh and restored messages.
