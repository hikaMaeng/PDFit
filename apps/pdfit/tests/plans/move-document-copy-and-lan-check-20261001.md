# 이동 안내 문구와 기존 LAN 리디렉션 확인 계획

- 변경 대상: ‘다른 폴더로 이동’ 확인창의 한국어 안내에서 `PDF`를 `문서`로 바꾼다. LAN 리디렉션 구성은 변경하지 않는다.
- 환경: Windows 11, 로컬 Docker Compose `service`와 기존 `service-lan`, Chromium 한국어 화면.
- 브라우저 절차: 폴더 문서 행에서 이동 확인창을 열어 `문서를 이동할 폴더를 선택하세요.`가 표시되고 기존 `PDF를 이동할...`이 사라졌는지 확인한다.
- LAN 절차: `docker compose ps service-lan --format json`으로 기존 컨테이너가 healthy인지 확인한다. `curl.exe -s -D - -o NUL http://192.168.0.5:15202/`에서 `Location: https://pdfit.io/`를 확인하고, `curl.exe -L`의 최종 응답을 확인한다.
- 실패 기준: 이동 안내의 구 문구가 남아 있거나 LAN 경로가 `pdfit.io`로 리디렉션되지 않으면 실패한다.
- 한계: 서버 PC에서 LAN IP로 수행한 검사는 별도 클라이언트 PC의 방화벽·네트워크 도달성까지 증명하지 않는다.
