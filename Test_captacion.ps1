
$port = "COM9"
$baud = 115200

$log = Join-Path ([Environment]::GetFolderPath("Desktop")) (
    "NOA-mic-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt"
)

$sp = [System.IO.Ports.SerialPort]::new(
    $port,
    $baud,
    [System.IO.Ports.Parity]::None,
    8,
    [System.IO.Ports.StopBits]::One
)

$sp.Handshake = [System.IO.Ports.Handshake]::None
$sp.DtrEnable = $false
$sp.RtsEnable = $false
$sp.ReadTimeout = 1000
$sp.Encoding = [System.Text.Encoding]::UTF8

$writer = [System.IO.StreamWriter]::new(
    $log,
    $false,
    [System.Text.UTF8Encoding]::new($false)
)
$writer.AutoFlush = $true

$lastState = "desconocido"

try {
    $sp.Open()

    Clear-Host
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "          NOA - TEST DE MICROFONO" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Puerto: $port"
    Write-Host "Archivo: $log"
    Write-Host ""
    Write-Host "Esperando estados de NOA..." -ForegroundColor Yellow
    Write-Host "Para terminar: Ctrl+C"
    Write-Host ""

    while ($true) {
        try {
            $line = $sp.ReadLine()
            $timestamp = Get-Date -Format "HH:mm:ss.fff"
            $entry = "[$timestamp] $line"

            # Guardar absolutamente todas las líneas
            $writer.WriteLine($entry)

            # Mostrar el log original
            Write-Host $entry

            # Detectar cambios de estado
            if ($line -match 'StateMachine:\s+State:\s*(\w+)\s*->\s*(\w+)') {
                $previousState = $Matches[1]
                $newState = $Matches[2]
                $lastState = $newState

                Write-Host ""

                switch ($newState) {
                    "idle" {
                        Write-Host "########################################" -ForegroundColor Green
                        Write-Host "  NOA ESTA EN IDLE - PODES PROBAR" -ForegroundColor Green
                        Write-Host "  Hora: $timestamp" -ForegroundColor Green
                        Write-Host "  Deci NOA una sola vez desde tu distancia." -ForegroundColor Green
                        Write-Host "########################################" -ForegroundColor Green
                    }

                    "connecting" {
                        Write-Host ">>> NOA DETECTO LA WAKE WORD" -ForegroundColor Yellow
                    }

                    "listening" {
                        Write-Host ">>> NOA ESTA ESCUCHANDO" -ForegroundColor Cyan
                    }

                    default {
                        Write-Host ">>> ESTADO: $previousState -> $newState" -ForegroundColor Gray
                    }
                }

                Write-Host ""
            }
        }
        catch [System.TimeoutException] {
            # Seguir esperando datos
        }
    }
}
finally {
    if ($sp.IsOpen) {
        $sp.Close()
    }

    $writer.Close()

    Write-Host ""
    Write-Host "Captura guardada en:" -ForegroundColor Cyan
    Write-Host $log -ForegroundColor Green
}
