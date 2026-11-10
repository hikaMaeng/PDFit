# Internals

The PostgreSQL store keeps schema ownership for:

* `reading_progress`
* `tags`
* `book_tags`
* `viewer_state`

The watcher reconciles missing files against tracked metadata and emits SSE notifications for front refreshes.

On startup, an existing legacy `app.db` is imported into PostgreSQL and retained
as a timestamped `.migrated-*` backup. New runtime reads and writes use only
PostgreSQL.

## WebGPU viewer contract

`@pdfgpu/core` is the performance path: PDFium produces a low-resolution preview
and visible detail tiles, its byte-budget cache bounds raster memory, and its
renderer composites the visible frame with WebGPU when available or 2D canvas
otherwise. `front/components/PdfGpuViewer/index.tsx` is the PDFit React adapter;
the controller remains the mutable source of truth outside React.

PDFit does not own a second pdfgpu implementation. Core interaction transitions,
DPI normalization, layout, queueing, and rendering are tested and versioned in
the independent repository. PDFit only retains app-specific session state and
the legacy fallback adapter.

During initial loading the core snapshot exposes `loadPhase`, `loadProgress`,
`loadProgressDeterminate`, `loadedPages`, and `loadPageCount`. The percentage covers document download, document opening, plus
the preview pages needed for the initial viewport; later pages remain lazy and
are not falsely reported as pre-rendered.

The controller snapshot is deliberately immutable-by-reference per emission so
`useSyncExternalStore` can detect each update without copying domain state into
React. The existing PDF.js component is retained only as the initialization
fallback for unsupported or failed PDFium environments.

## Viewer zoom contract

The zoom value stored in `viewer_state.scale` and shown in both viewer toolbars is a
physical PDF zoom ratio, not PDF.js's native 72-DPI viewport scale. At 100%, one PDF
inch (72 points) occupies 96 CSS pixels, matching Acrobat's system-resolution display
convention and the PDFGPU/PDFium renderer. The PDF.js fallback therefore multiplies
the displayed zoom by `96 / 72` only at the viewport boundary. Fit-width and fit-height
convert available CSS pixels back into this user-facing zoom ratio, while bookmark and
annotation data remain in unscaled PDF-point coordinates.
Documents without persisted viewer state start at 100%. Existing per-document
zoom values are restored unchanged.
Fit buttons replace a manually entered zoom, including values above 100%.
In two-page layout, height fit is bounded by the available spread width so
both pages remain in the viewport. The PDF.js renderer calculates the minimum
of height fit and spread-width fit; PDFGPU uses its `page` fit and persists that
user action as `height` for the two-page layout. The displayed percentage is
the resulting PDF zoom, not a fixed 100% label.

## Reused viewer window contract

`front/viewer/openViewer.ts` assigns a deterministic named browsing context from the
encoded `(folder, filename)` key. An already registered viewer receives a same-origin
`pdfit-viewer-command`, focuses itself, and acknowledges the command; the sender falls back
to navigating a newly created blank target only when that registry record was stale. The
viewer records the requested page in `front/model/viewerNavigationModel.ts`. `PdfGpuViewer`
applies that value only at `loadPhase === 'ready'`, so a command delivered during loading is
not lost. `PdfListItem` is the sole file-row launcher for both folder and tag pages.

## Cross-window bookmark change contract

## Cross-window message router

`front/model/windowSync.ts` owns the single browser transport. It sends a `{ id, topic, payload }`
envelope through `BroadcastChannel` with `localStorage` fallback, de-duplicates IDs per window,
and routes a matching topic only to its registered lambda. A new sync feature adds a stable topic,
serializable payload, payload guard, and a scoped subscriber; it does not add another window event,
channel, or storage listener.

## Cross-window bookmark change contract

`front/model/bookmarkEvents.ts` is the typed bookmark adapter over the message router. Its
`bookmark.change` payload is `(folder, filename, kind)`. Subscribers validate it: the service
gallery reloads its global list and count, while each viewer reloads only when the target book
matches its route. Every completed create, edit (comment and colors included), or deletion uses
this route from either window. The event intentionally carries no bookmark payload: the PostgreSQL
API remains the shared source of truth.

## Bookmark overlays

`front/components/PdfGpuViewer/index.tsx` keeps the persistent bookmark list in
`front/model/bookmarkModel.ts`; a drag rectangle and edit draft are transient UI
state only. Region capture is always available on the page surface; the toolbar
bookmark control is always rendered as a labeled `북마크` button and changes
only the visibility of the bookmark sidebar. A newly
created bookmark temporarily emphasizes its delete affordance before fading to
the normal resting opacity. The UI and PDFGPU capture engine share an 8-pixel
minimum drag threshold, and capture success or failure is always surfaced in the
viewer. If a remote/Drive-backed page is still rendering its detail raster, the
capture waits for detail readiness and retries once instead of dropping the
gesture before the metadata request. The adapter passes PDF-point absolute rectangles to
`PdfGpuViewerController.projectOverlays()`. PDFGPU normalizes them using each
manifest page's point size and returns projections for visible pages only.
If PDFGPU initialization fails, the shared PDF.js fallback keeps the same icon-only
bookmark sidebar control, always-on region capture, overlays, deletion, and API
callbacks. `?engine=legacy` selects that path explicitly for deterministic browser
verification.
The React overlay is a sibling of the PDFGPU-owned viewport because the core
controller owns and replaces the viewport's child DOM.

Bookmark assets are served from the current sibling `books/bookmarks` directory
with the historical `data/bookmarks` directory as a read-only fallback. New
captures are stored only at the current location.

## Hosted IndexedDB cache

The optional browser cache owns `meta`, `folders`, `pdfs`, `tags`, `pdfTags`,
`bookmarks`, `progress`, `viewerStates`, and `syncState`. A schema-versioned hydration
marker makes subsequent service loads read locally. Cache replacement uses one read-write
transaction so the UI never observes a partially hydrated snapshot.

