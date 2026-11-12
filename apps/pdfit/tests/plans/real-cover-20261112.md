# 표지 보기 "실제 책 표지로 바꾸기" 브라우저 검증

## 요구 기준 (기능 계약 원문)

`packages/pdfit/docs/api.md`의 "Real-book cover endpoints"와 "Thumbnail and task endpoints", `apps/pdfit/docs/usage.md`의 "Cover view", 커밋 `a0d2de2`(Replace a PDF's cover with the real book cover)의 동작 설명을 기준으로 한다. 검증 의뢰에 적힌 기준:

> After applying, the card's server thumbnail `<img>` ... must load from a URL containing `c=<version>` and the bytes must be the downloaded cover, not the rendered first page. After restore, the URL has no `c=` and `/api/covers` no longer lists the file.

번역 배치 수정(커밋 `d15bbed`, `651bc70`) 재검증 의뢰의 기준:

> zero `ERR_INSUFFICIENT_RESOURCES` (or any failed request) for thumbnails and `/api/covers`; the peak number of concurrent translation POSTs is at most 1; the total translation POSTs is at most ceil(distinct tag labels shown / 50) + 2 for `ko-KR`.

en에서는 번역 POST가 걸려 있는 동안에도 썸네일이 로드되는지가 실제 합격 기준이다.

## 대상과 전제

- 서버: 이미 배포된 Free 컨테이너 `pdfit-pdfit-1`, `http://127.0.0.1:15203`. 이 테스트는 배포·재시작하지 않는다.
- 대상: 실제 라이브러리 `이북/Three.js로 3D 그래픽만들기.pdf` 한 권(`PDFIT_TEST_FOLDER`, `PDFIT_TEST_FILE`로 바꿀 수 있다). 시작 시점 `GET /api/covers`에 이 파일이 있으면 사용자 상태이므로 시작하지 않는다.
- 브라우저: 설치된 Chrome headless(`PDFIT_TEST_CHANNEL`, 기본 `chrome`). 이 PC의 Playwright 1.54.2가 찾는 번들 `chromium-1181`이 없다.
- 표시 이름 번역 POST `/api/settings/translations`는 **기본으로 실제 서버에 보낸다**. `PDFIT_TEST_STUB_TRANSLATIONS=1`일 때만 가로채 원문을 돌려준다(그 실행은 ko 상한 단언을 실패로 본다).
- 언어: `PDFIT_TEST_LANG`(`ko` 기본, `en`). 앱은 `packages/pdfit/src/front/model/languagePreference.ts`에서 localStorage `pdfit.language`를 먼저, 없으면 `navigator.languages[0]`을 쓴다. 테스트는 둘 다 맞춘다(ko → `ko-KR`, en → `en-US`). 화면 문구 단언은 `packages/pdfit/src/front/i18n/messages.ts`의 해당 언어 값이다.
- `PDFIT_TEST_TRANSLATION_WAIT_MS`(기본 0): 8단계 뒤 메인 페이지의 끝나지 않은 번역 POST를 최대 이만큼 기다리며 소요 시간을 기록한다. 이 AI 서버는 느린 로컬 추론 모델이라 한 응답이 10~300 s 걸릴 수 있다.

## 합격 기준

| 단계 | 합격 기준 | 기대값의 출처 |
|---|---|---|
| 1 표지 보기 | 툴바 "표지 보기"로 전환, `pdfit.library.view=covers` 저장, `html lang` = 테스트 언어. 대상 카드의 서버 썸네일이 로드되고(`data-cover-state=ready`, `naturalWidth>0`) 주소에 `c=`가 없다. 버튼 `pdf-cover-real-cover`의 접근 이름 = `realCover` 문구 | 적용 전 바이트 = 카드 `<img>` 주소로 받은 응답 |
| 1a 썸네일 조사 | 맨 위와 휠로 내린 세 화면에서 화면 안 서버 썸네일이 모두 `loaded`, `failed` 0. 조사 순간 끝나지 않은 번역 POST 수를 함께 기록 | 렌더 상태 |
| 2 대화상자 | `role=dialog` 접근 이름이 제목, `aria-labelledby=real-cover-dialog-title`. 검색어 = 파일 이름에서 `.pdf`를 뺀 값, 자동 검색 요청의 `q`도 같다. 후보 `li` 수와 버튼 이름 순서 = `/api/covers/candidates` 응답. 열면 포커스가 대화상자 안, Tab 뒤에도 안. 되돌리기 버튼 없음 | candidates 응답 |
| 2a 검색 버튼 (1440px) | 버튼 글자 노드의 줄 상자 1개, 글자 높이 ≤ 계산된 line-height + 1px, 버튼 높이 < 두 줄 높이(padding + border + line-height × 2). 버튼 스크린샷 `search-button-1440.png` | 계산된 스타일. 버튼 높이는 옆 TextField로 늘어나므로(flex stretch) 한 줄 높이와 같을 필요는 없다 |
| 3 다시 검색 | 검색어를 바꾸고 검색 버튼 → 새 `q`로 요청, 화면 후보 수 = 응답 후보 수 | candidates 응답 |
| 4 적용 | 첫 후보 클릭 → PUT 본문 = 그 후보, 응답 200, 대화상자 닫힘, 카드 주소의 `c` = PUT 응답 `version`, 카드 바이트 SHA-256 = `GET /api/covers/preview?url=<imageUrl>` 바이트, ≠ 적용 전 바이트, JPEG/PNG/WebP 서명, `/api/covers`에 같은 version으로 나열 | preview 응답, `/api/covers` |
| 5 새로고침 | 새로고침 뒤에도 같은 `c`, 같은 바이트 | preview 응답 |
| 6 다크 테마 | 다크 테마 새 컨텍스트에서 카드가 같은 `c`로 로드, 대화상자에 되돌리기 버튼, 검색 버튼 글자 한 줄, Esc로 닫힘 | — |
| 7 375px | 375×812 모바일 에뮬레이션에서 대화상자가 화면 안, 페이지·후보 목록 가로 넘침 0 | 렌더 좌표 |
| 8 되돌리기 | DELETE 응답 `removed=true`, 대화상자 닫힘, 카드 주소 = 적용 전 주소(`c` 없음), 바이트 = 적용 전 바이트, `/api/covers`에서 빠짐 | 1단계 바이트, `/api/covers` |
| 공통 | `pageerror` 0건, 쓰기 요청은 `PUT /api/covers`·`DELETE /api/covers`뿐(번역 POST는 따로 기록) | — |
| 네트워크 `no_err_insufficient_resources` | 실행 중 모든 요청의 `ERR_INSUFFICIENT_RESOURCES` 0 | Playwright `requestfailed` |
| 네트워크 `thumbnails_no_failed_requests` | 썸네일(`/files/*/thumbnail`) 요청 실패 0, HTTP 200·304 외 응답 0. 스크립트가 직접 새로고침·닫는 동안의 ERR_ABORTED만 `abortedDuringOwnTeardown`으로 따로 센다 | `requestfailed`, `requestfinished` |
| 네트워크 `covers_list_no_failed_requests` | `GET /api/covers` 같은 기준(200 외 응답 0) | 같음 |
| 번역 `translation_peak_concurrency_per_page_load_le_1` | 페이지 로드마다 동시에 끝나지 않은 번역 POST ≤ 1. 여러 컨텍스트의 합산 최댓값은 `peakAcrossPagesGlobal`로 기록만 한다 | `request` ~ `requestfinished`/`requestfailed`, 새로고침·닫기로 버려진 POST는 그 시점에 끝난 것으로 표시 |
| 번역 `translation_posts_within_bound_ko` (ko만) | 로드마다 POST 수 ≤ ceil(그 로드에 표시된 고유 태그 이름 수 / 50) + 2. 가로챈 실행은 실패 | 표시 태그 이름 = 칩마다 처음 붙은 `title`(MutationObserver) |
| 번역 기록 | POST별 시작·끝·소요·상태·글자 수·첫 글자 5개, 로드별 글자 합·고유 수·한글만인 글자 수(`hangulOnlyTextsRequested`), 번역 POST가 걸려 있는 동안 끝난 썸네일 200 수(`finishedWhileTranslationPending`) | — |
| 정리 | `finally`에서 시작 때 없던 대상 항목을 DELETE하고, 최종 `/api/covers` 키 집합 = 시작 집합 | 시작 시점 `/api/covers` |

번역 POST 상한을 페이지 로드 단위로 보는 이유: 번역 큐·캐시(`apps/pdfit/src/front/api/settings.ts`)는 페이지 모듈 상태라 새로고침이나 새 컨텍스트마다 처음부터 다시 요청한다.

PDF를 지우거나 옮기거나 올리거나 태그를 바꾸지 않는다.

## 절차

1. `docker ps`로 `pdfit-pdfit-1` healthy 확인, `GET /api/covers` 기준 상태 기록.
2. ko-KR: `PDFIT_TEST_RUN=<YYYYMMDD_HHMM>_unstubbed-ko node apps/pdfit/tests/real-cover-browser.mjs`.
3. en: `PDFIT_TEST_LANG=en PDFIT_TEST_TRANSLATION_WAIT_MS=330000 PDFIT_TEST_RUN=<YYYYMMDD_HHMM>_unstubbed-en node apps/pdfit/tests/real-cover-browser.mjs`.
4. (선택) 번역과 무관하게 표지 기능만: `PDFIT_TEST_STUB_TRANSLATIONS=1 PDFIT_TEST_RUN=<run>-stubbed node apps/pdfit/tests/real-cover-browser.mjs`.
5. 실행 뒤 `GET /api/covers`가 시작과 같은지 확인.

증거: `apps/pdfit/tests/reports/real-cover/<run>/`(`result.json`, 스크린샷). 보고서: `apps/pdfit/tests/reports/real-cover/<YYYYMMDD_HHMM>.md`.

## 실행 기록

| 보고서 | 내용 |
|---|---|
| `reports/real-cover/20261112_1658.md` | 번역 가로챔 PASS, 가로채지 않은 대조 실행 FAIL(번역 POST 폭주) |
| `reports/real-cover/20261112_1720.md` | 배치 수정 배포 뒤 가로채지 않은 ko-KR·en 모두 PASS |

## 범위 밖

Open Library 후보 적용, 후보 0건·출처 실패 경고, `c` 불일치 시 `no-cache` 응답, 다른 탭의 visibilitychange 갱신, 파일 이동·이름 변경 시 표지 이동, 번역된 태그 이름이 화면에 바르게 바뀌는지, 서버가 버려진 번역 LLM 호출을 멈추는지, Pro(Drive) 런타임.
