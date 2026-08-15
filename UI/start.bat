@echo off
chcp 949 >nul
title waferQC 실행기

rem ---------------------------------------------------------------------
rem  waferQC 실행기 - 더블클릭하면 창 두 개가 뜬다.
rem
rem    1) 판정 모델 서버 (backend\wafer_final_package\serve.py)  :8077
rem    2) 화면 개발 서버 (frontend, Vite)                        :5180
rem
rem  화면은 시작할 때 모델 서버에 자동으로 붙는다. 모델 서버가 없으면
rem  규칙 대체판으로 돌아가고, 그 사실이 화면 위쪽에 표시된다.
rem  끄려면 두 창을 닫거나 각 창에서 Ctrl+C.
rem
rem  * 이 파일은 CP949 + CRLF 로 저장해야 한다. UTF-8이나 LF로 저장하면
rem    한글이 깨지고 if 블록 파싱이 깨진다. (.gitattributes로 CRLF 고정)
rem ---------------------------------------------------------------------

set "ROOT=%~dp0"
set "MODEL=%ROOT%backend\wafer_final_package"
set "FRONT=%ROOT%frontend"

if not exist "%MODEL%\.venv\Scripts\python.exe" (
    echo.
    echo   [오류] 모델 서버의 가상환경을 찾지 못했습니다.
    echo          %MODEL%\.venv\Scripts\python.exe
    echo.
    pause
    exit /b 1
)

if not exist "%FRONT%\node_modules" (
    echo.
    echo   [알림] node_modules가 없습니다. 먼저 설치합니다. 몇 분 걸립니다...
    pushd "%FRONT%"
    call npm install
    popd
)

echo.
echo   [1/2] 판정 모델 서버 여는 중 ... http://127.0.0.1:8077
start "waferQC 모델 서버" /D "%MODEL%" cmd /k .venv\Scripts\python.exe serve.py

echo   [2/2] 화면 개발 서버 여는 중 ... http://127.0.0.1:5180
start "waferQC 화면" /D "%FRONT%" cmd /k npm run dev

echo.
echo   모델을 올리는 데 20초쯤 걸립니다. 끝나면 브라우저가 열립니다.
timeout /t 20 /nobreak >nul
start "" http://127.0.0.1:5180/

echo.
echo   창 두 개가 떴는지 확인하세요. 이 창은 닫아도 됩니다.
echo   화면 위쪽 배지가 "실제 모델"이면 모델까지 정상 연결된 것입니다.
echo   "규칙 대체판"이면 모델 서버 창의 오류 메시지를 확인하세요.
echo.
timeout /t 6 >nul