PDF list projections retain each row's `driveFileId`. Folder navigation places that ID
in the viewer URL, and the viewer chooses `/api/folders/by-id/:driveFileId` for PDF bytes.
The folder/name URL remains a compatibility fallback only when no ID is available. The
hosted adapter can therefore serve repeated PDF Range reads without rebuilding a Drive
snapshot or searching by mutable names.

## Direct resumable upload

The hosted client first validates the `%PDF-` signature, requests a metadata-only remote
session, and uploads sequential 8 MiB chunks from `File` slices. A network interruption
causes an empty status PUT; the next offset always comes from the remote `Range` response.
One expired session may be recreated. Multiple selected files share aggregate progress and
the IndexedDB snapshot is invalidated only after every completed file has been verified by
the service. Local adapters continue using the multipart endpoint.

## Hosted incremental refresh

The common browser refresh contract remains `POST /api/folders/refresh`; hosted storage
implements it with a Spreadsheet `changePageToken`. After the server applies all Drive
change pages, the browser invalidates and atomically rehydrates IndexedDB. Local filesystem
refresh behavior is unchanged.

## Hosted metadata outbox

Hosted tag, bookmark, progress, and viewer-state mutations are written to the separate
`pdfit-metadata-outbox-{account}` IndexedDB before their HTTP request begins. A successful
response removes the exact operation; a terminal 4xx response also removes it and restores
the authoritative cache. Network and 5xx failures remain durable for startup/online retry.
Coalescing keys retain only the latest progress, viewer state, tag relation, color, or edit
intent. Bookmark creation instead retains its UUID operation ID so a repeated request maps
to the same service-side bookmark and Drive image identities.

The outbox is a narrow partial-failure bridge, not a general reconciliation engine. It does
not scan Drive for orphan images or delete remotely unreferenced data.

## Document list open history

The list shares a responsive grid with `PdfListHeader` for name, last-opened time,
and tag columns. List and cover tags navigate to the same `/tag/:name` route as
the LNB; relation deletion remains in the tag-management dialog.
The five-column layout applies at 900 CSS pixels and wider, or on coarse-pointer
tablets at 720 pixels and wider. A narrow mouse/desktop window keeps its former
compact layout; folder and tag lists use the same rule for headings and rows.

`documentOpenHistory` records the browser timestamp when the viewer mounts or
receives a same-document open command. Records use a Drive file ID when known,
otherwise folder plus filename, and a localStorage key separated by the metadata
cache account scope. Standalone local mode uses the `local` scope. A storage event
updates the list in another window. This history is local to the browser and is
not substituted with the PDF's modified time or synchronized to the server.
Missing or invalid history displays a dash; unavailable storage does not block
the viewer. Compact tag chips fit within their column on narrow screens.
On coarse-pointer tablets at 720 CSS pixels and wider, the opened timestamp has
separate non-wrapping date and time lines in both folder and tag lists. Desktop
retains its single-line timestamp. The tablet library header stays accessible
while scrolling so its menu button can reopen the folder/tag drawer.
Cover-card links target the PDFit `/viewer/` route, including long-press and
new-tab navigation in Safari. The raw `/api/folders/by-id/` URL is only for
PDF bytes and thumbnails; opening that URL directly uses the browser's native
PDF display and cannot show PDFit navigation or annotation controls.
The viewer root prefers dynamic viewport height where supported, while both
viewer toolbars retain a foreground stacking layer and horizontal overflow to
keep page-mode controls accessible during touch scrolling.
Both the PDF.js and PDFGPU viewer workspaces use a light blue-gray canvas
(`#e8decd`) in light mode and retain the original `#3a3a3a` in dark mode.
The PDF.js page shadow is softer on the light canvas; bookmark sidebars and
their text follow the same appearance preference. The PDF page pixels are not
recolored by the site theme (the separate invert control is unchanged).
`pdfit.color-mode` is stored per origin. An already-open viewer listens for
browser `storage` events so changing the library theme in another window also
updates the viewer header, toolbar, annotation rail, and workspace immediately.

## Remote PDF loading

The legacy viewer first asks the authenticated by-ID endpoint for the current
PDF size with `HEAD`. For files up to 20 MiB it downloads the body once and
passes those bytes to PDF.js, reporting stream progress while they arrive. This
avoids several high-latency Google Drive byte-range requests for ordinary
documents. Larger files and other PDF URLs continue to use 2 MiB PDF.js range
requests with automatic fetching and the competing full-body stream disabled.
The HEAD endpoint checks file ownership exactly as the GET endpoint does and
does not expose a content stream. Viewer cleanup aborts an unfinished download.

## Sidebar preferences and document selection

왼쪽 폴더·태그 항목은 이름과 개수만 표시한다. 섹션 제목 아이콘, 항목 이동,
드래그 대상 및 태그 선택 색상은 유지한다. 태그 색상 변경은 태그 페이지 제목과
태그 관리창에서 제공한다.

상단 `lnb-preferences` 버튼(지구본 아이콘, 접근성 이름은 언어)은 언어와 다크/라이트 선택 모달을 연다. 설정 페이지로 가는 톱니바퀴는 오른쪽의 별도 버튼이다.
기존 언어 모델과 테마 모델을 사용하여 즉시 반영하고 localStorage에 저장한다.
모달 닫기는 별도 저장이나 취소 동작이 아니다. 언어 확장이 없는 런타임에서는
언어 선택 항목을 표시하지 않는다.

