@echo off
REM Vox launcher.
REM
REM Unlike the previous version this does NOT regenerate the parser or
REM recompile on every run, and it never copies sources into your working
REM directory. Run build.bat once, then put this folder on your PATH.

setlocal
set "VOX_ROOT=%~dp0"

if "%~1"=="" (
    echo Usage: vox ^<file.vox^> [--emit-ir] [--check] [--steps N]
    exit /b 64
)

if not exist "%VOX_ROOT%build\vox.jar" (
    echo vox: build\vox.jar not found. Run "%VOX_ROOT%build.bat" first. 1>&2
    exit /b 1
)

java -jar "%VOX_ROOT%build\vox.jar" %*
exit /b %ERRORLEVEL%
