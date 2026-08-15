@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Compilar APKs - Sorteos y Rifas

rem ---------------------------------------------------------------------------
rem Compila los tres APK (cliente, admin y vendedor) con doble clic.
rem
rem Existe porque compilar a mano en PowerShell tiene tres trampas:
rem   1) PowerShell parte "-PappVersionName=1.14.2" y cree que .14.2 es una tarea
rem      (aqui se pasa entre comillas).
rem   2) Sin ANDROID_HOME, Gradle no encuentra el SDK.
rem   3) Con el gradle del sistema (9.x) falla porque AGP 8.7.3 no lo soporta;
rem      por eso se usa SIEMPRE gradlew.bat, que fija Gradle 8.11.1.
rem ---------------------------------------------------------------------------

set "RAIZ=%~dp0"
set "VERSION=1.14.2"
set "CODIGO=23"

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"

if not exist "%ANDROID_HOME%\platforms" (
  echo [ERROR] No se encontro el SDK de Android en:
  echo         %ANDROID_HOME%
  echo         Instalalo desde Android Studio o define ANDROID_HOME.
  goto :fin
)

echo ===========================================================
echo  Compilando Sorteos y Rifas v%VERSION%  (versionCode %CODIGO%)
echo  SDK: %ANDROID_HOME%
echo ===========================================================
echo.

if not exist "%RAIZ%dist" mkdir "%RAIZ%dist"

call :compilar android        Cliente
if errorlevel 1 goto :fin
call :compilar admin-android  Admin
if errorlevel 1 goto :fin
call :compilar seller-android Vendedor
if errorlevel 1 goto :fin

echo.
echo ===========================================================
echo  LISTO. Los APK quedaron en:  %RAIZ%dist
echo ===========================================================
dir /b "%RAIZ%dist\*.apk"
echo.
echo  IMPORTANTE al instalarlos en el telefono:
echo   - Desinstala primero la version anterior de cada app.
echo     (La firma de tu PC no coincide con la que uso GitHub, asi que
echo      Android no deja instalarla "encima": diria "aplicacion no instalada".)
echo   - Al reinstalar el admin/vendedor tendras que iniciar sesion de nuevo.
echo.
goto :fin

rem --------------------------- subrutina ---------------------------
:compilar
set "APP=%~1"
set "ETIQUETA=%~2"
echo -----------------------------------------------------------
echo  [%ETIQUETA%]  compilando apps\%APP% ...
echo -----------------------------------------------------------
pushd "%RAIZ%apps\%APP%"

rem Ruta del SDK para este proyecto (por si ANDROID_HOME no viaja al daemon).
> local.properties echo # Generado por compilar-apks.bat. No se sube al repositorio.
>> local.properties echo sdk.dir=%ANDROID_HOME:\=\\%

rem Ruta completa: cmd no siempre busca ejecutables en la carpeta actual.
call "%RAIZ%apps\%APP%\gradlew.bat" assembleRelease "-PappVersionName=%VERSION%" "-PappVersionCode=%CODIGO%"
if errorlevel 1 (
  echo.
  echo [ERROR] Fallo la compilacion de %ETIQUETA%. Mira el mensaje de arriba.
  popd
  exit /b 1
)

copy /y "app\build\outputs\apk\release\app-release.apk" "%RAIZ%dist\SorteosRifas-%ETIQUETA%-v%VERSION%.apk" >nul
echo  [%ETIQUETA%] OK -^> dist\SorteosRifas-%ETIQUETA%-v%VERSION%.apk
popd
exit /b 0

:fin
echo.
pause
endlocal