언어 목록은 OBDILCI V6(2025-07)의 모국어·제2언어 인터넷 이용자 추정 비율 상위
10개 언어 순서(중국어, 영어, 스페인어, 아랍어, 힌디어, 러시아어, 프랑스어,
포르투갈어, 말레이어 계열, 벵골어)에 한국어와 기존 일본어를 추가한다.
원자료: https://www.obdilci.org/wp-content/uploads/2025/07/ResultsV6.xlsx
`PDFIT_LANGUAGES` 순서와 `PDFIT_LANGUAGE_LABELS` 자국어 표기를 공통으로 사용한다.
`pdfit.language` 저장값은 로그인·서재·뷰어에서 공유한다. 기존 8개 언어의
공통 메시지 표를 유지하고, 일본어/신규 3개 언어의 정적 번역 및 과거 하드코딩
문구 번역은 `front/i18n/catalog/`에 포함한다. 서비스의 구조화된 화면 문구도
동일한 카탈로그로 변환한다. 번역 대상은 제품 UI이고 파일명, 태그, 메모 등
사용자 데이터의 원문 식별자는 변경하지 않는다. 정적 카탈로그는 외부 번역
서비스 없이 사용되며, 신규 문구 추가 시 모든 언어와 변수 자리표시자를 검증한다.

태그별 목록은 문서 식별자 기반 개별·전체 선택 상태를 관리한다. 다른 태그로
이동하면 선택을 초기화하고 목록에서 빠진 문서는 선택 집합에서 제거한다.
캐시에서 태그별 문서를 투영할 때 Drive 파일 ID를 보존한다. 폴더·태그 목록의
선택 키는 동일 식별자가 반복되어도 각 행을 구별하므로 같은 파일명의 문서도
체크박스 수와 선택 개수가 일치한다.
표지 선택 체크박스는 카드 하단 우측에 별도 고정 폭을 확보한다. 다른 작업
버튼과 체크박스는 24px 크기로 한 줄에 배치하며 모두 같은 간격으로 분산한다.
표지 이미지나 체크박스와 겹치지 않는다.

태그 관리창의 새 태그 색상 선택기는 `TagColorPicker`의 `swatch` 형태를 사용한다.
클릭 전부터 선택 색상을 원으로 보여주고 팔레트에서 선택한 색상을 즉시 반영한다.
팔레트는 기존 10색을 유지하면서 총 25색으로 확장한다.
태그 페이지 제목의 기존 태그 아이콘 형태는 유지한다.

## AI 자동 태그 안내 상태

폴더 도구 모음 버튼명은 `AI 자동 태그`이다. 무료 계정에서는 클릭 시
`AI 자동 태그 체험판을 소진하였습니다`로 바뀌고 회색 비활성 상태가 된다.
이는 페이지 내 안내 상태이며 서버 체험 할당량이나 결제 상태를 변경하지 않는다.
무료 안내 클릭에서는 실행 확인창·AI 요청을 호출하지 않는다. 유료 계정은 기존
태그 없는 문서 대상 확인·실행·진행·취소 흐름을 유지한다. 개별 문서 AI 버튼과
태그 관리창의 무료 제한은 유지한다.

왼쪽 폴더·태그 섹션 아이콘은 기본 파란색이며 펼침 화살표는 기존 색상을 유지한다.
왼쪽 탐색 순서는 `태그 → 폴더 → 북마크`이고 키보드 탐색 순서도 동일하다.
LNB의 태그·폴더·클립은 아이콘 옆에 이름을 표시한다. 클립 화면 상단 제목은 마이클립이며 태그 전체 초기화 버튼은 표시하지 않는다.
폴더·태그 제목의 아이콘·이름 간격은 모두 8px이다. 태그 제목의 색상 선택
버튼은 내부 패딩 없이 32px 아이콘을 사용해 폴더 아이콘과 같은 실제 간격을
유지한다. 두 화면의 문서 개수는 파란색 4px 모서리 사각 배지로 통일한다.

폴더 상단 제목 행 오른쪽에는 `업로드 → 새로고침 → 폴더 내 모든 태그 해제`
순서의 레이블 버튼을 둔다. 기존 파일 선택 입력, 새로고침 처리, 태그 해제 확인창을
연결하며 이전 목록 도구 모음에는 중복 표시하지 않는다. 좁은 화면에서는 원래
버튼 순서를 유지하면서 줄바꿈한다.

문서 목록 태그 열에는 태그 칩, 태그 관리, 개별 자동 태그 순으로 배치한다.
자동 태그는 기존 접근 권한을 유지하며 문서 정보·이동·삭제는 별도 작업 열에 둔다.
검색은 처음에 버튼만 보이고 클릭하면 포커스된 입력창을 연다. 닫기·Escape는
입력창을 접고 검색어를 초기화하여 전체 문서 목록을 다시 표시한다.

문서 목록의 이동·삭제는 선택 문서가 있을 때 전체 선택 옆에 표시한다.
`SelectedDocumentActions`는 폴더·태그 목록의 공통 선택 이동 확인창을 제공하며
기존 폴더 API와 모델을 사용한다. 삭제는 각 페이지의 기존 확인 흐름에 연결한다.
행 오른쪽에는 이동·삭제를 중복 표시하지 않는다. 표지 카드의 기존 개별 동작은
유지한다. 선택 이동은 현재 선택 문서의 스냅샷을 대상으로 수행한다.

폴더·태그 목록은 `LibraryFixedControls`로 선택 도구 모음과 열 제목을 함께
고정한다. 제목 행은 스크롤되며 도구 모음은 main 스크롤 영역의 상단에 붙는다.
불투명 테마 배경으로 지나가는 문서와 겹쳐 보이지 않으며 좁은 화면의 줄바꿈에도
고정 영역 높이가 자동 반영된다. 앱 외곽은 화면 높이로 제한하고 왼쪽 메뉴는
문서 목록과 독립된 스크롤 영역을 유지한다.
라이트 모드의 폴더·태그 목록은 제목 줄과 바깥 여백까지 흰색 배경을 사용하며,
고정 도구 모음과 열 제목도 흰색 문서 행과 같은 표면색을 사용한다.
다크 모드는 기존 기본 배경색을 유지한다.

