@echo off
echo ========================================
echo Git Commit and Push Script
echo ========================================
echo.

echo Checking git status...
git status
echo.

echo Adding all modified files...
git add .gitignore package.json test-debug-toc.js scripts/cleanup-project.bat scripts/CLEANUP_README.md
echo.

echo Committing changes...
git commit -m "Resolve merge conflicts and add cleanup automation

- Resolved .gitignore duplicates
- Resolved package.json conflicts (kept HEAD versions for version 2.5.0, electron 39.2.3, electron-builder 26.3.0, eslint 9.39.1, docxmlater ^5.3.3)
- Enhanced test-debug-toc.js with retry logic and file locking detection
- Added cleanup-project.bat for automated project cleanup
- Added CLEANUP_README.md documentation
- Added test:toc and clean npm scripts"
echo.

echo Pushing to GitHub...
git push origin HEAD
echo.

echo ========================================
echo Git operations completed!
echo ========================================
pause
