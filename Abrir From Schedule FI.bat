@echo off
chcp 65001 >nul
cd /d "C:\Users\Alonzo\Documents\programacion\horarios"
echo ===========================================================
echo   FROM SCHEDULE FI  -  abriendo la interfaz...
echo   (El motor OPTIMO usa CP-SAT por debajo: 354/354 + patron)
echo ===========================================================
echo.
echo Arrancando el servidor local en una ventana aparte.
echo NO cierres esa ventana mientras uses la pagina.
echo.
REM Servidor en su propia ventana (muestra el progreso del solve). Cerrarla = apagar la app.
start "From Schedule FI - servidor (no cerrar)" cmd /k "node server.js"
REM Dar 2 s a que el servidor levante y abrir la interfaz en el navegador.
timeout /t 2 >nul
start "" http://localhost:3131
echo Listo. Si no abrio el navegador, entra a:  http://localhost:3131
echo.
echo Esta ventana se puede cerrar.
timeout /t 4 >nul
exit /b 0