선택 작업에는 `폴더 이동`, `삭제` 레이블을 표시하고 개수는 배지 없는
`{count}개 선택됨` 텍스트로 표시한다. AI 자동 태그 옆의 폴더 삭제 버튼은
표시하지 않는다. 왼쪽 메뉴의 폴더 삭제와 선택 문서 삭제 확인 흐름은 유지한다.
기본 `PDFit Library` 폴더는 서버에서 삭제를 금지하므로 왼쪽 메뉴에
휴지통을 표시하지 않는다. 이름 변경은 Drive 폴더 ID를 유지한 채 기본·일반
폴더 모두 허용하며, 서버 응답을 받은 뒤 캐시와 현재 폴더 경로를 갱신한다.
일반 폴더의 삭제 버튼은 활성 상태로 유지한다.
문서 목록의 파일명은 LNB 태그명과 같은 테마 글꼴, 일반 굵기 400 및
`body2` 자간을 사용한다. 목록의 글자 크기는 읽기 편한 기존 크기로 유지한다.
라이트·다크 모드 모두 동일한 글꼴 설정을 사용한다.

문서 정보 기본 탭에서는 사용되지 않는 `언어` 입력칸을 표시하지 않는다.
개인 문서의 기본 입력은 제목·부제·키워드로 단순화하며 작성자·작성 기관·작성일은
표시하지 않는다. 도서 정보 모드에서는 저자·역자·출판사·출간일·ISBN을 유지한다.
일반 문서의 정보 창 높이는 축소하고 도서 정보가 검색된 경우에만 기존 높이를 사용한다.
기존 메타데이터의 숨겨진 필드 값은 저장 호환성을 위해 그대로 보존한다.
공개 도서 정보 검색이 일치한 결과만 `documentType: book`으로 저장한다.
일반 문서에는 도서 전용 입력칸이나 수동 도서 전환 버튼을 표시하지 않는다.
다시 열 때 이 명시적인 구분을 우선 사용하고, 이전 버전에서 저장한 정보에만
ISBN·역자·목차·표지·출처 또는 도서 검색 출처를 통한 기존 추정을 적용한다.
PDF 파일 자체의 내용만 보고 도서 여부를 자동 판별하지는 않는다.

## Viewer mode transitions

PDF.js 뷰어에서 두 페이지 보기와 연속 스크롤을 전환하면 PDF 문서는 다시
다운로드하지 않는다. 그러나 각 레이아웃이 페이지 컴포넌트를 다시 만들므로
보이던 캔버스가 잠시 비어 보일 수 있다. 최근 완료된 페이지 렌더 6개를
PDF 페이지 객체와 캔버스 픽셀 크기로 제한해 재사용하고, 전환 직후 현재
페이지(두 페이지 보기에서는 양쪽 페이지)는 즉시 표시한다. 크기가 달라진
페이지나 캐시 밖 페이지는 기존 방식으로 렌더링한다.

파일 크기는 태그 오른쪽 열에 배치하고 이름·열린시간·태그와 같은 헤더를 제공한다.
데스크톱의 열린시간·태그·파일 크기는 같은 비율의 열 폭을 사용한다.
세 열 사이 간격은 모두 8px이며 이름 열은 2.75배 비율로 남은 공간을 사용한다.
네 열의 헤더와 열린시간·파일 크기 값은 각 열의 가운데에 정렬한다. 파일명은
읽기 편하도록 왼쪽 정렬한다. 문서 정보는 파일명 바로 옆에 24px 아이콘
전용 버튼으로 표시하고, 배경·테두리 없이 주 색상으로 파일명과 구분한다.
툴팁과 접근성 레이블에는 번역된 `문서 정보`를 유지한다.
모바일은 긴 파일명과 아이콘을 줄바꿈하여 겹침을 방지한다. 폴더·태그 화면 모두 기존
메타데이터 창을 열며 사용 설정과 유료 도서 정보 조회 권한을 유지한다. 문서 정보
창은 클릭 즉시 파일명 기반 입력 폼을 보여주며, 저장된 정보 조회 중에도 입력할 수 있다.
조회 응답이 늦게 와도 그 사이 사용자가 수정한 필드는 덮어쓰지 않는다. 저장과 정보 찾기는
초기 조회가 끝난 후 활성화한다. 같은 문서의 부모 화면이 재렌더링되어도 조회를 다시 시작하지 않는다.
일반 문서 안내 배너와 수동 도서 전환 버튼은 표시하지 않는다. 정보 찾기의 공개 데이터
제공처는 기존 도서 검색을 유지한다.
태그 목록의 파일명 아래 폴더 위치 배지는 표시하지 않는다. 실제 폴더와
이동 기능은 유지한다. 모바일은 파일 크기를 별도 행으로 배치한다.
태그 열은 데스크톱에서 `태그 값(100px) | 작업(92px)` 2칸 그리드를 열 중앙에
배치한다. 두 영역 내부도 가운데 정렬하여 태그 칩과 태그관리 사이 공백을
줄이면서 태그가 없는 행의 작업 위치를 유지한다.
목록·표지·뷰어의 작은 태그 칩은 글자 12px, 높이 22px를 사용한다.
태그관리 버튼은 파란색 밑줄 텍스트이고 AI 버튼과 나란히 둔다. 태그가
없거나 태그 이름 길이가 달라도 작업 버튼 시작 위치가 변하지 않는다.
체크박스 열은 24px(모바일 20px), 열 간격은 8px로
헤더·행을 같이 정렬한다. 태그 해제 한국어 확인 문구에서는 PDF 대신 문서를
사용한다. 폴더 삭제 확인과 문서 다운로드 안내도 한국어에서는 `문서`를
사용한다. 다운로드 확인창의 파일명 앞 PDF 아이콘은 표시하지 않는다.
태그 수는 기존 태그 연결 건수이고 실제 해제 동작은 바꾸지 않는다.

