@echo off
chcp 65001 >nul
cd /d "C:\Users\Alonzo\Documents\programacion\horarios"

echo ===========================================================
echo   GENERADOR DE HORARIOS - Motor OPTIMO (OR-Tools CP-SAT)
echo   Garantiza 354/354 o te dice que dato corregir.
echo ===========================================================
echo.
echo [1/2] Leyendo Carga Academica y Disponibilidades...
call node ortools\exportar_datos.js
if errorlevel 1 goto error
echo.
echo [2/2] Resolviendo con CP-SAT (puede tardar ~20 segundos)...
echo.
wsl bash -lc "cd '/mnt/c/Users/Alonzo/Documents/programacion/horarios/ortools' && python3 cp_horarios.py"
if errorlevel 1 goto error
echo.
echo Abriendo el horario generado en Excel...
start "" "ortools\Horario_CP_ORTools.xlsx"
echo.
echo ===========================================================
echo   Listo. Si arriba dice "100%% GARANTIZADO", el horario
echo   esta completo. Si dice "NO se alcanzo el 100%%", revisa
echo   el dato que se indica y vuelve a ejecutar.
echo ===========================================================
echo.
pause
exit /b 0

:error
echo.
echo *** Ocurrio un error. Revisa los mensajes de arriba. ***
echo     (Requisitos: Node.js, y WSL con ortools/openpyxl instalados.)
echo.
pause
exit /b 1
