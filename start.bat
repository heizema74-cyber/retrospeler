@echo off
rem Start een klein webservertje in deze map en opent de speler in de browser.
cd /d "%~dp0"
echo Retrospeler draait op http://127.0.0.1:8888/
echo Sluit dit venster om te stoppen.
start "" http://127.0.0.1:8888/
python -m http.server 8888 --bind 127.0.0.1
