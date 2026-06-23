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

## KEPCOMCS-GIS v3.0

### 자료 업로드 방식

- 1번 공용자료 업로드
  - 관리자 비밀번호 필요
  - Cloudflare D1 데이터베이스에 저장
  - 모든 접속자가 같은 공용자료 확인 가능
  - 사이트 접속 시 자동으로 공용자료를 확인

- 2번 개인자료 업로드
  - 업로드한 사람의 브라우저에서만 적용
  - 다른 사용자 화면에는 영향 없음

## Cloudflare D1 설정

1. Cloudflare 대시보드 → Storage and Databases → D1 SQL Database
2. 데이터베이스 생성
   - 이름 예시: `kepcomcs_gis_db`
3. Workers & Pages → `kepcomcs-gis` 프로젝트 → Settings
4. Functions → D1 database bindings 추가
   - Variable name: `GIS_DB`
   - D1 database: 방금 생성한 DB 선택
5. Settings → Environment variables 추가
   - Variable name: `ADMIN_PASSWORD`
   - Value: 관리자 비밀번호
6. GitHub에 파일 업로드 후 Cloudflare 자동 배포 확인

## 필요한 파일

- `index.html`
- `css/style.css`
- `js/app.js`
- `functions/api/shared-data.js`
- `README.md`


## v3.1 관리자 로그인 방식

- 사이트 접속 시 공용자료 보기가 기본 실행됩니다.
- 일반 사용자는 개인자료 업로드만 사용할 수 있습니다.
- `관리자 로그인` 버튼을 눌러 비밀번호 인증에 성공하면 `공용자료 변경` 메뉴가 표시됩니다.
- 공용자료 변경 업로드는 Cloudflare D1 데이터베이스에 저장되며 모든 접속자에게 공유됩니다.

필요한 Cloudflare 설정:

- Environment Variable
  - `ADMIN_PASSWORD`
- D1 Binding
  - Variable name: `GIS_DB`


## v3.2 수정 사항

- D1 공용자료 저장 POST 오류 대응
- UPSERT 대신 DELETE 후 INSERT 방식으로 변경
- 서버 오류 발생 시 상세 메시지 반환
