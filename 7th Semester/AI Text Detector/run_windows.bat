@echo off
REM One-click launcher for Windows. First run installs dependencies (~2 GB incl. models).
cd /d "%~dp0"
if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install transformers
) else (
  call .venv\Scripts\activate.bat
)
python app.py %*
pause
