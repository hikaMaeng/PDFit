# Usage

`apps/pdfit` imports the shared client and server surfaces, then adds the Settings
UI and `/api/settings` router through the service extension points.

## PDF upload

왼쪽 폴더 목록의 연필 아이콘으로 기본 폴더와 일반 폴더의 이름을 변경할 수
있습니다. 이름 변경 후 열린 폴더 주소도 새 이름으로 바뀝니다. 기본 폴더는
이름만 변경할 수 있고 삭제할 수 없습니다.

Open a folder and either select one or more PDFs with the upload button or drag
the files onto the folder content area. A drop overlay confirms the target, and
non-PDF files are ignored with an error message.

Each PDF row has a selection checkbox. Select individual rows or use **전체 선택**
in the list control bar, then choose **선택 삭제** to review the count and delete
the selected PDFs together. The same bar keeps selection actions on the left,
aligned with row checkboxes, and list/cover view controls on the right. Folder
actions such as AI tagging, refresh, and upload remain in the title row. If only
part of the request succeeds, failed rows stay selected so the user can retry them.

The Docker runtime accepts files up to 2048 MB each by default. Set
`PDFIT_MAX_UPLOAD_MB` in the root `.env` to an integer from 1 through 10240 to
override the limit. Files over the configured limit receive HTTP 413 with a
clear message instead of an internal-server error.

## Document export

Open a PDF and use the download action in the document header. The dialog shows
the active filename and **내보내기** downloads that PDF directly; it does not
offer Markdown or JSON data formats.

Export is read-only. It does not rewrite the Google Drive or local source PDF,
and it does not include account, billing, credential, or legal-policy data.
When the browser does not expose a native save-file picker, the visible download
control is a direct browser link to the same PDF with `download=1`. The service
sends an attachment response with both an ASCII fallback and UTF-8 filename,
instead of an inline viewer document. On iPad Safari, the dialog states that
the file goes to the download location configured in Safari. The dialog remains
open after the link click so the browser's download action is not interrupted.

## Same-account library sync

When PC and tablet use the same service origin and Google account, each browser
revalidates its account-scoped folder and tag snapshot on login, window focus,
visibility return, and while the tab remains visible. Pending local metadata
writes and in-progress folder changes are preserved rather than replaced by a
remote snapshot. The folder refresh action also revalidates tags. Different
service origins or different Google OAuth applications are not assumed to share
the same hidden Google Drive app-data storage.

## Viewer toolbar

The viewer toolbar orders page navigation before single-page and two-page layout,
then the independent continuous-scroll toggle, fit-width and fit-height actions,
and zoom controls. Enter a number in the zoom percentage field to apply an exact
scale. Fit actions are momentary commands rather than on/off states. The left
annotation rail labels its cursor tool **선택·이동**.

In the two-page layout, the **표지 따로 보기** toggle next to the layout buttons
switches the pairing at any time, in both the PDF.js viewer and the GPU viewer
(`?engine=gpu`). Off shows (1,2), (3,4), ...; on shows the cover alone, then (2,3),
(4,5), ... The current page stays in view, and switching straight back returns to the
pages you were on. Both viewers remember the choice in this browser.

태블릿에서 연속 스크롤을 끈 경우, 문서를 왼쪽 또는 위로 밀면 다음
페이지(두 페이지 보기에서는 다음 묶음), 오른쪽 또는 아래로 밀면 이전 페이지로 이동합니다.
확대해서 페이지 내부가 스크롤되는 경우에는 밀어서 문서 내부를 먼저 이동하고,
끝까지 이동한 다음 다시 밀거나 상단 화살표로 페이지를 바꿀 수 있습니다.
저장된 두 페이지 보기를 태블릿에서 열 때는
화면 가로·세로 크기에 맞게 시작 배율을 계산하고 PC의 저장 배율은 유지합니다.

## Automatic PDF classification

Choose the gold sparkle action on a PDF row or **PDF 일괄 태그** in the folder toolbar. PDFit checks explicit document-format suffixes first. For example, `AI교육 제안서.pdf` receives `제안서`, not the bookstore subject `인공지능`. Other controlled document tags include `보고서`, `기획서`, `논문`, `매뉴얼`, and `발표자료`. `문서` itself is not added as a tag. Ambiguous filenames continue through the book-category path. Re-running automatic classification on one file replaces its previous controlled category while preserving user-defined tags; existing files are not silently reclassified.

For titles without a document-format suffix, the zero-configuration path first uses deterministic high-signal title rules. Unknown titles are checked against public YES24 product categories with an exact-enough title match. Set `YES24_API_KEY` to use the official YES24 Goods API instead. If no book record can be matched, PDFit checks up to three informative title terms against exact Wikidata entity labels or aliases and maps an unambiguous subject description to an existing category. It never treats a merely related entity or a search-result title as proof. There is no Kyobo integration. When no source provides reliable evidence, classification fails instead of assigning a generic or fabricated tag.

When `SERVICE_AI_BASE_URL`, `SERVICE_AI_MODEL`, and `SERVICE_AI_API_KEY` are configured together, the OpenAI-compatible model performs the final taxonomy classification. When all three are empty, the shared built-in classifier performs it. The local AI-server settings screen remains available for display-name translation compatibility.

Each tag receives a stable, high-contrast color derived from its name. New colors avoid all colors already assigned in the library, and duplicate legacy colors are repaired in tag summaries so existing tags are visually distinct without requiring users to delete and recreate them.

The sidebar lists every tag in Unicode (UTF-16 code unit) order of its name, with no locale collation and no taxonomy grouping: digits, then uppercase Latin, then lowercase Latin, then Hangul (e.g. `3D그래픽`, `AI`, `API`, `AWS`, `Android`, `C++`, `CSS`, `C언어`, `데이터베이스`, `마케팅`, `프로그래밍`). Each row starts with an outlined tag icon in the tag's color instead of a `#` character; the name itself carries no prefix. It does not insert headings, separators, or extra spacing; each tag remains selectable and draggable.
Its folder count is the number of PDFs (`PDF 56`), while the tag count displays only the number of tag-to-PDF assignments (`55`); the tooltip explains the count. A PDF can have zero or multiple tags, so these numbers are not expected to match.

The paid document-info lookup can be stopped with **검색 중단** or by closing the dialog. Closing aborts the in-flight request; an unresponsive lookup times out after 30 seconds without applying a late result. For paid accounts, visible cover cards also queue background public-book lookups, with at most two running simultaneously. Matching ignores spaces and punctuation and tolerates a trailing edition note, but rejects unrelated titles and document-format filenames. A verified book cover is linked automatically; an uploaded cover is never replaced. Lookups that find no reliable match are cached briefly to avoid repeating public searches on every refresh.

The folder toolbar can clear every tag assignment in the current folder without deleting PDFs or tag assignments in other folders. The browser sends one folder-level request, the server performs one database deletion, and the local cache updates in one transaction. Tag operation notifications use one neutral dark surface; only the compact status icon retains a semantic success or error accent.

현재 보고 있는 태그를 삭제하거나 전체 태그를 초기화하면 삭제된 태그의
빈 화면을 남기지 않고 기본 문서 목록으로 돌아갑니다.
