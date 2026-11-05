// Camera WebSocket & Vision Link
//
// Manages the connection to the ESP32-CAM vision module.
// Allows requesting snapshots on-demand when the user asks "what do you see?".

export function createCameraLink({ timeoutMs = 8000 } = {}) {
  let activeSocket = null;
  let pendingSnap = null;

  function attach(socket) {
    if (activeSocket && activeSocket !== socket) {
      try {
        activeSocket.close();
      } catch {}
    }
    activeSocket = socket;

    socket.on('close', () => {
      if (activeSocket === socket) {
        activeSocket = null;
        if (pendingSnap) {
          pendingSnap.reject(new Error('camera disconnected'));
          pendingSnap = null;
        }
      }
    });
  }

  function handleMessage(message, isBinary, raw) {
    if (isBinary || (Buffer.isBuffer(raw) && raw.length > 2 && raw[0] === 0xFF && raw[1] === 0xD8)) {
      // JPEG frame received
      if (pendingSnap) {
        clearTimeout(pendingSnap.timer);
        pendingSnap.resolve(raw);
        pendingSnap = null;
        return true;
      }
    }

    if (message?.type === 'snap-ready') {
      return true;
    }

    return false;
  }

  function captureSnapshot() {
    return new Promise((resolve, reject) => {
      if (!activeSocket || activeSocket.readyState !== 1) {
        return reject(new Error('camera offline'));
      }

      if (pendingSnap) {
        clearTimeout(pendingSnap.timer);
        pendingSnap.reject(new Error('aborted by new snapshot request'));
      }

      const timer = setTimeout(() => {
        if (pendingSnap) {
          pendingSnap = null;
          reject(new Error('camera snapshot timed out'));
        }
      }, timeoutMs);

      pendingSnap = { resolve, reject, timer };
      activeSocket.send(JSON.stringify({ type: 'snap' }));
    });
  }

  return {
    attach,
    handleMessage,
    captureSnapshot,
    get connected() {
      return Boolean(activeSocket && activeSocket.readyState === 1);
    },
  };
}

