@echo off
REM Start the optional ESPN private-league proxy (Windows). Needs Python 3.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 espn_proxy.py & goto :eof)
where python >nul 2>nul && (python espn_proxy.py & goto :eof)
echo Python 3 is required: https://www.python.org/downloads/  (tick "Add python.exe to PATH")
pause
