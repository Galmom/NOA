$ErrorActionPreference = 'Stop'

$base = 'C:\Users\lord_\Downloads\NOA\firmware\main'
$ccPath = Join-Path $base 'application.cc'
$hPath  = Join-Path $base 'application.h'

if (!(Test-Path -LiteralPath $ccPath) -or !(Test-Path -LiteralPath $hPath)) {
    throw 'No se encontraron application.cc y application.h en la ruta esperada.'
}

$cc = Get-Content -LiteralPath $ccPath -Raw
$h  = Get-Content -LiteralPath $hPath -Raw

$oldEmotion = @"
            if (cJSON_IsString(emotion)) {
                Schedule([display, emotion_str = std::string(emotion->valuestring)]() {
                    display->SetEmotion(emotion_str.c_str());
                });
            }
"@

$newEmotion = @"
            if (cJSON_IsString(emotion)) {
                Schedule([this, emotion_str = std::string(emotion->valuestring)]() {
                    pending_tts_emotions_.push_back(emotion_str);
                    ESP_LOGI(TAG, "[emotion] queued: %s (pending=%u)",
                             emotion_str.c_str(),
                             static_cast<unsigned>(pending_tts_emotions_.size()));
                });
            }
"@

$oldSentence = @"
                    Schedule([display, message = std::string(text->valuestring),
                              glyphs = std::move(glyphs), bpp]() {
                        display->AddTextGlyphs(glyphs, bpp);
                        display->SetChatMessage("assistant", message.c_str());
                    });
"@

$newSentence = @"
                    Schedule([this, display, message = std::string(text->valuestring),
                              glyphs = std::move(glyphs), bpp]() {
                        if (!pending_tts_emotions_.empty()) {
                            std::string emotion = std::move(pending_tts_emotions_.front());
                            pending_tts_emotions_.pop_front();
                            ESP_LOGI(TAG, "[emotion] applying: %s (remaining=%u)",
                                     emotion.c_str(),
                                     static_cast<unsigned>(pending_tts_emotions_.size()));
                            display->SetEmotion(emotion.c_str());
                        } else {
                            ESP_LOGW(TAG, "[emotion] no pending emotion for sentence");
                        }

                        display->AddTextGlyphs(glyphs, bpp);
                        display->SetChatMessage("assistant", message.c_str());
                    });
"@

$oldStop = @"
                Schedule([this]() {
                    if (GetDeviceState() == kDeviceStateSpeaking) {
                        if (listening_mode_ == kListeningModeManualStop) {
                            SetDeviceState(kDeviceStateIdle);
                        } else {
                            SetDeviceState(kDeviceStateListening);
                        }
                    }
                });
"@

$newStop = @"
                Schedule([this]() {
                    const size_t discarded = pending_tts_emotions_.size();
                    pending_tts_emotions_.clear();
                    if (discarded > 0) {
                        ESP_LOGW(TAG, "[emotion] discarded %u pending emotions at TTS stop",
                                 static_cast<unsigned>(discarded));
                    }

                    if (GetDeviceState() == kDeviceStateSpeaking) {
                        if (listening_mode_ == kListeningModeManualStop) {
                            SetDeviceState(kDeviceStateIdle);
                        } else {
                            SetDeviceState(kDeviceStateListening);
                        }
                    }
                });
"@

$oldHeader = @"
    std::deque<std::function<void()>> main_tasks_;
"@

$newHeader = @"
    std::deque<std::function<void()>> main_tasks_;
    std::deque<std::string> pending_tts_emotions_;
"@

function Assert-ExactlyOnce {
    param(
        [string]$Content,
        [string]$Pattern,
        [string]$File
    )

    $first = $Content.IndexOf($Pattern, [StringComparison]::Ordinal)
    if ($first -lt 0) {
        throw "No se encontró el bloque esperado en $File. No se modificó ningún archivo."
    }

    $second = $Content.IndexOf(
        $Pattern,
        $first + $Pattern.Length,
        [StringComparison]::Ordinal
    )

    if ($second -ge 0) {
        throw "El bloque aparece más de una vez en $File. No se modificó ningún archivo."
    }
}

# Validar todos los bloques antes de crear backups o escribir archivos.
Assert-ExactlyOnce $cc $oldEmotion 'application.cc'
Assert-ExactlyOnce $cc $oldSentence 'application.cc'
Assert-ExactlyOnce $cc $oldStop 'application.cc'
Assert-ExactlyOnce $h $oldHeader 'application.h'

# Preparar el resultado en memoria.
$newCc = $cc.Replace($oldEmotion, $newEmotion)
$newCc = $newCc.Replace($oldSentence, $newSentence)
$newCc = $newCc.Replace($oldStop, $newStop)
$newH  = $h.Replace($oldHeader, $newHeader)

if ($newCc -eq $cc -or $newH -eq $h) {
    throw 'La modificación no produjo los cambios esperados. No se escribió ningún archivo.'
}

if (!$newCc.Contains('pending_tts_emotions_.push_back(emotion_str)') -or
    !$newCc.Contains('pending_tts_emotions_.pop_front()') -or
    !$newCc.Contains('pending_tts_emotions_.clear()') -or
    !$newH.Contains('std::deque<std::string> pending_tts_emotions_')) {
    throw 'Falló la validación interna de los cambios. No se escribió ningún archivo.'
}

# Crear backups antes de modificar.
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item -LiteralPath $ccPath -Destination "$ccPath.$stamp.bak"
Copy-Item -LiteralPath $hPath  -Destination "$hPath.$stamp.bak"

# Escribir únicamente los dos archivos autorizados.
Set-Content -LiteralPath $ccPath -Value $newCc -Encoding UTF8
Set-Content -LiteralPath $hPath  -Value $newH -Encoding UTF8

# Comprobar que los cambios quedaron escritos.
$checkCc = Get-Content -LiteralPath $ccPath -Raw
$checkH  = Get-Content -LiteralPath $hPath -Raw

if (!$checkCc.Contains('pending_tts_emotions_.push_back(emotion_str)') -or
    !$checkCc.Contains('pending_tts_emotions_.pop_front()') -or
    !$checkCc.Contains('pending_tts_emotions_.clear()') -or
    !$checkH.Contains('std::deque<std::string> pending_tts_emotions_')) {
    throw 'La verificación posterior a la escritura falló. Los backups quedaron disponibles.'
}

Write-Host ''
Write-Host 'CORRECCION APLICADA' -ForegroundColor Green
Write-Host 'Archivos modificados: application.cc y application.h'
Write-Host 'Backups creados con sufijo: .bak'
Write-Host 'Compilacion: no ejecutada'
Write-Host 'Flasheo: no ejecutado'
Write-Host ''
Write-Host 'Comportamiento: cada emocion se aplica al comenzar su frase TTS.'
