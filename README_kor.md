# PDFit

**한국어** · [English](README.md)

> WebGPU와 PDFium WebAssembly로 빠르게 읽고, 태그로 방대한 PDF를 직관적으로 관리하는 개인용 문서 서재입니다.

<p align="center">
  <img src="apps/pdfit/public/brand/pdfit-logo-dark.png" alt="PDFit 로고" width="180" />
</p>

PDFit은 로컬 PDF 컬렉션을 검색 가능한 독서 작업공간으로 바꿉니다. 공개 저장소는 `apps/pdfit` 기반의 로컬/USB/SMB Docker 서비스만 제공합니다.

[![Docker](https://img.shields.io/badge/runtime-Docker-2496ED?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)
[![WebGPU](https://img.shields.io/badge/reader-WebGPU-7c3aed?style=flat-square)](packages/pdfit/src/front/components/PdfGpuViewer)

## 왜 PDFit인가

PDFit의 가장 큰 가치는 두 가지입니다.

- **설치형 뷰어를 뛰어넘는 쾌적함** — PDFium WebAssembly와 WebGPU로 페이지를 빠르게 렌더링하며, WebGPU를 지원하지 않는 환경에서는 브라우저 fallback을 사용합니다.
- **대규모 PDF를 쉽게 조직화** — 폴더와 태그로 방대한 문서를 분류하고, 태그를 통해 필요한 PDF를 빠르게 찾습니다.

그 밖에도 다음 기능을 제공합니다.

- **내 라이브러리 그대로** — 로컬, USB, SMB, Docker 폴더를 연결하며 PDF를 외부 서비스에 업로드하지 않습니다.
- **독서 상태 유지** — 폴더, 태그, 진행률, 마지막 뷰어 상태를 PostgreSQL에 저장합니다.
- **시각적 북마크** — 페이지 영역을 고해상도 JPEG로 캡처하고 PDF 좌표, 색상, 투명도, 코멘트를 함께 저장합니다.
- **북마크 작업공간** — 최근 캡처 또는 책별 북마크를 검토하고 원본 미리보기, 페이지 이동, 편집, 삭제를 지원합니다.
- **AI 확장 기반** — Settings에서 AI 서버와 pgvector를 설정할 수 있습니다.
- **로컬 우선 배포** — 계정 로그인이나 원격 저장소 없이 공개 저장소만으로 로컬 Docker 서비스를 실행할 수 있습니다.

## 빠른 시작

필요 환경은 Node.js 20 이상과 npm, Docker Desktop 또는 Compose를 지원하는 Docker Engine입니다. PDFit은 하나의 Docker 서비스로 실행됩니다.

### npm으로 설치

GitHub 저장소에서 최신 릴리스의 런처를 설치합니다.

```bash
npm install https://github.com/hikaMaeng/PDFit.git#v0.4.4
```

설치가 끝나면 `npx`로 런처를 실행합니다.

```bash
npx pdfit
```

실행 후 PDF 라이브러리의 루트 폴더를 입력합니다. 경로를 직접 지정할 수도 있습니다.

```bash
npx pdfit /path/to/pdfs
```

Windows에서는 `D:\\Books`, `S:\\pdf-library`와 같은 경로를 사용하고, macOS/Linux에서는 `/Users/me/Books`, `/mnt/library`와 같은 경로를 사용합니다. Docker는 선택한 호스트 폴더를 컨테이너의 `/app/data/books`에 연결하며, PDF 파일을 복사·업로드·삭제하지 않습니다.

런처가 Docker 서비스를 시작하면 다음 순서로 사용합니다.

1. 브라우저에서 [http://127.0.0.1:15201](http://127.0.0.1:15201)을 엽니다.
2. 라이브러리 사이드바의 **Refresh**를 눌러 연결된 폴더를 스캔합니다.
3. 폴더와 태그로 문서를 정리하고 PDF를 열어 WebGPU/PDFium 뷰어로 읽습니다.
4. **Bookmarks**에서 시각적 북마크와 독서 메모를 확인합니다.

런처 옵션은 다음 명령으로 확인할 수 있습니다.

```bash
npx pdfit --help
```

다른 릴리스를 사용하려면 설치 명령의 `v0.4.4`를 원하는 Git tag로 바꾸면 됩니다.

### 소스에서 실행

개발 또는 로컬 소스 변경이 필요하면 다음과 같이 실행합니다.

```bash
git clone --branch v0.4.4 https://github.com/hikaMaeng/PDFit.git
cd PDFit
npm install
npm run deploy
```

그 다음 [http://127.0.0.1:15201](http://127.0.0.1:15201)을 엽니다.

## 개발 명령

| 명령 | 용도 |
| --- | --- |
| `npm run build` | 공유 패키지와 통합 앱 빌드 |
| `npm run deploy` | 로컬 빌드 후 Docker 서비스 재생성 |
| `npm run verify:repo` | 저장소와 Compose 계약 검사 |
| `npm run verify:pdfit` | 통합 앱, API, Settings, 뷰어 산출물 검사 |
| `npm run verify:pdfit:acceptance` | PDFit acceptance matrix 실행 |
| `npm run test:pdfgpu` | PDFGPU 통합 검사 |

Docker 배포에는 반드시 `npm run deploy`를 사용합니다. 런타임 이미지는 미리 빌드된 `apps/pdfit/dist`를 복사하며 Docker 내부에서 프로젝트를 빌드하지 않습니다.

Windows의 NAS 매핑 드라이브를 로컬 서재로 사용할 때는 루트 `.env`에 Docker 외부 볼륨과 SMB 연결을 명시합니다. `PDFIT_SMB_PASSWORD`는 로컬 파일에만 저장하고 공유하거나 커밋하지 않습니다. 배포 명령은 Windows 호스트의 로컬 전용 SMB 중계를 준비하고, 읽기 전용 CIFS 볼륨을 확인한 뒤 서재 인덱스를 갱신합니다.

```dotenv
PDFIT_BOOKS_VOLUME=pdfit-usbshare1-cifs
PDFIT_BOOKS_SUBPATH=이북
PDFIT_BOOKS_ROOT_NAME=이북
PDFIT_SMB_HOST=192.168.0.13
PDFIT_SMB_SHARE=usbshare1
PDFIT_SMB_PROXY_PORT=1445
PDFIT_SMB_USERNAME=<NAS 사용자>
PDFIT_SMB_PASSWORD=<NAS 비밀번호>
```

## 아키텍처 개요

```text
apps/pdfit                  통합 서비스, 뷰어 엔트리, Settings, Docker 런타임
        │
        ├── packages/pdfit   공유 React UI, 뷰어, 라우트, PostgreSQL 어댑터
        └── Docker            15201 포트의 단일 pdfit 컨테이너
```

브라우저 서비스와 `/viewer` 전용 엔트리는 동일한 앱, 메타데이터, 데이터 루트, 릴리스 버전을 공유합니다.

## 문서

- [작업공간과 아키텍처](docs/01-workspace-overview.md)
- [아키텍처와 경계](docs/02-architecture-and-boundaries.md)
- [빌드·배포·Compose](docs/03-build-deploy-and-compose.md)
- [런타임 계약](docs/04-runtime-contract.md)
- [데이터 및 마이그레이션 계약](docs/05-migration-and-data-contract.md)
- [검증과 증거](docs/08-verification-and-evidence.md)
- [통합 앱 문서](apps/pdfit/README.md)

## 프로젝트 상태

PDFit은 계속 발전 중입니다. 현재 저장소는 통합 Docker 배포에 맞춰져 있으며, 앱을 열 때 대규모 또는 네트워크 기반 라이브러리를 예기치 않게 스캔하지 않도록 Refresh 시에만 동기화합니다.