## 문서 목록 정렬과 라이트 팔레트

라이트 모드는 사용자가 선택한 D안의 맑은 하늘색 캔버스 `#e5f3ff`, 흰 표면과
문서 행 `#ffffff`, 베이지 사이드바 `#fff1d9`를 사용한다. 본문 글자와 구분선은
푸른 계열로 맞춘다. 본문 버튼·링크의 파란색은 밝은 바탕에서 읽기 쉬운
`#22699c`를 사용하고, 사이드바의 파란색 아이콘·선택 표시는 진한 배경에서
구분되도록 더 밝은 `#63b8ee`를 사용한다. 다크 모드와 태그별 고유 색상은
변경하지 않는다.


### LNB·검색·목록 헤더 표시 (2026-10-02)

문서 목록의 이름·열린시간·태그·파일 크기 헤더는 왼쪽 정렬한다. 폴더 문서 수는 전체 선택 체크박스와 레이블 사이에 표시하고 검색은 AI 자동태그 왼쪽에 둔다. 업로드·새로고침·태그 해제 버튼 간격은 12px이다. 검색창에는 결과 수를 표시하지 않으며 빈 결과는 파일 검색 아이콘과 “일치하는 파일이 없습니다.”, “검색어 지우기”로 안내한다. 라이트 모드 뷰어 캔버스는 `#e8decd`, 도구·클립 영역은 `#f5efe4`를 사용한다.


### 문서 정보·열린 날짜·라이트 모드 표시 (2026-10-02)

목록과 표지보기의 헤더 순서는 이름 → 태그 → 문서정보 → 시간 → 파일 크기다. 문서정보 작업은 아이콘 대신 밑줄 있는 글자로 표시한다. 표지 카드는 수정일 대신 계정별 열린 날짜를 표시한다. 한국어 날짜는 올해 `10월 1일`, 다른 연도 `2025년 9월 30일`이며 시·분은 생략한다. 열람 기록이 없으면 `—`를 표시한다. LNB는 파스텔 베이지 `#fff1d9`, 선택 배경은 `#f5dfb9`이며 클립 아이콘은 AttachFile이다. 마이클립 본문은 라이트 모드 문서 목록과 같은 흰색이다. 계정 하단 이름·이메일·만료일은 각각 `#403a30`, `#6f6556`, `#2e6744`로 표시한다.


표지보기에는 목록 열 헤더를 표시하지 않는다. 카드 내부는 이름·태그·문서정보·열린시간·파일 크기 순서이며 선택 체크박스는 파일명 앞에 둔다. 하단은 자동태그·태그관리와 폴더이동·삭제 두 그룹이 같은 너비를 차지하고 그룹 안 버튼은 space-around로 배치한다. 세로 구분선은 text.secondary 색과 불투명도 0.7로 표시한다. 검색·AI 자동태그 사이 간격은 12px, AI 자동태그·보기 전환 사이는 24px이다. 클립 메뉴와 마이클립 제목 아이콘은 같은 색을 사용한다.


### 태그 입력·기본 색상 (2026-10-02)

태그관리 입력란은 자동 포커스를 하지 않는다. 라벨과 테두리는 비포커스 시 회색, 포커스 시 파란색이다. 안내는 “태그 추가 또는 목록에서 선택”이며 색상 옆 추가 버튼, Enter, 목록 선택으로 추가한다. IME 조합 중 Enter는 추가하지 않는다. 새 태그는 기본 `#3b82f6`, 직접 선택한 색상은 새 태그에 저장하고 다음 입력에서도 마지막 선택 색상을 유지한다. 기존 태그의 지정 색상과 같은 색을 가진 여러 태그는 그대로 유지한다.


태그관리 Dialog는 자동 포커스를 하지 않으며 입력칸 테두리와 라벨은 초기 회색이다. 입력칸 hover 또는 focus 시 둘 다 `#3b82f6`로 바뀐다. 추가 버튼은 빈 입력에도 파란색으로 활성화되어 있으며 빈 입력 클릭은 입력칸으로 포커스만 이동한다.

태그 입력 라벨은 shrink=true로 테두리 위에 항상 표시하고 안내 문구도 초기부터 표시한다. placeholder는 text.secondary 회색과 opacity 1을 사용한다.


태그관리 추가는 태그 관계와 새 태그 색상 저장이 완료된 뒤에만 대화상자 목록에 표시한다. 색상 선택은 `pdfit.tag-input-color`에 기억해 추가 완료·창 재진입·새로고침 뒤에도 유지한다. 저장된 선택이 없을 때만 파란색이다. 폴더 모델은 최초 파일 스냅샷이 있으면 후속 갱신에서 전체 로딩 화면으로 바꾸지 않아 기존 목록과 태그 창·표지를 유지한다.

무료 체험 계정의 AI 일괄 자동태그는 1회 클릭 소진 상태를 두지 않는다. 회당 최대 10개 제한과 서버 구독 검증을 유지하며 미분류 문서가 남으면 반복 실행한다. 실행 중·분류 대상 없음 상태에서는 버튼을 비활성화한다.


2026-10-06 화면 갱신: TagChip 아이콘은 # (MUI Tag)이다. 2026-11-10부터 LNB 태그 목록 행은 `#` 문자 대신 태그 색상의 외곽선 태그 아이콘(LocalOfferOutlined, `data-testid="lnb-tag-icon"`)으로 시작하고 이름에는 접두 문자가 없다. 목록은 이름의 유니코드 순이다. 목록 태그는 파일명 아래에 왼쪽 정렬하고 작업 열에는 태그관리·AI 버튼을 유지한다. 목록 첫 헤더는 파일명, 폴더 검색은 상단 폴더 제목 옆에 둔다. 무료 PDF 자동 분류 버튼 아래에는 AI 이용권 구매 안내를 표시한다.

