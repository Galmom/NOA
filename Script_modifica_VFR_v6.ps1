$path = "C:\Users\lord_\Downloads\NOA\firmware\main\display\lvgl_noa_eyes.cc"

# =============================================
# CONFIGURACION VHS - MODIFICAR SOLO ESTA SECCION
# =============================================

$velocidad    = 95
$flicker      = 4
$repeticiones = 100

# Color RGB hexadecimal, sin # ni 0x.
$colorBanda = "23616B"

# Intensidad general: 0 = invisible, 100 = intensidad maxima.
$tonalidad = 100

# Degradado entre las seis franjas.
$degrade = $true
$degradeDesde = 25
$degradeHasta = 50

# Si $degrade = $false, las seis franjas usan $tonalidad uniformemente.

# =============================================

if (-not (Test-Path -LiteralPath $path)) {
    throw "No se encontro el archivo: $path"
}

foreach ($item in @(
    @{ Name = 'velocidad'; Value = $velocidad; Min = 0; Max = 500 },
    @{ Name = 'flicker'; Value = $flicker; Min = 0; Max = 100 },
    @{ Name = 'repeticiones'; Value = $repeticiones; Min = 0; Max = 1000 },
    @{ Name = 'tonalidad'; Value = $tonalidad; Min = 0; Max = 100 },
    @{ Name = 'degradeDesde'; Value = $degradeDesde; Min = 0; Max = 100 },
    @{ Name = 'degradeHasta'; Value = $degradeHasta; Min = 0; Max = 100 }
)) {
    if ($item.Value -lt $item.Min -or $item.Value -gt $item.Max) {
        throw "$($item.Name) debe estar entre $($item.Min) y $($item.Max)."
    }
}

if ($colorBanda -notmatch '^[0-9A-Fa-f]{6}$') {
    throw 'colorBanda debe tener exactamente 6 digitos hexadecimales, por ejemplo 23616B.'
}

$content = [System.IO.File]::ReadAllText($path)

# Verificar los parametros que el script administra.
$parameterPatterns = @(
    'BAND_SPEED_NUMERATOR\s*=\s*\d+;',
    'BAND_VFLICKER_MAX_AMPLITUDE\s*=\s*\d+;',
    'self->band_flash_accumulator_\s*\+=\s*\d+;',
    'BAND_COLOR\s*=\s*0x[0-9A-Fa-f]{6}\s*;',
    'BAND_OPACITY\[BAND_STRIPE_COUNT\]\s*=\s*\{[^}]*\};'
)

foreach ($pattern in $parameterPatterns) {
    if ([regex]::Matches($content, $pattern).Count -ne 1) {
        throw "No se encontro exactamente una definicion para: $pattern. No se modifico el archivo."
    }
}

# Reconoce tanto el temporizador original (opacidad fija 35) como
# el temporizador ya corregido (opacidad BAND_OPACITY[i]).
$timerOldPattern = '(?s)const lv_opa_t opacity\s*=\s*self->band_visible_\s*\?\s*35\s*:\s*LV_OPA_TRANSP;\s*for\s*\(int i = 0; i < BAND_STRIPE_COUNT; \+\+i\)\s*\{\s*lv_obj_set_style_bg_opa\(self->left_stripes_\[i\],\s*opacity,\s*0\);\s*lv_obj_set_style_bg_opa\(self->right_stripes_\[i\],\s*opacity,\s*0\);\s*lv_obj_set_style_bg_opa\(self->left_stripes_2_\[i\],\s*opacity,\s*0\);\s*lv_obj_set_style_bg_opa\(self->right_stripes_2_\[i\],\s*opacity,\s*0\);\s*\}'
$timerNewPattern = '(?s)for\s*\(int i = 0; i < BAND_STRIPE_COUNT; \+\+i\)\s*\{\s*const lv_opa_t opacity\s*=\s*self->band_visible_\s*\?\s*BAND_OPACITY\[i\]\s*:\s*LV_OPA_TRANSP;\s*lv_obj_set_style_bg_opa\(self->left_stripes_\[i\],\s*opacity,\s*0\);\s*lv_obj_set_style_bg_opa\(self->right_stripes_\[i\],\s*opacity,\s*0\);\s*lv_obj_set_style_bg_opa\(self->left_stripes_2_\[i\],\s*opacity,\s*0\);\s*lv_obj_set_style_bg_opa\(self->right_stripes_2_\[i\],\s*opacity,\s*0\);\s*\}'

$oldTimerCount = [regex]::Matches($content, $timerOldPattern).Count
$newTimerCount = [regex]::Matches($content, $timerNewPattern).Count

if (($oldTimerCount + $newTimerCount) -ne 1) {
    throw "No se encontro exactamente un bloque de temporizador VHS reconocido (original o corregido). No se modifico el archivo."
}

