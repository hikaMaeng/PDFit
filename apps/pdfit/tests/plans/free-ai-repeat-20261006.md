# 무료 AI 반복 실행 검증

Windows 11, Docker Compose service, 127.0.0.1:15201.
공유·서비스 빌드 후 루트 Compose service 갱신. node apps/pdfit/tests/free-ai-repeat-browser.mjs 실행.
무료 trial/auth 및 AI 응답은 fixture로 가로채고 실제 AI 비용·서재 변경 없이 연속 2회 실행, 무료 안내, 요청별 최대 10개, 완료 후 버튼 활성 확인.

추가 확인: 무료 버튼의 사용해 보기 문구와 완료 후 PRO 안내, 폴더 이동 목록 선택 및 이동 버튼 활성, 삭제 확인 취소 색상과 기본 대비 밝은 삭제 호버 배경. 실제 이동/삭제는 실행하지 않는다.

검색 결과 없음과 검색 초기화 후 폴더 선택, 목록 높이 224px, 유료 안내의 버튼 하단 배치와 nowrap, 체험 안내 줄바꿈을 검증한다.

사이드바 HashTagIcon 표시와 목록 태그 # 접두사 및 0px 테두리를 확인한다.