### 폴더 이동 및 삭제 확인 UI (2026-10-06)
폴더 이동창은 파일명을 별도 줄로 표시하고, 드롭다운 대신 폴더 아이콘과 라디오 선택 상태가 있는 목록을 사용한다. 삭제 확인의 취소 버튼은 error 색상, 삭제 버튼은 error.dark 기본 배경과 error.main 호버 배경을 사용한다. 무료 AI 자동태그 버튼은 사용해 보기 문구를 표시하며 성공 후 PRO 안내를 별도 표시한다. 재실행은 유지한다.

무료판 PDF 자동 분류 안내: 유료 이용권 결제 시 AI 자동 태그를 사용할 수 있습니다. (2026-10-06 문구 수정)

폴더 이동 선택기: 폴더 검색 + 40px 밀도 목록, 고정 224px 높이 내부 스크롤, 선택 폴더 하단 표시. 무료 AI 완료 안내는 버튼 아래 한 줄로 표시하며 체험 모달 설명은 두 문장 사이 줄바꿈한다.

태그 표시: 목록 파일명 아래는 테두리 없는 #태그명(plain). 사이드바와 관리 칩은 태그 외곽 안에 #을 배치한 HashTagIcon을 사용한다.

### 태그 탐색과 수동 일괄 태그 (2026-10-06)
태그 화면은 새로고침과 목록/표지 보기 전환을 제공한다. 파일 선택, 이동, 삭제 컨트롤은 표시하지 않는다. 표지 컴포넌트 hideSelection/hideFileActions 옵션은 태그 탐색에서만 사용한다.
폴더 화면 전체 선택일 때만 밑줄 태그관리 버튼을 표시한다. 대상 파일을 열 때 스냅샷으로 고정하고 태그를 수동 일괄 추가한다. 기존 태그는 건너뛰며 성공한 파일만 화면에 반영한다. 부분 실패 시 완료 개수를 안내하고 재시도를 허용한다. 새 태그 색상만 저장하며 기존 태그 색상은 유지한다.

라이트 전체 팔레트(2026-10-06): 크림 canvas #fffdf9/사이드바 #fff6e8, 흰 surface, 본문 #30343b, 설명 #626975, 중립 구분선 #e5e1da, 파란 primary #2563eb. 다크 팔레트는 기존 유지.

사용자 흰색/회색 참조 반영: 라이트 sidebar #ffffff, canvas #f7f7f7, 구분선 #dedede, 내비게이션 강조 #ededed. 크림 팔레트를 대체하며 메인 목록도 같은 canvas를 사용한다.

최종 선택 퓨어 화이트: sidebar/canvas/surface #ffffff, divider #edf0f4, 선택 내비게이션 #edf4ff.
라인 화이트 개선: 흰 배경, 선명한 sidebar 경계 #ccd3dd와 연한 파일 구분선, light 파일명 550, 주요 업로드 contained blue, 보조 버튼 gray, 공용서재/태그/폴더/클립 아이콘 blue #2563eb.
Adobe 참조 영역 구조: sidebar white, main canvas #f8f8f8, sticky controls canvas 동일, cards/dialogs white, 영역 경계 #d2d2d2, 파일 구분선 #e8e8e8. 보조 행 링크/아이콘 gray, 선택 강조 및 주요 버튼 blue.
홈 라이트 카드의 별도 파랑/초록 그라데이션 제거. 흰 surface와 중립 text/border 사용, 카드 아이콘만 옅은 블루 강조.
사이드바 로고/이름은 / 홈으로 가는 Router Link. 접근성 이름 메인화면으로 이동, focus-visible outline, 설정 버튼은 별도 영역.
홈 시작 화면: 절제된 제목/설명, 2개 라이브러리/클립 카드, 실제 폴더명·PDF 수 목록. 홍보 그라데이션/대형 로고/기술 배지 제거. 기존 navigationGuard 및 폴더 이벤트 유지. 색상은 theme 기반으로 dark/light 대응.
사용자 요청으로 홈 기존 홍보 구성 복원: hero/로고/핵심가치 2개/기능 3개/소스 영역 유지. 라이트는 흰 카드와 중립 설명 색상, 파란 포인트. 시작 화면 폴더 목록 제거. 기존 번역/홈 로고 링크 유지.
빈 폴더 문구: 아직 문서가 없습니다. 문서를 여기로 끌어오거나 업로드 버튼을 눌러 추가하세요. 하단 업로드 문구 통일. 업로드/새로고침 160ms 배경 전환, 모드별 명시 호버 적용.
이동 대상은 locale 이름순 numeric 정렬, 40px 행 최대 5개(202px 테두리 포함), 적은 폴더는 높이 자동 축소, 선택 전 하단 중복 안내 숨김. 빈 문서 안내 드래그하거나 문구 및 일반 문서 아이콘 사용.
업로드/새로고침은 두 모드 동일 primary outlined 및 호버. 폴더 수는 minWidth32 right/tabular-nums, 모든 행 pr7, root 삭제 버튼 자리 24px 예약으로 동일 기준선 유지.
로컬 무료 UI 확인 링크 /?preview=trial. 실제 계정 데이터를 이용하며 서버 결제 상태 변경 없이 UI만 무료체험으로 투영. 로컬 하단 배너로 종료 가능.
무료 AI 체험 재실행: 태그 없는 문서 우선 최대10개. 모두 태그가 있으면 pending 제외 기존 문서 최대10개로 재확인, 버튼 활성 유지. 재실행 모달은 기존 문서 확인 및 중복 방지 설명 표시.
무료 자동태그 유료 안내는 툴바에서 제거하고 확인 모달 하단으로 이동. 대상 수/재실행 안내/체험 최대10개/유료 안내 순서, 실행 버튼은 기존 AI 자동태그 사용해 보기 문구 유지. 표지 태그 plain #태그명, LNB HashTagIcon 유지.
무료 자동태그 확인 모달 문구 축약: 대상 수 질문 한 줄, 무료 최대10개 및 유료 이용권 안내 한 줄. 재분류 설명과 구분선 제거, 실행 버튼 유지.
무료 자동태그 모달 유료 안내는 파란 띠 배너로 표시. 밝은 모드 #edf4ff, 어두운 모드 #203149, 왼쪽 파란 강조선과 AI 아이콘. 실행 버튼 유지.
문서 태그 plain 표시에서 삭제 아이콘 활성화. 표지 및 목록에서 onTagDelete 연결, 기존 문서별 관계 삭제 및 실패 복구 API 사용.
무료 AI 배너 문구를 실제 반복 체험 동작에 맞게 수정: 무료 체험은 한 번에 최대 10개까지 · 유료 이용권으로 더 많은 문서를 처리하세요.

