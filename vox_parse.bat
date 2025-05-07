@echo off
setlocal

set GRAMMAR=Vox
set INPUT_FILE=%1

if "%INPUT_FILE%"=="" (
    echo Usage: vox_parse File.vox
    exit /b 1
)

copy %VOX_HOME%\%GRAMMAR%.g4;
copy %VOX_HOME%\%GRAMMAR%Main.java;
copy %VOX_HOME%\IRBuilder.java;

java -classpath %VOX_HOME%\antlr-4.13.2-complete.jar;. org.antlr.v4.Tool -visitor %GRAMMAR%.g4
javac -classpath %VOX_HOME%\antlr-4.13.2-complete.jar;. %GRAMMAR%*.java IRBuilder.java VoxMain.java
java -classpath %VOX_HOME%\antlr-4.13.2-complete.jar;. VoxMain %INPUT_FILE%

del /F /Q %GRAMMAR%.g4 %GRAMMAR%*.class %GRAMMAR%*.java %GRAMMAR%*.tokens %GRAMMAR%*.interp antlr-*.log IRBuilder.class IRBuilder.java

endlocal