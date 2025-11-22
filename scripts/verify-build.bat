@echo off
echo Running TypeScript type check...
call npm run typecheck
if errorlevel 1 (
    echo TypeCheck failed!
    exit /b 1
)
echo.
echo TypeCheck passed!
echo.
