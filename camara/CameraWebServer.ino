#include <Arduino.h>
#include "esp_camera.h"
#include <WiFi.h>
#include "esp_wifi.h"

// ===========================
// Seleccionar modelo en board_config.h
// ===========================
#include "board_config.h"

// ===========================
// Credenciales WiFi
// ===========================
const char *ssid = "Lennon";
const char *password = "OasisJuan10";
//const char *ssid = "Telecentro-f810";
//const char *password = "20papa02cebolla";

void startCameraServer();
void setupLedFlash();
extern int led_duty;  // defined in app_httpd.cpp

void setup() {
  // [LOG] Setup start
  Serial.println("[LOG] Setup start");
  Serial.begin(115200);
  Serial.println();
  Serial.println("--- NOA Camera AI-Thinker OV3660 Boot ---");
  // [LOG] PSRAM check
  Serial.println("[LOG] Checking PSRAM");
  if (psramFound()) {
    Serial.printf("PSRAM detectada OK: %d bytes libres\n", ESP.getFreePsram());
  } else {
    Serial.println("AVISO: PSRAM NO detectada (revisar Tools -> PSRAM: Enabled)");
  }
  // [LOG] Sensor power up
  Serial.println("[LOG] Powering up sensor (PWDN low)");
  pinMode(PWDN_GPIO_NUM, OUTPUT);
  digitalWrite(PWDN_GPIO_NUM, LOW);
  delay(20);
  // Pull-ups on the SCCB bus for reliable sensor register access
  pinMode(SIOD_GPIO_NUM, INPUT_PULLUP);
  pinMode(SIOC_GPIO_NUM, INPUT_PULLUP);
  delay(50);

  // [LOG] Configuring camera
  Serial.println("[LOG] Configuring camera");
  camera_config_t config = {};

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;

  config.xclk_freq_hz = 8000000;
  config.pixel_format = PIXFORMAT_RGB565;
  config.frame_size   = FRAMESIZE_QVGA;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_count     = 1;
  config.fb_location  = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  if (!psramFound()) {
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.fb_count    = 1;
  }
  // [LOG] Camera init start
  Serial.println("[LOG] Initializing camera");
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.print("[ERROR] Camera init failed: 0x");
    Serial.println(err, HEX);
    Serial.printf("Error al inicializar cámara: 0x%x\n", err);
    return;
  }
  Serial.println("Cámara inicializada correctamente.");
  Serial.println("[LOG] Camera init complete");

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    if (s->set_vflip)    s->set_vflip(s, 1);
    if (s->set_hmirror) s->set_hmirror(s, 0);
    // [LOG] Sensor configuration applied
  // [LOG] Sensor configuration applied
  Serial.println("[LOG] Sensor configuration applied");
  // Force a known framesize & quality (helps with low‑mem configs)
  if (s) {
    // optional colour tweaks (increase saturation/contrast if needed)
    if (s->set_saturation) s->set_saturation(s, 2);
    if (s->set_contrast)   s->set_contrast(s, 2);
  }

  // Force a known framesize & quality (helps with low‑mem configs)
  if (s) {
    if (s->set_quality)     s->set_quality(s, 10);
    if (s->set_whitebal)    s->set_whitebal(s, 1);
    if (s->set_awb_gain)    s->set_awb_gain(s, 1);
  }

  } else {
    Serial.println("[ERROR] sensor not found");
  }

#if defined(LED_GPIO_NUM)
  setupLedFlash();
  led_duty = 0;    // flash desactivado durante el diagnostico de captura
#endif

  // [LOG] Connecting to WiFi
  Serial.println("[LOG] Connecting to WiFi");
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);
  Serial.print("Conectando a WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("WiFi Conectado!");
  Serial.print("[LOG] IP address: ");
  Serial.println(WiFi.localIP());
  WiFi.setAutoReconnect(true);
  esp_wifi_set_ps(WIFI_PS_NONE);

  // WiFi event handler disabled to avoid NULL callback crashes
  // WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) { ... });
  Serial.println("[LOG] WiFi event handler disabled");

  // [LOG] Stabilization delay before server
  Serial.println("[LOG] Stabilization delay start");
  delay(2000);
  Serial.println("[LOG] Stabilization delay done");

  startCameraServer();

  Serial.print("Camara Lista! URL de streaming: http://");
  Serial.print(WiFi.localIP());
  Serial.println(":81/stream");
  Serial.print("Captura simple: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/capture");
  Serial.println("[LOG] startCameraServer completed");
}

void loop() {
  // Manejo de reconexión WiFi simple sin reiniciar el microcontrolador
  static unsigned long last_check = 0;
  const unsigned long now = millis();

  if (now - last_check >= 10000) {
    last_check = now;
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi caído, reintentando...");
      WiFi.reconnect();
    } else {
      Serial.println("[LOG] WiFi still connected");
    }
  }

  delay(200);
}
