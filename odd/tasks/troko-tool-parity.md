# Feature: Troko tool parity + Telegram tool dispatch

Objective: give NOA firmware every MCP tool Troko exposes, and let Telegram call those tools
through the same dispatch the AI uses.
Branch: none (firmware/ is a git repo on the user's working tree; no branch created).
Delivery: user builds and flashes.
Test runner: no host harness for this module; verification = compile + user flash.

## Specs

S1. Tool parity. NOA must expose the same tool inventory found in
    `C:\Users\lord_\Downloads\troko-firmware-es\troko-wk-esp32s3-dev-es.bin`:
    self.get_device_status, self.get_system_info, self.reboot, self.upgrade_firmware,
    self.assets.set_download_url, self.audio_speaker.set_volume, self.audio.enter_wake_only_mode,
    self.camera.take_photo, self.screen.set_brightness, self.screen.set_theme,
    self.screen.get_info, self.screen.snapshot, self.screen.preview_image,
    self.screen.show_animation, self.screen.clear_preview,
    self.habits.add, self.habits.list, self.habits.complete, self.habits.toggle,
    self.habits.delete, self.habits.tracking, self.habits.close,
    self.tasks.add, self.tasks.list, self.tasks.complete,
    self.reminder.add, self.reminder.list, self.reminder.cancel,
    self.alarm.set, self.alarm.get_status, self.alarm.cancel, self.timer.set,
    self.pomodoro.start, self.telegram.send, web.search.
    Revised by L10: parity is about capability, not about one tool per Troko name. The grouped
    inventory (timer/alarm/pomodoro merged, reminder/task/habit kept apart) lives in
    `odd/tasks/config-descanso-ui.md`, S7.

S2. Verification source of truth for tool names and descriptions is the Troko binary itself,
    not the public website. Confirmed absent from that binary: any Telegram bot
    (`getUpdates`, `sendMessage`, `api.telegram.org`) and any music tool.

S3. User directive, verbatim: "los MCP que tiene TROKO en su interior, NOA tambien tiene que
    tenerlos. Y a futuro nos manejamos con esa logica."

S4. Telegram must be able to invoke the device tools with the same handlers the AI uses:
    `/tool <name> {json}` plus short aliases for the common ones. The reply is the tool's own
    result text, never an invented one.

S4b. Every command the bot supports must appear in `/ayuda`, with its short alias and a one-line
     description, and each command must accept that alias: /h /r /rec /c /a /e /d /v /b /t /x.
     `/tool` with no arguments lists the firmware's tools; `/recordatorios` states how many are
     pending.

S5. Tool calls from the Telegram task must execute on the main application thread, because the
    handlers touch LVGL, the codec and the board. The bot task may wait, but it never runs a
    handler itself.

S6. Out of scope, by user decision: PC desktop cleanup and PC status ("si NOA no puede reconocer
    lo que estoy haciendo en la pc... de que me sirve que me arregle el escritorio... mi
    escritorio es sin iconos").

S7. Scope guard: existing voice behavior, wake word, audio path and the current Telegram
    commands must keep working unchanged.

## Tasks

| ID | Specs | Route | Status |
|----|-------|-------|--------|
| T1 | S4, S5, S7 | inline | done (code written; needs user build + flash) |
| T2 | S1 (web.search) | inline | done (code written; needs user build + flash) |
| T3 | S1 (reminder/alarm/timer + screen) | pending | pending |
| T4 | S1 (habits + screens) | pending | pending |
| T5 | S1 (tasks) | pending | pending |
| T6 | S1 (pomodoro, screen animations) | pending | pending |
| T7 | S1 (audio.enter_wake_only_mode) | pending | pending |

## Log

L1 (user, verbatim): "los MCP que tiene TROKO en su interior, NOA tambien tiene que tenerlos. Y a
futuro nos manejamos con esa logica. Lo de la pc, si la verdad que me chupa un huevo eso...porque
si NOA no puede reconocer lo que estoy haciendo en la pc... de que me sirve que me arregle el
escritorio... a demas mi escritorio es sin iconos... no tiene sentido..."

L2 (analysis): the Troko binary carries 34 tool names. NOA already has 12 of them. The gap is
habits, tasks, reminders, alarms, timer, pomodoro, screen animations, wake-only mode, web.search
and telegram.send in firmware.

L3 (decision, T1): `McpServer::ParseMessage` is public and `DoToolCall` already schedules the
handler on the main thread through `Application::Schedule`, so the bot only has to send a
JSON-RPC `tools/call` and collect the reply. No HTTP, no Termux, no PC.

L4 (decision, T1): the bot waits for the reply with a 10 s bounded poll of a shared_ptr-held
completion flag. A stack capture would dangle if the scheduled handler ran after the timeout.

L5 (known limitation): `/tool` and the aliases are explicit commands, not natural language. Real
free-text control needs the AI, and the device protocol has no text input to the model.

L6 (T2 implementation): `web.search` lives in `main/tavily_search.cc` + `main/tavily_search.h` and
is registered from `McpServer::AddCommonTools()` through `RegisterTavilySearchTool(*this)`. The
key is in `main/tavily_config.h` (gitignored, mirrors `telegram_config.h`); the tool reports
"not configured" when the macro is empty. Request mirrors the proven Python implementation:
POST `https://api.tavily.com/search` with `Content-Type: application/json` and
`Authorization: Bearer <key>`, body `{query, max_results, include_answer:true}`. Output is
`Answer: <600 chars>` plus up to 3 `- title (url): content <220 chars>` lines, whole text cut at
1800 chars. Concurrent calls are refused with "A Tavily search is already in progress". The
handler lowers its task priority with `TaskPriorityReset(1)` like the camera tool, because the
20 s HTTPS round trip blocks the calling thread. Both new objects compiled clean
(`tavily_search.cc.obj`, `mcp_server.cc.obj`); full build + flash pending on the user.

L7 (user, verbatim): "Acordate que en /ayuda salgan todos los comandos que vas creando y entre
/tool (Buscador web), /recordatorios (cantidad), etc... tambien podes abreviarlos /ayuda podria
ser /h que se yo. acomoda eso primero antes de seguir"

L8 (decision, S4b): `/ayuda` is generated from one `kCommands[]` table, so a new command is
documented by adding its row instead of editing a string. Aliases are resolved by
`CanonicalCommand()` before dispatch, and `kCommands[]` carries the same alias next to each usage,
so help and dispatch cannot drift. `/tool` with no arguments asks the firmware for `tools/list`
(paginated through `nextCursor`) and prints every tool name, which keeps the list correct as T3-T7
add tools. `/recordatorios` now reports the pending count in its header. `telegram_bot.cc.obj`
compiled clean after the change.

L9 (incident, black screen): screen went black with the firmware alive (`/estado` answered). The
backlight reported 80 % live, so the panel was lit and the black was a render/UI state, not a
power-off. `/aviso PRUEBA` rendered, proving the LVGL task and flush were healthy. Root candidate:
`LcdDisplay::SetEmotion` hides the NOA eyes (lcd_display.cc:1226) whenever
`LvglNoaEyes::SetExpression` returns false, and SetExpression only recognised 8 names while the
server can send the wider set (crying, loving, embarrassed, confident, silly, shocked, relaxed,
confused, kissing). An unknown name left the eyes hidden over the dark background until the next
state change called `SetEmotion("neutral")`, which is why the face reappeared on its own.
Fixes: `ResolveExpression()` maps the wide set onto the geometric shapes and defaults to neutral,
so SetExpression can no longer fail; `SetEmotion` now logs every requested emotion
(`LcdDisplay: SetEmotion request: <name>`) for the next occurrence; `BlinkTimerCb` clamps its
catch-up window to 250 ms so a stalled LVGL task cannot replay every missed blink in one callback
and cascade; `self.screen.set_brightness` is now 1-100 and clamps, `/brillo` rejects 0, because
brightness 0 leaves the panel black and persists in NVS. All four objects compiled clean
(`lvgl_noa_eyes.cc.obj`, `lcd_display.cc.obj`, `mcp_server.cc.obj`, `telegram_bot.cc.obj`);
full build + flash pending on the user.

L10 (requirement change, user verbatim, transcription): "todo lo que tiene Trosco lo vamos a
implementar nosotros. Quizás cambiemos el nombre o capaz agrupemos. Me parece que vos pusiste, por
ejemplo, el... Pomodoro Timer. Prácticamente lo mismo... Podemos agarrar una mezcla de dos, ponerle
timer, Y ahí podemos ponerle Distintas configuraciones"
Effect: S1 keeps the capability set but no longer mandates one tool per Troko name. The grouped
inventory and the merge rules (timer/alarm/pomodoro in one scheduler; reminder/task/habit separate
with disambiguation descriptions) are specified in `odd/tasks/config-descanso-ui.md`, S7.
