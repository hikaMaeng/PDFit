# 태그 입력·체크박스·호버 검증 계획

## 환경과 목적

Windows 11에서 루트 Docker Compose의 service를 갱신한 뒤 Playwright Chromium으로 http://127.0.0.1:15201을 검증한다. API는 무료 체험 사용자와 PDF 한 개 및 기존 태그가 있는 메타데이터로 모의한다. 실제 문서를 변경하지 않는다.

## 절차

1. `npm run build --workspace=@pdfit/pdfit` 및 `npm run build --workspace=service` 실행.
2. `docker compose up -d --build service` 실행.
3. `node apps/pdfit/tests/viewer-tags-free-tier-browser.mjs` 실행.
4. 마우스를 목록 밖에 놓고 체크박스 opacity와 클릭 가능 여부 확인.
5. 태그 본문 호버에서 전체 배경 변화를 확인하고, × 위로 이동해 같은 배경 강조가 유지되는지 확인.
6. 폴더 화면과 태그 화면 각각에서 신규 태그를 Enter로 추가하고 입력칸이 비워지는지 확인.
7. 관리창을 닫아도 중복 안내가 없고 태그별 저장 요청이 한 번인지 확인.
8. 무료 버전 자동 분류 비활성화, 태그 색상, 뷰어 헤더 표시를 함께 확인.

## 통과 기준

호버 전 체크박스가 보이고 선택 가능해야 하며, 태그 본문과 삭제 아이콘 모두 전체 칩의 배경을 강조해야 한다. 정상 태그 추가 후 잘못된 중복 안내와 반복 저장이 없어야 한다. 브라우저 오류가 없어야 한다.
