@echo off
echo Starting ngrok tunnel on port 3000...
echo.
echo Make sure dev server is running: npm run dev
echo.
ngrok http 3000
