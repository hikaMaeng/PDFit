# 테스트 보고서: 태그 폴더

- 실행 시각: 2026-11-20 KST
- 환경: Windows 11, Docker Compose `pdfit`(Free, `127.0.0.1:15203`), Playwright(headless Chromium)
- 계획: `apps/pdfit/tests/plans/tag-folders-20261120.md`
- 요구 기준(원문): 계획서 "요구 기준" 인용 참조

## 결과

| 검증 | 결과 |
|---|---|
| `npm run build --workspace=@pdfit/pdfit` (`tsc` 서버·프런트) | PASS |
| `npm run deploy:standalone` (빌드, 이미지 재빌드, 컨테이너 재생성, 색인 720 PDF) | PASS |
| `node --test packages/pdfit/tests/tag-folders.test.mjs` (호스트) | PASS 2, SKIP 1(DB URL 없음) |
| 같은 테스트를 컨테이너 안에서 `PDFIT_TEST_DATABASE_URL` 지정 실행 | PASS 3/3 (격리 스키마, 실행 후 `tagfolders_*` 스키마 0개) |
| `tag-folders-browser.mjs` A(API) | PASS — 빈 이름 400, 중복 409, 없는 태그·없는 폴더 404, 태그 넣기·빼기 반영, 폴더 삭제 뒤 태그 이름 목록 139개 그대로 |
| `tag-folders-browser.mjs` B(화면) | PASS — 아래 요구 번호별 표 참조, `pageerror` 0 |
| `favorites-browser.mjs` (사이드바 변경 회귀) | PASS — 별 토글·즐겨찾기 보기 정상, 실행 후 즐겨찾기 0건(시작 전과 동일) |
| `untagged-browser.mjs` (사이드바 변경 회귀) | PASS — API 4 = 배지 4 = 칩 4 = 행 4 |
| `npm run verify:repo` | PASS |
| 컨테이너 상태 | `healthy` |
| 테스트 후 실데이터 | `GET /api/tag-folders` = `[]`, `GET /api/favorites` = `[]` (시작 전과 동일) |

## 요구 번호별 대조 (B 화면, 서버 실행 결과)

| 요구 | 확인한 것 |
|---|---|
| 2 폴더 추가 아이콘 → 이름 입력 → 생성 | 태그 헤더의 `lnb-create-tag-folder` 버튼, 대화상자 입력·저장 후 폴더 행 2개 생성. 같은 이름은 "이미 사용 중인 태그 폴더 이름입니다."로 거부 |
| 3 미분류 아래에 폴더(유니코드순) 다음에 태그 | 폴더를 `나다-…`, `가나-…` 순으로 만들었는데 화면 순서는 `[가나, 나다]`. 위치: 미분류 행 top < 첫 폴더 top, 마지막 폴더 top < 첫 일반 태그 top (`sidebar-folders.png`는 일부러 폴더 둘 + 태그를 한 화면에 담음) |
| 4·5 태그를 폴더로 드래그, 하단 목록에서는 안 보임 | `3D그래픽`을 폴더로 드래그 → 일반 목록 행 0개, 폴더 안 행 1개, 폴더 배지 1, 서버 `tags`가 `["3D그래픽"]` |
| 6 접기·펴기 | 접으면 폴더 안 목록이 DOM에서 사라지고 `aria-expanded=false`, 새로고침 뒤에도 접힘 유지, 다시 펴면 행 복귀 |
| 7 삭제하면 태그가 폴더에서 제거 | 확인 대화상자 후 폴더 소멸, 태그는 일반 목록에 복귀(`3D그래픽` 행 확인), `GET /api/tags/summary` 이름 목록이 시작 전과 동일 |
| 8 여러 폴더 소속 | 폴더 안 행을 다른 폴더로 끌어 두 폴더에서 같은 태그 행 2개(`two-folders.png`) |
| 9 폴더는 접기·펴기만, 책 목록은 태그로 | 폴더 클릭 전후 `page.url()` 동일. 폴더 안 태그 클릭 시 `/tag/3D%EA%B7%B8…`로 이동 |

증거: `apps/pdfit/tests/reports/tag-folders/20261120_tag_folders/` (`sidebar-folders.png`, `two-folders.png`, `after-delete.png`), 회귀: `apps/pdfit/tests/reports/untagged/20261120_tag_folders_regress/`.

## 검증하지 못한 것

- 터치 기기에서의 드래그는 확인하지 않았다(HTML5 드래그 사용, 기존 책→태그 드래그와 같은 한계). 모바일 폭 레이아웃도 보지 않았다.
- 요구 5의 "일단 폴더로 드래그해서 옮겨진"은 폴더 안 행을 다른 폴더로 끌 때 원래 폴더에 남는 "추가"로 해석했다(8번과 충돌하지 않게). 이동(원래 폴더에서 빠짐)을 원했다면 해석이 다르다.
- 요구 3의 "바로 밑"은 DOM 위치 대소(미분류 < 폴더 < 태그)로만 대조했고 픽셀 간격은 재지 않았다.
- Pro(`apps/service`)는 빌드·배포하지 않았다. 해당 스토어는 태그 폴더를 구현하지 않아 `501` → UI 숨김이 설계 동작이며 그 경로는 호스트 테스트(501)로만 확인했다.
- 태그 이름 변경 기능은 없어 그 경로는 해당 없음. 태그가 마지막 책을 잃어 고아 정리로 지워지는 경우 폴더 소속도 함께 사라지는 것은 DB 테스트(`deleteTag`)로만 확인했고 고아 정리 경로 자체는 실행하지 않았다.

## 기각된 가설·관찰

- 컨테이너 로그에 `POST /translations 502`가 10줄 있다. 태그 폴더 기능의 오류가 아니라, 사용자 입력 이름(`DisplayName`)을 AI 번역 서버로 보내는 기존 표시 번역이 실행마다 새로 만든 임시 폴더 이름에 대해 요청을 보내고 서버가 502로 답한 것이다(태그·책 폴더 이름도 `DisplayName`을 쓰는 같은 경로). 502의 직접 원인(번역 서버 미설정 여부 등)은 확인하지 않았고, 테스트 대상 기능에 영향이 없어 이번 변경 범위에서 손대지 않았다.
- 첫 브라우저 실행은 삭제 확인 대화상자를 찾지 못해 실패했다. 기능 결함이 아니라 앞 대화상자의 닫힘 전환 중에 다음 삭제 버튼을 눌러 배경막이 클릭을 받은 테스트 타이밍 문제였고, 대화상자가 닫힌 뒤 진행하도록 테스트를 고쳐 통과했다(코드 변경 없음).
- 회귀로 다시 돌린 `favorites-browser.mjs`가 기존 보고서 이미지 2장을 덮어써서 `git checkout`으로 복원했다.
