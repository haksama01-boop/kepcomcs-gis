# KEPCOMCS-GIS

한전MCS 검침업무 GIS 분석시스템

## 구성

- `index.html` : 메인 화면
- `css/style.css` : 화면 스타일
- `js/app.js` : 지도, 엑셀, 필터, 마커, 로드뷰, 메모, PNG 저장 기능

## 배포 방법

Cloudflare Pages 또는 GitHub Pages에 정적 사이트로 배포할 수 있습니다.

## 사용 방법

1. 카카오 JavaScript 키 입력
2. 지도 불러오기
3. 엑셀 파일 업로드
4. 좌표 읽기 및 지도 표시
5. 필터, 로드뷰, 메모, PNG 저장 기능 사용

## 필수 엑셀 컬럼

- 계약번호
- 검침원
- 분구
- 주소

선택적으로 아래 좌표 컬럼이 있으면 주소 변환 없이 바로 표시됩니다.

- 경도
- 위도

## 만든이

조학래


## 1번 공용자료 업로드 설정

1번 공용자료 업로드는 Cloudflare Pages Functions + KV 저장소를 사용합니다.

### Cloudflare 설정

1. Cloudflare 대시보드 → Workers & Pages → KV 생성
2. KV 이름 예시: `KEPCOMCS_GIS_KV`
3. Pages 프로젝트 → Settings → Functions → KV namespace bindings
4. Binding name: `GIS_KV`
5. 생성한 KV namespace 선택
6. Pages 프로젝트 → Settings → Environment variables
7. Variable name: `ADMIN_PASSWORD`
8. 원하는 관리자 비밀번호 입력
9. 다시 배포

### 사용 방식

- 1번 공용자료 업로드: 관리자 비밀번호 필요, 모든 접속자가 공유
- 2번 개인자료 업로드: 각자 브라우저에서만 표시, 서로 영향 없음