# LVGL lv_opa_t va de 0 a 255. Se calcula cada franja por separado.
$opacidades = @()
for ($i = 0; $i -lt 6; $i++) {
    if ($degrade) {
        $porcentaje = $degradeDesde + (($degradeHasta - $degradeDesde) * $i / 5.0)
    }
    else {
        $porcentaje = 100
    }

    $porcentaje = $porcentaje * $tonalidad / 100.0
    $lvglOpacity = [int][Math]::Round($porcentaje * 255.0 / 100.0)
    $lvglOpacity = [Math]::Max(0, [Math]::Min(255, $lvglOpacity))
    $opacidades += $lvglOpacity
}

$opacityText = $opacidades -join ', '

# Construir todos los cambios en memoria antes de escribir.
$updated = $content
$updated = [regex]::Replace($updated, 'BAND_SPEED_NUMERATOR\s*=\s*\d+;', "BAND_SPEED_NUMERATOR = $velocidad;")
$updated = [regex]::Replace($updated, 'BAND_VFLICKER_MAX_AMPLITUDE\s*=\s*\d+;', "BAND_VFLICKER_MAX_AMPLITUDE = $flicker;")
$updated = [regex]::Replace($updated, 'self->band_flash_accumulator_\s*\+=\s*\d+;', "self->band_flash_accumulator_ += $repeticiones;")
$updated = [regex]::Replace($updated, 'BAND_COLOR\s*=\s*0x[0-9A-Fa-f]{6}\s*;', "BAND_COLOR = 0x$($colorBanda.ToUpper());")
$updated = [regex]::Replace($updated, 'BAND_OPACITY\[BAND_STRIPE_COUNT\]\s*=\s*\{[^}]*\};', "BAND_OPACITY[BAND_STRIPE_COUNT] = {$opacityText};")

$timerReplacement = @'
for (int i = 0; i < BAND_STRIPE_COUNT; ++i) {
            const lv_opa_t opacity = self->band_visible_ ? BAND_OPACITY[i] : LV_OPA_TRANSP;
            lv_obj_set_style_bg_opa(self->left_stripes_[i], opacity, 0);
            lv_obj_set_style_bg_opa(self->right_stripes_[i], opacity, 0);
            lv_obj_set_style_bg_opa(self->left_stripes_2_[i], opacity, 0);
            lv_obj_set_style_bg_opa(self->right_stripes_2_[i], opacity, 0);
        }
'@

if ($oldTimerCount -eq 1) {
    $updated = [regex]::Replace($updated, $timerOldPattern, $timerReplacement.TrimEnd(), 1)
}
# Si ya estaba corregido, se conserva el bloque sin volver a transformarlo.

# Validar el resultado en memoria antes de tocar el archivo.
$expectedOpacity = [regex]::Escape($opacityText)
if ($updated -notmatch "BAND_SPEED_NUMERATOR\s*=\s*$velocidad;" -or
    $updated -notmatch "BAND_VFLICKER_MAX_AMPLITUDE\s*=\s*$flicker;" -or
    $updated -notmatch "band_flash_accumulator_\s*\+=\s*$repeticiones;" -or
    $updated -notmatch "BAND_COLOR\s*=\s*0x$($colorBanda.ToUpper());" -or
    $updated -notmatch "BAND_OPACITY\[BAND_STRIPE_COUNT\]\s*=\s*\{$expectedOpacity\};" -or
    [regex]::Matches($updated, $timerNewPattern).Count -ne 1) {
    throw 'La validacion previa fallo. El archivo original no fue modificado.'
}

# Backup y escritura atomica mediante archivo temporal.
$backup = "$path.$(Get-Date -Format 'yyyyMMdd_HHmmss').bak"
$tempPath = "$path.tmp"

Copy-Item -LiteralPath $path -Destination $backup -ErrorAction Stop

try {
    [System.IO.File]::WriteAllText($tempPath, $updated, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $path -Force

    $verify = [System.IO.File]::ReadAllText($path)
    if ($verify -ne $updated) {
        throw 'La lectura posterior no coincide con el contenido validado.'
    }

    Write-Host "`n========== CONFIGURACION VHS =========="
    Write-Host "Velocidad:       $velocidad"
    Write-Host "V-Flicker:       +/- $flicker px"
    Write-Host "Repeticiones:    $repeticiones"
    Write-Host "Color RGB:       #$($colorBanda.ToUpper())"
    Write-Host "Tonalidad:       $tonalidad%"
    Write-Host "Degradado:       $degrade"
    Write-Host "Opacidades LVGL: {$opacityText}"
    Write-Host "`nModificacion correcta."
    Write-Host "Backup: $backup"
}
catch {
    if (Test-Path -LiteralPath $backup) {
        Copy-Item -LiteralPath $backup -Destination $path -Force
    }
    if (Test-Path -LiteralPath $tempPath) {
        Remove-Item -LiteralPath $tempPath -Force
    }
    throw "Error: se restauro el backup. $_"
}
