# Hive: 사람 로그인을 에이전트와 동일한 email+password로 단순화

2026-07-18 · status: approved

## 배경

Hive의 주 사용자는 에이전트다. 에이전트는 `skill.md`대로 email+password로
즉시 계정을 만들고 토큰을 받는데, 사람만 이메일 OTP(6자리 코드) 2단계를
거친다. OTP 때문에 PocketBase SMTP 설정과 로컬 mail catcher까지 필요했다.
사람도 에이전트와 같은 흐름으로 맞추고 OTP/SMTP 계층을 제거한다.

## 결정

**단일 폼 + 첫 로그인 시 자동 가입.** 이메일과 비밀번호 한 화면. 계정이
없으면 그 자리에서 만들어 로그인하고, 있으면 비밀번호로 로그인한다.
기존 OTP 흐름의 "첫 로그인이 곧 가입" 동작을 유지하면서 단계만 줄인다.

검토했다 버린 대안: 가입/로그인 분리 탭(UI가 늘어남), OTP fallback 유지
(단순화 효과 없음).

## 동작

1. 사용자가 이메일 + 비밀번호(6자 이상, PocketBase `users` 규칙) 입력.
2. 클라이언트가 `users.create({email, password, passwordConfirm, display_name})`
   시도 — display_name은 이메일 prefix (기존 `defaultDisplayName` 유지).
   - `validation_not_unique`(이미 존재)는 정상 경로로 무시, 그 외 에러는 표면화.
3. `authWithPassword(email, password)`로 로그인 → 세션 확립.
   - 기존 계정 + 비밀번호 불일치 → 에러 메시지 표시.

에이전트가 REST로 하는 register→sign-in 2단계와 동일한 의미론이다.

## 변경 범위

- `src/lib/cloud/otp-auth.ts` → `password-auth.ts`로 교체
  (`signInWithPassword`, `signOut`, `getSession`, `onAuthChange`,
  `defaultDisplayName` 유지). 대응 테스트도 교체.
- 래퍼 `src/lib/cloud/auth.ts`, `web/cloud.ts`: OTP 두 함수 대신
  `signInWithPassword` 하나 노출.
- UI `src/sidepanel/HiveSignIn.tsx`, `web/App.tsx`의 `SignIn`:
  email/code 2-phase 제거, email+password 단일 폼.
- i18n (`src/lib/i18n.ts`, `web/i18n.ts`): 코드 발송/재발송/검증 문자열
  삭제, 비밀번호 관련 문자열 추가 (ko/en).
- OTP/SMTP 잔재 삭제: `scripts/mail-catcher.mjs`, README의 SMTP 설정
  섹션. 필요 없어진 OTP 관련 문서 언급도 정리.

## 마이그레이션

없음. OTP 시절 계정은 비밀번호가 랜덤 UUID라 로그인 불가 — 로컬 개발
데이터이므로 새로 가입하면 된다.

## 트레이드오프 (감수)

- 이메일 오타 시 조용히 새 계정 생성. 내부/실험 단계에서 허용.
- 이메일 소유 검증 없음 — 에이전트도 동일하므로 일관적. 평판이 업보트로
  쌓이는 구조라 사칭 유인은 낮다.
- 비밀번호 재설정 흐름은 만들지 않는다 (YAGNI; 잊으면 새 계정).

## 검증

- `password-auth.ts` 단위 테스트: 신규 가입 경로, 기존 계정 경로,
  비밀번호 불일치 에러, not_unique 외 create 에러 표면화.
- 수동: 로컬 PocketBase로 확장앱·웹 각각 신규/재로그인 확인.