AI 무료 체험 총10회: aiBulkTagLimit은 서버 잔여 횟수, 실행 종료 시 onAiTagProcessed를 통해 갱신. 버튼 아래 잔여 표시 및 모달 실행 후 잔여 표시. 잔여0이면 유료 이용권 안내 활성 버튼으로 pricing 이동. 무료 태그관리 단일 자동분류 버튼 숨김, 상단 유료 안내 14px, 제목 HashTagIcon 적용(폴더/태그 화면 공통).
사용자 위치 조정: 무료 태그관리 유료 안내는 태그 입력란 아래, 닫기 버튼 위로 이동. 14px 유지.
무료 AI 모달은 현재 잔여와 모두 성공 시 예상 잔여를 구분. 버튼 아래와 모달은 같은 aiBulkTagLimit 값 사용. 태그 연결 수를 사용량으로 환산하지 않음.

무료 AI 태그 표시: 문서9/10개·1개 추가 가능. AI 태그 제거 후 자리 반환, 수동 태그 제거 미반환. 문서별/전체/폴더 태그 삭제 및 태그 화면에서 onAiTagRemoved로 갱신. 모달에 현재 문서 수와 다른 문서 사용 안내 표시.
AI 태그 잔여 안내를 데스크톱에서는 버튼 왼쪽 같은 줄 가운데 정렬, 600px 미만에서는 버튼 아래로 표시. 버튼 문구가 취소로 바뀌어도 간격 유지.


무료체험 AI 태그는 체크박스로 선택한 문서에 적용한다. 선택이 없거나 남은 문서 한도보다 선택 수가 많으면 실행 버튼을 비활성화한다. 모달에는 선택 수와 AI 태그 제거 시 다른 문서에 사용 가능한 안내를 표시한다.

무료체험 문서 목록의 태그 작업 열은 데스크톱과 모바일 모두 96px로 고정한다. FolderPage와 TagPage는 compactTagActions를 제목과 행에 동일하게 전달해 정렬을 유지한다. 유료 목록은 기존 열 너비를 유지한다.

유료 목록의 태그 작업 열은 120px로 고정하고, 시간 열은 무료/유료 모두 142px로 고정한다. 연도가 다른 날짜의 년월일 표시 공간을 유지하면서 화면 확장에 따른 열 여백 증가를 방지한다.

무료와 유료 문서 목록은 동일한 열 템플릿을 사용한다. 태그 열은 모두 120px이며 화면 너비가 같으면 이용권 전환에 따른 모든 열 너비와 위치가 유지된다. 한국어 documentInfo 표시는 파일정보로 변경하고 fileSize는 파일 크기를 유지한다.

선택 문서 이동 모달은 무료/유료 모두 표지 단일 문서 이동과 같은 FolderDestinationPicker를 사용한다. 폴더 검색, 목록 선택, 선택 폴더 표시를 공유하고 한 문서는 파일명, 여러 문서는 선택 수를 표시한다. 무료 AI 태그 버튼은 남은 한도가 있을 때 선택 없이 활성화하며 클릭하면 문서 선택 안내만 표시한다.

폴더 및 태그 페이지의 태그관리 모달은 TagChip의 hashLabel을 사용해 # 태그명으로 표시한다. 기존 테두리, 색상, 삭제 버튼을 유지한다.


## viewer-mode-transitions
단일 페이지와 연속 스크롤은 동일한 페이지 DOM과 캔버스를 재사용한다. 단일 모드는 현재 페이지 이외의 셸을 display:none으로 숨긴다. 전환 시 useLayoutEffect에서 컨테이너 scrollTop을 초기화해 연속 모드의 스크롤 오프셋이 단일 화면을 밀어내지 않게 한다. 두 페이지 모드는 기존 구조와 최근 페이지 렌더 캐시를 사용한다.

기본 뷰어의 대용량 range 로딩은 전체 파일 다운로드 퍼센트가 첫 페이지 준비 상태를 의미하지 않으므로 불확정 게이지와 첫 페이지 준비 안내를 사용한다. 작은 파일의 완전 다운로드 게이지는 기존 퍼센트를 유지한다.

태그 분류 표지 카드도 폴더이동 및 삭제 액션을 표시하고 기존 확인 모달로 연결한다. 파일 자동분류는 유료 권한이 있을 때 표시하고 저장 후 태그 목록을 갱신한다. 카드 아이콘 버튼에 접근성 이름을 지정해 터치 환경에서도 식별한다.

## Background tasks

`src/server/tasks/` is a general periodic-work layer in the shared package, so the local
runtime and a hosted runtime run the same scheduler, queue, and worker pool. Thumbnails
are its first job; later periodic jobs reuse it unchanged.

