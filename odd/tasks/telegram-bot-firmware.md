# Feature: Troko-style Telegram bot inside NOA firmware

Objective: port Troko's Telegram bot (input channel + reminders) into NOA's firmware.
Branch: none (firmware/ is a git repo on the user's working tree; no branch created).
Delivery: user builds and flashes.
Test runner: no host test harness for this module; verification = compile + user flash.

## Specs

S1. The firmware must poll Telegram `getUpdates` itself and accept orders from the configured chat only.
    Source of truth (Guia-Troko.html §8): "Para saber tu chat_id: compila primero solo con el token,
    escríbele a tu bot y Troko te responderá 'Tu chat_id es <id>.'", "Agrega ambos al .env y vuelve a
    compilar. Solo tu chat podrá controlar a Troko."

S2. `/recordar 10m Sacar la ropa` — "Recordatorio en 10 minutos (también 2h o 18:30)".

S3. `/recordatorios` — "Lista los pendientes".

S4. `/cancelar 3` — "Borra el recordatorio número 3".

S5. `/aviso Hola` — "Muestra el mensaje en la pantalla de Troko".

S6. `/estado` — "Hora, estado y recordatorios pendientes".

S7. `/ayuda` — "Lista de comandos".

S8. Scope guard: only the bot is added. No wake word, screen, audio, sdkconfig, or other existing
    behavior is changed. Secrets never enter tracked files.

## Tasks

| ID | Specs | Route | Status |
|----|-------|-------|--------|
| T1 | S1-S8 | inline | done (module compiles; full link blocked by an unrelated dirty file) |

## Log

L1 (user, verbatim): "metelo en el firmware solo eso tocas. no tocas mas nada. quedo claro?"

L2 (implementation): added `main/telegram_bot.{h,cc}`, `main/telegram_config.h` (gitignored, holds
token + chat_id), one source line and `esp_http_client`/`espressif__cjson` in `main/CMakeLists.txt`
PRIV_REQUIRES, one include and one `TelegramBot::GetInstance().Start();` in `main/main.cc`, and
`main/telegram_config.h` in `.gitignore`.

L3 (decisions inside the bot module):
- Polling task starts after `Application::Initialize()` and waits for a valid clock before its first
  HTTPS call, because TLS certificate validation and reminders both need a real date. Fallback SNTP
  (`pool.ntp.org`) covers the case where the OTA response carries no `server_time`.
- Reminders persist in NVS namespace `remind`, key `list`, as `due|text` lines, sorted by due time.
  Capped at 10 entries and 120 characters per text so a full store can never fail `nvs_set_str`.
- Firing sends a Telegram message and a screen notification through `Application::Schedule`.
- `/recordar` accepts `Ns`, `Nm`, `Nh`, `Nd` and `HH:MM` (already passed today rolls to tomorrow).
- No `self.reminder.*` MCP tools are registered: that would be a second, unrequested surface.

L4 (verification): `ninja -C build esp-idf/main/CMakeFiles/__idf_main.dir/telegram_bot.cc.obj` and the
same target for `main.cc.obj` both build clean with the repository `-Werror`. A full `idf.py build`
does not link: `main/display/lvgl_noa_eyes.cc` (untracked, modified by the user after the last
successful build at 12:40) includes `"lvgl/src/draw/lv_draw_triangle.h"`, and the managed component
directory is `lvgl__lvgl`, so that include does not resolve. Not touched: outside the requested scope.
