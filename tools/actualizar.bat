@echo off
REM =====================================================================
REM  AFXX - actualizar el sitio (Windows)
REM
REM  IMPORTANTE: despues del commit de limpieza, .env y data.json dejan
REM  de estar versionados. Si haces "git pull" a mano, git te BORRA esos
REM  dos archivos del disco (son la configuracion y la base de datos).
REM  Este script los respalda antes del pull y los restaura despues.
REM
REM  Uso:  doble click en  tools\actualizar.bat
REM =====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set "REPO=%CD%"
set "STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~6,2%-%TIME:~0,2%%TIME:~3,2%"
set "STAMP=%STAMP: =0%"

echo.
echo  ============================================
echo   AFXX - actualizar a la ultima version
echo  ============================================
echo.

REM ---------------------------------------------------------------- 1
echo  [1/5] Respaldando .env y data.json...
if not exist "%REPO%backend\_backup" mkdir "%REPO%backend\_backup" >nul 2>&1
if exist "%REPO%backend\.env" (
  copy /Y "%REPO%backend\.env" "%REPO%backend\_backup\.env.%STAMP%" >nul
  echo        .env respaldado
)
if exist "%REPO%backend\data.json" (
  copy /Y "%REPO%backend\data.json" "%REPO%backend\_backup\data.json.%STAMP%" >nul
  echo        data.json respaldado
)
echo.

REM ---------------------------------------------------------------- 2
echo  [2/5] Descargando cambios de GitHub...
call git pull origin main
if errorlevel 1 (
  echo.
  echo  ERROR: fallo el pull. Revisa tu conexion y tus credenciales de GitHub.
  echo         Si pide usuario: tu usuario de GitHub. Si pide password: usa un
  echo         Personal Access Token, no tu contrasena.
  echo.
  pause
  exit /b 1
)
echo.

REM ---------------------------------------------------------------- 3
echo  [3/5] Restaurando .env y data.json si git los borro...
if not exist "%REPO%backend\.env" (
  if exist "%REPO%backend\_backup\.env.%STAMP%" (
    copy /Y "%REPO%backend\_backup\.env.%STAMP%" "%REPO%backend\.env" >nul
    echo        .env restaurado
  )
)
if not exist "%REPO%backend\data.json" (
  if exist "%REPO%backend\_backup\data.json.%STAMP%" (
    copy /Y "%REPO%backend\_backup\data.json.%STAMP%" "%REPO%backend\data.json" >nul
    echo        data.json restaurado
  )
)
echo.

REM ---------------------------------------------------------------- 4
echo  [4/5] Comprobando dependencias...
if not exist "%REPO%node_modules\dotenv" (
  echo        dotenv falta en la raiz. Instalando...
  cd /d "%REPO%"
  call npm install --no-audit --no-fund
  cd /d "%REPO%backend"
)
if not exist "%REPO%backend\node_modules\express" (
  echo        Faltan dependencias del backend. Instalando...
  cd /d "%REPO%backend"
  call npm install --no-audit --no-fund
)
echo.

REM ---------------------------------------------------------------- 5
echo  [5/5] Reiniciando el backend...
taskkill /FI "WINDOWTITLE eq *node*" /F >nul 2>&1
cd /d "%REPO%backend"
start "AFXX backend" /min cmd /c "node server.js"
timeout /t 3 /nobreak >nul
echo        Backend arrancado en http://localhost:4000
echo.
echo  ============================================
echo   Listo. El sitio ya esta actualizado.
echo  ============================================
echo.
echo  RECORDATORIO: al reiniciar tu tunel de Cloudflare la URL cambia.
echo  Actualizala en Render: tu servicio ^> Environment ^> TARGET_URL.
echo  Respaldo de esta actualizacion: backend\_backup\
echo.
pause
