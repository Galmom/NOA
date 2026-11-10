# Activate ESP-IDF v6.1 for building NOA.
# The system `python` is the Python Install Manager's 3.15, which has no wheels for
# ESP-IDF's requirements, so the vendored 3.12 interpreter is used explicitly.
# Usage:  . C:\Users\lord_\Downloads\NOA\activate-idf.ps1

$py312   = "C:\Users\lord_\AppData\Local\Python\pythoncore-3.12-64\python.exe"
$idfPath = "C:\Users\lord_\esp-idf-v6.1"

$env:IDF_PATH = $idfPath
$activateScript = (& $py312 "$idfPath\tools\activate.py" --export) | Select-Object -Last 1
if (-not (Test-Path $activateScript)) {
  throw "activate.py did not produce an export script (got: $activateScript)"
}
. $activateScript
