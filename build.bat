@echo off
REM Builds Vox: generates the parser from Vox.g4, compiles everything
REM packages a self-contained runnable jar at build\vox.jar.

setlocal
cd /d "%~dp0"

set "ANTLR=tools\antlr-4.13.2-complete.jar"

if not exist "%ANTLR%" (
    echo build: missing %ANTLR% 1>&2
    exit /b 1
)

echo ==^> generating parser
if exist build\gen rmdir /s /q build\gen
if exist build\classes rmdir /s /q build\classes
if exist build\runtime rmdir /s /q build\runtime
mkdir build\gen
mkdir build\classes
java -cp "%ANTLR%" org.antlr.v4.Tool -visitor -no-listener -o build\gen Vox.g4
if errorlevel 1 exit /b 1

echo ==^> compiling
dir /s /b build\gen\*.java src\*.java > build\sources.txt
javac -nowarn -d build\classes -cp "%ANTLR%" @build\sources.txt
if errorlevel 1 exit /b 1

echo ==^> packaging build\vox.jar
REM Unpack the ANTLR runtime so the jar needs no classpath to run.
mkdir build\runtime
pushd build\runtime
jar xf "..\..\%ANTLR%" org/antlr/v4/runtime
popd
jar --create --file build\vox.jar --main-class VoxMain -C build\classes . -C build\runtime org
if errorlevel 1 exit /b 1

echo ==^> done: build\vox.jar
echo     run with: vox examples\factorial.vox
