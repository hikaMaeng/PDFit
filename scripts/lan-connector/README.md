# PDFit LAN connector

이 설치 파일은 다른 Windows 컴퓨터에서 PDFit 로컬 서비스를 `http://localhost:15202`로 열기 위한 SSH 터널을 Windows 로그인 때 자동으로 시작합니다. Google 로그인 콜백을 변경하지 않습니다. `pdfit.io` 운영 사이트 설정도 변경하지 않습니다.

1. `PDFit-LAN-Client-Setup.zip`을 다른 Windows 컴퓨터에 복사하고 압축을 풉니다.
2. `Install-Client.cmd`를 한 번 실행합니다. 관리자 권한은 필요하지 않습니다.
3. 바탕화면에 생성된 `PDFit-LAN-public-key.txt`의 내용을 PDFit 서버 관리자에게 전달합니다. 공개 키이며 개인 키는 컴퓨터 밖으로 보내지 않습니다.
4. 서버 관리자가 공개 키를 승인하면 다른 컴퓨터의 브라우저에서 `http://localhost:15202`를 엽니다. 이후 Windows 로그인 시 터널이 자동으로 다시 연결됩니다.

접속되지 않으면 `%LOCALAPPDATA%\PDFitLAN\tunnel.log`를 확인합니다. 다른 프로그램이 15202번 포트를 이미 사용 중이면 종료해야 합니다.

서버 관리자는 공개 키를 `client-public-key.txt`로 저장한 뒤 이 PC에서 `Approve-Client-Key.vbs`를 더블클릭하고 Windows 관리자 승인 창을 확인합니다. 서버의 SSH 관리자 승인 키 파일에 해당 공개 키가 추가됩니다. 이 승인 단계는 새 컴퓨터마다 한 번 필요합니다.
