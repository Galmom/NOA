# Feature: Modo Descanso + pantallas de configuración

Objective: give NOA a rest mode with an inactivity timer and on-device screens, plus an embedded
HTML configuration page, under the tool-inventory grouping agreed with the user.
Branch: none (firmware/ is a git repo on the user's working tree; no branch created).
Delivery: user builds and flashes. Assistant never flashes.
Test runner: no host harness for this module; verification = compile + user flash.

## Specs

S1. Rest mode has two independent toggles, each one with its own switch ("con tilde cada uno"):
    - automatic: named exactly "automático por inactividad", configured with one numeric field in
      seconds, no presets;
    - manual: triggered by voice or Telegram, no wait involved.
    Turning one off never turns the other off.

S2. Automatic rest fires after the configured seconds without activity, using
    `Application::CanEnterSleepMode()` as the activity predicate and a 1 s tick.

S3. While resting, the wake word stays active. NOA has no physical buttons today (the user will add
    an on/off switch later), so nothing may depend on a button to come back. Savings are limited to
    screen and backlight: `Display::SetPowerSaveMode(true)` plus backlight off, restored on wake.

S4. Back navigation is a stack, one screen at a time, until the face (inicio), where configuration
    closes. On the device the trigger is the spoken word "volver".

S5. The configuration screen is never shown proactively. It is reached only after the user asks
    "¿cuáles son tus funciones?", NOA names them, and the user then enters configuration.

S6. Telegram `/h` (and `/ayuda`) lists every command and includes the configuration entry with the
    link to the HTML page.

S7. Tool inventory is grouped, not copied one-to-one from Troko:
    - `self.timer.*` merges Troko's `timer.set`, `pomodoro.start` and `alarm.set` into one scheduler
      with modes `once`, `cycle` and `at`, because all three are "a due instant plus a callback";
    - `self.reminder.*`, `self.task.*` and `self.habit.*` stay separate because their data shapes
      differ (time-triggered and ephemeral / undated with done flag / per-day recurring);
    - the model needs one disambiguation rule written in the tool descriptions: has a time ->
      reminder, no time and something to do -> task, repeats every day -> habit.

S8. Reminder storage already exists and is the mold for the rest: NVS namespace `remind`, key
    `list`, one string with `due|text` lines, `kMaxReminders = 10`, `kMaxReminderText = 120`
    (`main/telegram_bot.cc`). Persistent lists reuse that pattern instead of inventing a new store.

S9. `config-ui/index.html` is the design source of truth for the device screens: palette
    `#45B8CC` / `#23616B`, 240x240. The final page shows only the configuration; the stacked screen
    guide is a working aid for the user and disappears from the shipped page.

S10. Scope guard: wake word, audio path, existing voice behavior, existing Telegram commands and
     the uncommitted `application.cc` edit must keep working unchanged.

S11. Heavy system actions never become voice tools. `self.reboot`, `self.upgrade_firmware` and
     `self.assets.set_download_url` stay user-only forever: they are triggered only from the HTML
     page, where a person is reading what they are about to do, and reboot needs a two-step
     confirmation.

S12. Actions are optional and each one has its own switch in the HTML page ("si querés cargan sino
     no"):
     - web search: on by default, disappears from the device screen when off;
     - music: off by default, exclusive to this unit because it depends on the YMusic app installed
       on the A03 phone;
     when every action is off, the Acciones entry disappears from Funciones too.

S13. Device screens are display-only. There is no touch and no pointer, so no screen shows a
     stepper, button or toggle: volume, brightness and theme are changed by voice or from the HTML
     page. Dispositivo reads its three values and nothing else.

S14. Music plays on the A03 phone, either through the YMusic app or through YouTube; it is not a
     local audio source on the device.

S15. Build work is 29 tools, not 22: Troko's 34 minus the 11 NOA already has and minus the camera
     (no hardware) leaves 22, plus 7 that Troko never had (3 screen-navigation tools and 4 rest-mode
     tools).

S16. A screen shows four items at a time. Menu-like screens group instead of growing: if a category
     needs a fifth row, it becomes another category with its own screen. Timer is the first case: it
     holds Pomodoro, Alarma, Cron and Cuenta regresiva, and each one opens its own read-only screen.
     Revised by L14: a list screen (hábitos, tareas, recordatorios, Info) is not capped at four; it
     shows four at a time and auto-scrolls slowly when it is longer. There is no pagination and no
     «siguiente» / «anterior» command.

S17. Tasks are configured from the HTML page, because a task is not a reminder: a reminder fires at
     one instant and disappears, while a task lasts the whole day. Configuration:
     - one numeric interval, in seconds, that says how often NOA nudges about the task;
     - a legend under the field: 60 = 1 minuto, 3600 = 1 hora, 43200 = 12 horas, 86400 = 24 horas;
     - the channel, independently: Voz, Telegram or Ambos.
     NOA must also understand the spoken order to add a task ("agregar tal tarea").

S18. Configuration gains an Info screen. It reports every piece of connected hardware, so a missing
     device is visible there (for example a microphone that is not detected). It lists at least:
     pantalla, LCD, micrófono, altavoz, audio, WiFi, PSRAM, flash, CPU and uptime. When the list is
     taller than 240 px it scrolls by itself, slowly, with no input; «volver» is the only exit.
     Info is the single exception to the four-item rule.

S18b. The HTML page has no "Pantalla" block. Capturing the screen or showing an image needs a URL,
     and the user has a PC and a phone for that. `screen.preview_image` is driven by NOA itself: the
     user asks, NOA searches the web, takes the image and shows it. `screen.clear_preview` means
     freeing the memory of the loaded image, not merely hiding it.

S18c. `screen.show_animation` verified from the Troko binary: it takes one fixed name out of
     `240`, `pelota`, `ovejas` (aliases `dormido` / `a dormir`) and `descubre`. The rejected value
     produces the error `name must be 240, pelota, ovejas or descubre`, so it is not free-form. NOA
     adopts the name-set shape, not Troko's scenes: the idle scene NOA wants is a curious one, with
     the eyes searching and following, and it runs when NOA has nothing to do.

S19. Camera: the user owns one but it is not connected yet. Do not build or expose camera behaviour
     until it is wired; the tool stays unregistered as it is today.

S20. Hábitos keeps four tools, not seven. `complete` folds into `toggle` (it marks and unmarks, and
     undo matters more on a screen with no touch), and `close` disappears because «volver» already
     pops the navigation stack. Final set: `habit.add`, `habit.list`, `habit.toggle`, `habit.delete`.
     No icons: with four rows in 240 px an icon takes the space the text needs. Deleting is spoken
     while the list is on screen («borrá leer»), and works on the scrolling list.

S21. Mi día is a calendar day: it starts at 00:00 and ends at 00:00, always. What resets at 00:00 is
     the day itself: the habit checkmarks and the day's counters go back to zero.
     Revised by L17: tasks do NOT die at 00:00. A task that was never completed stays pending and
     shows up again, because it may be something that must be done every day and was forgotten
     yesterday ("si la tarea quedó, la tarea queda"). Deleting is explicit, never automatic.

S22. Configuración holds four entries: Descanso, Dispositivo, Info, Estado. Estado is the glanceable
     health screen: WiFi with signal bars, signal in dBm, free memory, and battery. This board has no
     battery monitor, so battery reads `sin sensor`; that is the point of the screen, it reports what
     exists instead of inventing a number.

S23. Menus carry one small line icon per row (Mi día, Acciones, Configuración, Recordatorios, Tareas,
     Hábitos, Timer, Descanso, Dispositivo, Info, Estado). The icons are drawn, not a font: a 12 px
     inline path with the accent colour. On the device this means LVGL vector or a small image set,
     so the shapes must stay simple — a circle, a chevron, a bell, bars. Info also names the model of
     each part (placa, LCD, bus, audio), not only whether it is present.

S24. Device screens do not draw the hour. NOA's own firmware already shows the time in its status
     bar, so repeating it in every custom screen header is noise. Screens start at the title.

S25. Timer is one tool with four modes, and four read-only screens:
     - `Cuenta regresiva` — `once`: a duration in seconds, up to 24 h, counts down and fires.
     - `Pomodoro` — `cycle`: work and rest alternating, repeating until cancelled.
     - `Alarma` — `at`: a wall-clock hour. Only one alarm exists at a time, matching Troko's
       `alarm.get_status` ("No hay una alarma programada" / one alarm).
     - `Cron` — `every`: fires every N seconds/minutes, and has a repeat count. `0` means forever.
       Revised by L22: the repeat count is a parameter, not a design choice, and it is editable both
       by voice and from the HTML page.



S26. A reminder fires at one instant and disappears; it is not a timer. Verified in the Troko
     description of `timer.set`: it must be used "ONLY when the user explicitly says 'temporizador',
     'timer' or 'cuenta regresiva'", and phrases like "recuérdame en un minuto" must go to
     `reminder.add`. NOA keeps that disambiguation verbatim in the tool description.

## Tool inventory (target)

| Group | Tools | Notes |
|---|---|---|
| System | `self.get_device_status`, `self.get_system_info`, `self.reboot`, `self.upgrade_firmware`, `self.assets.set_download_url` | last four are user-only today |
| Timer | `self.timer.start`, `self.timer.list`, `self.timer.cancel` | modes once / cycle / at |
| Reminder | `self.reminder.add`, `self.reminder.list`, `self.reminder.cancel` | NVS, existing pattern |
| Task | `self.task.add`, `self.task.list`, `self.task.complete` | NVS, no time |
| Habit | `self.habit.add`, `self.habit.list`, `self.habit.toggle`, `self.habit.delete` | NVS, per day, 4 tools per S20 |
| Screen | `self.screen.set_brightness`, `self.screen.set_theme`, `self.screen.get_info`, `self.screen.snapshot`, `self.screen.preview_image`, `self.screen.show_animation`, `self.screen.clear_preview` | |
| Audio | `self.audio_speaker.set_volume`, `self.audio.enter_wake_only_mode` | standby maps to rest mode |
| UI | `self.ui.show_functions`, `self.ui.show_settings`, `self.ui.back` | new, drives the stack |
| Rest | `self.rest_mode.status`, `self.rest_mode.configure`, `self.rest_mode.sleep`, `self.rest_mode.wake` | new |
| Web | `web.search` | Tavily, done |
| Telegram | `self.telegram.send` | |

Out of scope: `self.camera.take_photo` (board has no camera; the tool is not even registered).

## Tasks

| ID | Specs | Route | Status |
|----|-------|-------|--------|
| T1 | S7, S9 | inline | done (inventory written in this document) |
| T2 | S1, S2, S3 | inline | pending (F1: rest_mode module + NVS + tick + wake hook) |
| T3 | S1 | inline | pending (Telegram `/descanso` family) |
| T4 | S4, S5 | inline | pending (F2: screen stack + `self.ui.*` tools) |
| T5 | S6, S9 | inline | pending (F3: embedded HTML + `esp_http_server`) |
| T6 | S7 | inline | pending (timer merge) |
| T7 | S7, S8 | inline | pending (reminder tools over the NVS store) |
| T8 | S7, S8 | inline | pending (task tools) |
| T9 | S7, S8 | inline | pending (habit tools) |

## Log

L1 (user, verbatim): "usamos Volver atras, siempre una pantalla atras, hasta que llega a la cara o
sea, se cerro funciones. entendes?"

L2 (user, verbatim, transcription): "todo lo que tiene Trosco lo vamos a implementar nosotros.
Quizás cambiemos el nombre o capaz agrupemos. Me parece que vos pusiste, por ejemplo, el...
Pomodoro Timer. Prácticamente lo mismo, o sea, podemos hacer una mejor... Podemos agarrar una
mezcla de dos, ponerle timer, Y ahí podemos ponerle Distintas configuraciones"

L3 (decision, S7): timer + pomodoro + alarm are the same mechanism at the core (one due instant and
one callback); merging them means one schedule table and one config surface with modes, instead of
three parallel implementations.

L4 (correction): the assistant claimed "habits y tasks se pisan con reminder". That was wrong:
reminder is time-triggered and ephemeral, task is undated with a done flag, habit is per-day
recurring. No code or data overlap. The real risk is ambiguity for the model, solved with the
description rule in S7, not by merging the groups.

L5 (user, verbatim): "ok ahi te entendi mucho mejor. hace lo del documento y sigamos con el html,
a ver como vamos agregando y como queda"

L6 (decision, S11): reboot, upgrade_firmware and set_download_url are not promoted to voice. They
move to the HTML page as deliberate actions, because a heavy irreversible action must be read
before it is triggered, and a misheard phrase must never be enough.

L7 (decision, S12): web search and music get an independent switch each. Web search defaults on;
music defaults off and stays exclusive to this unit, since playback depends on the YMusic app
(`io.ymusic.android`) installed on the user's A03 phone, at once with `com.lord.pcmonitor` kept in
front.

L8 (design, Funciones split): the six function rows do not fit in 240 px and there is no touch, so
scrolling is not available. Funciones became three group rows (Mi día, Acciones, Configuración) and
each group opens its own screen. Configuración stays at the first level so the path to Descanso is
three backs, not four.
L9 (correction, S18): the Info screen is not just the display size. It must expose all detected
hardware so a bad connection is diagnosable from the device itself, and it must auto-scroll slowly
when the content overflows. The user's own example: "el micrófono no está conectado" should be
visible in Info. Recorded as the only exception to the four-item / no-scroll rule.

L10 (correction, S18b): the "Pantalla" block was removed from the HTML page. Searching an image with
a keyboard on the device is pointless when a PC and a phone exist; the flow is NOA searching and
showing the image itself. `clear_preview` was redefined as freeing the loaded image's memory.
L11 (user, verbatim, habits + animations): "Bien, fantástico. Hábitos. ¿Por qué pusiste el más
turbio? Y después, show animation. No entiendo por qué le pusiste una X. A ver, los huecos reales.
Claro, acá lo que vas a tener que hacer es revisar bien troco. [...] Yo he visto eso. Que Troco, por
ejemplo, decía... Troco, anda a bañarte y... Que aparecen los ojitos con un montón de agua que le cae
[...] Nosotros si es eso Nosotros no lo vamos a usar. Prefiero ponerle una animación, cuando no esté
haciendo nada. Sí, prefiero ponerle una animación de curioso. Que se muevan los ojos buscando algo,
viendo algo, eso estaría bueno ponerle. También movimientos, que se mueva, porque va a tener el
sensor [...] Pero bueno, esa es otra etapa."

L12 (evidence, S18c): searched the binary directly, not the strings dump. Full description found at
the `show_animation` tool: "Muestra una animación de Troko en la pantalla. name: '240' (cuando el
usuario diga 'troko 240' o '240'), 'pelota', 'ovejas' (también 'dormido' o 'a dormir') o
'descubre'." Plus the runtime error string "name must be 240, pelota, ovejas or descubre". The user's
deduction was right: it is a scene player, not a file loader.

L13 (habit inventory, from the binary): `habits.add` (title, time HH:MM, detail, icon
book/exercise/water/heart/study, periodicity daily/weekly/monthly), `habits.list` (full-screen cards
with icon, title, detail, time, checkbox), `habits.complete` (done for today), `habits.toggle`
(done OR undone, i.e. complete plus uncheck), `habits.delete`, `habits.tracking` (arc, percentage,
star, tabs hoy/semana/todos), `habits.close` (dismiss the panel). Limits: 15 habits, title 1-96
characters. So `toggle` already covers `complete`, and `close` is redundant against NOA's «volver».
L14 (user, decisions): "lo del puntero, no. No lo tiene [...] Está bien que por la pantalla quedan
los tilde y todo. Está bien, bueno, pero es por vos. El manejo por vos." and "las dos cosas que se
caen te las tomo" (complete merged into toggle, close dropped). On more than four habits: "lo vas a
tener que hacer como scroll [...] como hicimos ese en Info [...] le decís, 'borrame esto' y lo borra
[...] no tiene sentido siguiente página, anterior, es seguir agregando más órdenes al pedo". On the
day: "Mi día empieza a las 00 horas y termina a las 00 horas del otro día [...] se tiene que borrar
las 00 horas siempre".

L15 (correction, earlier claim of mine): I justified dropping the habit checkbox because "Troko tiene
puntero". The user checked on video: Troko has no pointer either, everything is voice. The merged
toggle and the iconless list still stand, but the reason is the four-row screen, not a pointer Troko
never had.

L16 (open, graphic flourish): Troko draws a progress arc and a remaining-count bar. The user is
neutral ("si querés lo agregamos, si querés no"). NOA keeps text only for now ("3 de 6" on Mi día)
and the bar stays a later addition, not a requirement.

L17 (user, tasks and graphics): "si la tarea quedó, la tarea queda. Que no se borre. Porque capaz es
una tarea que tengo que hacer todos los días y si ayer me olvidé [...] Y mi día es distinto, mi día
ya la palabra [...] te lo está diciendo: hoy. Es hoy, no es durante el mes." Then: "podés agregar
íconos [...] en la parte de info del hardware fijate si ahí puede aparecer el modelo [...] el
micrófono qué modelo, el LCD [...] capaz hacer una pantalla donde tenga el wifi, el ícono de wifi con
la señal y todo, la batería, qué tal cargada está."

L18 (evidence, Troko UI): the binary does contain a web page, but only a WiFi setup one, in two
screens ("Troko - Conectar WiFi" and "Troko - Conectado"), palette lime #b5ff43 and purple #a84cff on
black, with a blinking-eyes logo, scan spinner, signal bars and a lock mark. So Troko does have an
HTML config, but it stops at WiFi; the full configuration page is NOA's. Its device-side graphics are
compiled LVGL, so they cannot be read from the binary — only the web page can.

L19 (hardware reality, from the user): the board today has only the ESP32-S3, the amplifier, the
screen, a voltage regulator feeding the amplifier, the microphone and the amp-to-speaker link. There
is no battery sensor, no battery charger, no batteries yet, no camera, no proximity sensor, no motors
and no motor controller. Those arrive later; the battery charger and batteries are already planned,
and the reading would come from the charger side. Nothing about them gets built now.

L20 (correction, S24): the hour was removed from every screen header. NOA's own firmware already
draws the time, so repeating it in the custom screens was redundant. The user's read of the active
preview was right: it is an example, and the hour does not ship.

L21 (evidence, timer vs reminder): Troko's `timer.set` description says it is a one-time countdown,
duration in seconds up to 24 hours, used "ONLY when the user explicitly says 'temporizador', 'timer'
or 'cuenta regresiva'", and that "recuérdame en un minuto" belongs to `reminder.add`. Recorded as S26
so the model's ambiguity is closed by the tool text itself.

L22 (user, correction of my framing): "¿pero por qué no permitir que se configure eso? como la
alarma. por vos y por html". Right, and it was my mistake: I turned a parameter into an either/or.
Cron takes an interval plus a repeat count, `0` meaning forever, and both the voice and the HTML page
write the same value. The page now has a Timer card with pomodoro work/rest and cron every/repeat.
Recorded as S27: every voice-settable knob is also on the page.

S27. Every knob the voice can set is also settable from the HTML page, and both write the same
     setting. Voice is for the quick ask ("poné un cron cada 30 minutos"); the page is for the exact
     value, because it has a keyboard. The page is a mirror of the device's knobs, never a second
     source of truth: changing one changes the other.

