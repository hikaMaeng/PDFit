# 현재 배포 이미지의 태블릿 Enter 추가 검증

- 일시: 2026-10-06 KST
- 환경: Windows 11, Docker Compose service healthy, 127.0.0.1:15201, Chromium 및 WebKit
- 실행: node apps/pdfit/tests/tag-input-tablet-browser.mjs
- 터치/모바일 에뮬레이션 1024×1180에서 태그관리 입력 후 Enter 추가 성공.
- 한글 조합 중 Enter는 추가하지 않고, 조합이 끝난 Enter로 저장 요청 발생 확인.
- 응답 대기 중 추가 버튼 비활성 및 태그 미표시, 성공 응답 후 태그 1개 표시 확인.
- 추가 버튼, 선택 색상, 새로고침 후 색상 유지 및 문서 목록 유지 확인.
- Chromium/WebKit 모두 통과. 현재 코드에 기존 Enter 처리 수정이 포함되어 추가 소스 수정은 필요하지 않았음.
- 실제 기기의 소프트웨어 키보드는 직접 테스트하지 않음. 변경 API를 가로채 실제 사용자 문서는 변경하지 않음.
