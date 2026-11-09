# AI 자동 태그 버튼·섹션 색상·제목 간격

## 환경과 실행

Windows 11, 루트 Docker Compose service, http://127.0.0.1:15201.
브라우저 API 라우트로 인증·문서를 대체한다. 실제 사용자 문서나 AI 서비스는 호출하지 않는다.

1. `npm run build --workspace=@pdfit/pdfit`
2. `npm run build --workspace=service`
3. `docker compose up -d --build service`
4. `docker compose ps service`의 healthy 확인.
5. `node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs`

## 통과 조건

- 무료 도구 모음에 `AI 자동 태그` 버튼 표시 및 첫 클릭 가능.
- 클릭 후 정확히 `AI 자동 태그 체험판을 소진하였습니다` 표시, disabled 적용.
- 다크·라이트 모드에서 버튼·아이콘의 AI 강조색 제거 및 회색 비활성 표시.
- 무료 클릭에서 AI 요청·확인창 없음, 개별 AI 버튼 숨김·관리창 분류 비활성 유지.
- 유료 버튼명 변경, 확인창 취소 시 요청 없음, 확인 실행 시 모의 태그 API 1회 및 결과 반영.
- 왼쪽 폴더·태그 섹션 아이콘 computed color `rgb(59, 130, 246)`.
- 폴더·태그 아이콘·제목 간격 computed columnGap `8px`.
- 상단 폴더 작업 레이블 `업로드 → 새로고침 → 폴더 내 모든 태그 해제` 순서, 도구 모음보다 위에 배치.
- 업로드 클릭 파일 선택 열림, 태그 해제 클릭 확인창 열림·취소 정상, 이전 도구 모음 중복 없음.
- 검색 클릭 전 버튼만 표시, 클릭 후 입력창 포커스·검색 필터·닫기·Escape 정상.
- 태그 열에 태그 칩·태그 관리·자동 태그 순서, 기존 작업 열 중복 없음.
- 체크 전 이동·삭제 버튼 숨김, 개별·전체 선택 후 전체 선택 옆 표시, 해제 후 숨김.
- 폴더·태그 목록의 확인창 취소 정상, 행 오른쪽의 이동·삭제 없음.
- 모의 문서 2개 전체 선택 이동 후 대상 폴더에 2개 표시, 전체 선택 삭제 API 2회 확인.
- 폴더 내 모든 태그 해제 버튼·확인창은 일반 태그 아이콘(LocalOfferIcon)을 사용하고 사선 아이콘(LabelOffIcon)은 표시하지 않는다.
- 기존 선택·표지 한 줄 정렬·설정 모달·태그 색상·뷰어 태그·목록 열 회귀 통과.

## 증거

`tests/reports/viewer-tags-free-tier/`의 시간별 보고서, `20260929_000000/result.json`,
`ai-auto-tag-free-before.png`, `ai-auto-tag-free-exhausted.png`,
`sidebar-section-icons-blue.png`, `folder-count-rectangle.png`.