| File | Role |
| --- | --- |
| `taskProtocol.ts` | The standard contract: `TaskEnvelope` (`id`, `type`, `key`, `script`, `payload`, `priority`, `timeoutMs`), `TaskScript` (`run(payload, context)`), `TaskOutcome`, and the two worker messages |
| `taskQueue.ts` | Pending tasks: highest priority first, submission order within a priority, one entry per `type` + `key`, bounded (100,000) |
| `taskWorkerHost.ts` | The worker-thread entry shared by every task type. It imports the module named by `envelope.script` once per worker and calls its default export's `run` |
| `taskWorkerPool.ts` | Fixed number of worker threads, which is the parallelism budget for all jobs together. A task past its timeout has its worker terminated and replaced; an idle worker is terminated after 60 s; a worker is recycled after 200 tasks |
| `taskScheduler.ts` | Registers `PeriodicTaskDefinition`s, plans on a timer, dispatches to the pool, and reports status |
| `backgroundTasks.ts` | Runtime-neutral entry: `createPdfitTaskScheduler(options)` with the shared defaults, and `readPdfitTaskSchedulerEnvironment(env)` for the `PDFIT_TASK_*` variables |

Scheduling rule: every `intervalMs` the scheduler calls each definition's `plan()`,
drops everything that type still had pending, and queues the new plan. A task that is
already in a worker finishes there and is not queued again. If `plan()` throws, the
previous queue of that type stays. Between ticks, `scheduler.submit(type, task)` adds
one task; with `INTERACTIVE_TASK_PRIORITY` it runs before the periodic backlog.
Equal-priority tasks run in the order they were planned, so a job that must not wait
behind a large backlog of another job plans with a higher priority.

Adding a job:

1. Write a task script whose default export is `defineTask({ async run(payload) { ... } })`.
   It runs in a worker thread; payload and result must be structured-cloneable.
2. Write a `PeriodicTaskDefinition`: `type`, `script` (module URL), `plan()` returning
   `{ key, payload, priority? }[]`, optional `timeoutMs`, `prepare`, and `onSettled`.
   `prepare(task)` runs on the main thread just before dispatch and returns the payload
   the worker receives. Inputs that must be fresh at run time (an access ticket, a
   token) are produced there instead of waiting in the queue. A task being prepared
   holds its worker slot; a `prepare` that throws settles the task as failed.
3. Register it on the scheduler. The local runtime does that next to the thumbnail job
   in `bootstrap/createCommonRouters.ts`.

Hosted runtime: the local assembly (`backgroundTasks` option) only exists on the
`booksRoot` path, which a hosted server does not use. A hosted server builds its own
scheduler from the same entry and registers its own definitions:

```ts
const scheduler = createPdfitTaskScheduler(readPdfitTaskSchedulerEnvironment(process.env));
scheduler.register(accountThumbnailJob);   // its own plan(), any task script
scheduler.start();
// mount createTasksRouter(scheduler) behind the server's own authentication
```

What differs per edition is only the job definition: which items exist (`plan`), where
a result is stored, and who may read it. The local thumbnail job lists a directory and
writes files; a hosted job lists an account's library and stores results per account.
The hosted service does this for Drive libraries: its job plans from each active
account's library index, `prepare` issues a one-time loopback URL so no credential
reaches a worker, and results go to a per-account subfolder of its data volume.
The hosted service does this for Drive libraries: its job plans from each active
account's library index, `prepare` issues a one-time loopback URL so no credential
reaches a worker, and results go to a per-account subfolder of its data volume.

## Server thumbnails

`src/server/thumbnails/` renders page 1 of each library PDF to a 360 px wide JPEG.

* `thumbnailTask.worker.ts` is the task script. PDF.js (`pdfjs-dist` legacy build) reads
  the source in 256 KB ranges and draws on `@napi-rs/canvas`; the result is written to a
  temporary file and renamed. The source is `{ kind: 'file', path }` or
  `{ kind: 'http', url, headers }`, so a hosted job can render a PDF behind a storage API
  that honours `Range` (for example with a bearer token) using the same script,
  exported as `THUMBNAIL_TASK_SCRIPT_URL`.
* `thumbnailStore.ts` owns the file naming. A thumbnail is
  `<sha1(folder NUL filename)>.<mtimeMs>-<size>.v<format>.jpg` directly inside
  `THUMBNAILS_ROOT`. There is no database state. A changed PDF has a new stamp, so it has
  no thumbnail under its current name and the next plan renders it.
* `thumbnailTask.ts` is the job definition. `plan()` lists the library with asynchronous
  I/O, queues every PDF without a current thumbnail, and deletes thumbnail files that no
  longer match any PDF. Deletion is skipped when the listing was incomplete or empty,
  because that usually means the library volume is offline. A missing library root
  fails the plan.
* A failed render writes `<...>.failed` (JSON with the error). The PDF is skipped while
  that marker is younger than 24 hours and the file is unchanged, then tried again.
* `THUMBNAIL_FORMAT_VERSION` is part of the file name; raising it re-renders everything.

The folder router's thumbnail route first looks the file up by the client's `v` stamp
(no library I/O). On a miss it stats the PDF, serves the current thumbnail if there is
one, and otherwise submits the task with interactive priority and answers `202`.

The cover card (`ServerCoverThumbnail` in `PdfCoverItem.tsx`) shows the `<img>`; on a
load error it fetches the same URL to read the status, shows "preparing" for `202`, and
asks again after 3, 6, 12, 30, then every 60 seconds while the card is on screen.

Memory: rendering allocates and frees large image buffers in worker threads. With
glibc's default dynamic thresholds the freed memory stays in the process heap. The
standalone entrypoint starts Node with `MALLOC_MMAP_THRESHOLD_=65536` and
`MALLOC_TRIM_THRESHOLD_=131072`; measured on 120 library PDFs with 2 workers, resident
memory after the batch was 367 MB without and 117 MB with these settings (peak 692 MB
vs 414 MB, same duration). `MALLOC_ARENA_MAX=2` alone made no difference. A hosted
image that enables background tasks should start Node the same way.
