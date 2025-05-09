@echo off
setlocal

set GRAMMAR=Vox
set INPUT_FILE=%1

if "%INPUT_FILE%"=="" (
    echo Usage: vox_parse File.vox
    exit /b 1
)

for %%f in (%INPUT_FILE%) do set BASENAME=%%~nf

copy %VOX_HOME%\%GRAMMAR%.g4
copy %VOX_HOME%\%GRAMMAR%Main.java
copy %VOX_HOME%\IRBuilder.java

java -classpath %VOX_HOME%\antlr-4.13.2-complete.jar;. org.antlr.v4.Tool -visitor %GRAMMAR%.g4
javac -classpath %VOX_HOME%\antlr-4.13.2-complete.jar;. %GRAMMAR%*.java IRBuilder.java %GRAMMAR%Main.java

java -classpath %VOX_HOME%\antlr-4.13.2-complete.jar;. %GRAMMAR%Main %INPUT_FILE% > %BASENAME%.ll

clang %BASENAME%.ll -o %BASENAME%.exe

del /F /Q %GRAMMAR%.g4 %GRAMMAR%*.class %GRAMMAR%*.java %GRAMMAR%*.tokens %GRAMMAR%*.interp antlr-*.log IRBuilder.class IRBuilder.java

endlocal
