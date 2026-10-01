(() => {
    "use strict";

    const auth = window.AttendanceAuth;
    const byId = id => document.getElementById(id);
    const sessionPanel = byId("sessionPanel");
    const capturePanel = byId("capturePanel");
    const resultPanel = byId("resultPanel");
    const form = byId("attendanceForm");
    const folioInput = byId("folio");
    const confirmButton = byId("confirmButton");
    const cameraButton = byId("cameraButton");
    const cameraMessage = byId("cameraMessage");
    const logoutButton = byId("logoutButton");
    const nextButton = byId("nextButton");
    let scanner = null;
    let cameraQueue = Promise.resolve();
    let token = "";
    let ready = false;
    let busy = false;
    let leaving = false;
    let scanLocked = false;
    let scannedFolio = "";
    let method = "MANUAL";
    let retryFolio = "";
    let retryMethod = "MANUAL";

    function queueCamera(operation) {
        cameraQueue = cameraQueue.then(operation).catch(() => {
            cameraMessage.textContent = "No se pudo controlar la cámara. Puedes ingresar el folio manualmente.";
        });
        return cameraQueue;
    }

    function cameraState() {
        return scanner ? scanner.getState() : 1;
    }

    function pauseCamera() {
        if (cameraState() === Html5QrcodeScannerState.SCANNING) scanner.pause(true);
        cameraButton.textContent = "Leer otro QR";
    }

    async function stopCamera() {
        if (!scanner) return;
        const state = cameraState();
        if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
            try {
                await scanner.stop();
            } catch {
                document.querySelectorAll("#reader video").forEach(video => {
                    video.srcObject?.getTracks().forEach(track => track.stop());
                });
                scanner = null;
                byId("reader").replaceChildren();
            }
        }
        cameraButton.textContent = "Activar cámara";
    }

    function onQrRead(text) {
        if (!ready || busy || leaving || scanLocked || capturePanel.hidden) return;
        const folio = text.trim();
        if (!folio) return;
        scanLocked = true;
        scannedFolio = folio;
        method = "QR";
        folioInput.value = folio;
        pauseCamera();
        cameraMessage.textContent = "QR capturado. Revisa el folio y confirma la asistencia.";
        byId("folioHelp").textContent = "Capturado por QR. Puedes modificarlo antes de confirmar.";
    }

    async function startCamera() {
        if (!ready || busy || leaving || capturePanel.hidden || document.hidden) return;
        if (!window.Html5Qrcode) {
            cameraMessage.textContent = "El lector QR no está disponible. Puedes ingresar el folio manualmente.";
            return;
        }
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            cameraMessage.textContent = "La cámara necesita HTTPS y un navegador compatible. Puedes ingresar el folio manualmente.";
            return;
        }
        cameraButton.disabled = true;
        scanLocked = false;
        cameraMessage.textContent = "Activando cámara…";
        try {
            if (!scanner) {
                scanner = new Html5Qrcode("reader", {
                    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                    verbose: false
                });
            }
            if (cameraState() === Html5QrcodeScannerState.PAUSED) {
                scanner.resume();
            } else if (cameraState() !== Html5QrcodeScannerState.SCANNING) {
                await scanner.start(
                    { facingMode: "environment" },
                    { fps: 10, qrbox: (width, height) => {
                        const size = Math.floor(Math.min(width, height) * 0.75);
                        return { width: size, height: size };
                    } },
                    onQrRead,
                    () => {}
                );
            }
            if (busy || leaving || capturePanel.hidden || document.hidden) {
                await stopCamera();
                return;
            }
            if (scanLocked) {
                pauseCamera();
            } else {
                cameraButton.textContent = "Detener cámara";
                cameraMessage.textContent = "Coloca el QR dentro del recuadro.";
            }
        } catch {
            cameraMessage.textContent = "No se pudo activar la cámara. Revisa el permiso del navegador o ingresa el folio manualmente.";
            cameraButton.textContent = "Activar cámara";
        } finally {
            cameraButton.disabled = busy || leaving;
        }
    }

    function showCapture() {
        resultPanel.hidden = true;
        capturePanel.hidden = false;
        folioInput.value = "";
        scannedFolio = "";
        method = "MANUAL";
        scanLocked = false;
        retryFolio = "";
        byId("folioHelp").textContent = "Escanea el QR o ingresa el folio manualmente.";
        byId("globalMessage").textContent = "";
        void queueCamera(startCamera);
    }

    function showResult(result, submittedFolio, uncertain = false) {
        capturePanel.hidden = true;
        resultPanel.hidden = false;
        void queueCamera(stopCamera);
        const confirmed = result.success && result.code === "CONFIRMED";
        const already = result.success && result.code === "ALREADY_CONFIRMED";
        const titles = {
            INVALID_FOLIO: "Folio no válido",
            ATTENDANCE_CLOSED: "Registro de asistencia cerrado"
        };
        resultPanel.className = `card-body result ${confirmed ? "success" : already || uncertain ? "warning" : "error"}`;
        byId("resultBadge").textContent = confirmed ? "Entrada registrada" : already ? "Registro previo" : uncertain ? "Resultado pendiente" : "Registro no confirmado";
        byId("resultTitle").textContent = confirmed ? "Confirmación exitosa" : already ? "Colaborador ya confirmado" : uncertain ? "No se pudo verificar el resultado" : titles[result.code] || "No se pudo confirmar";
        byId("resultMessage").textContent = uncertain
            ? `${result.message || "El servidor no devolvió un resultado reconocido."} La asistencia pudo haberse registrado. Vuelve a consultar el mismo folio: si ya se registró, se mostrará la hora original.`
            : result.message || "El servidor no devolvió un resultado reconocido.";
        const participant = result.participant;
        byId("participantDetails").hidden = !(confirmed || already) || !participant;
        byId("participantName").textContent = participant?.name || "";
        byId("participantFolio").textContent = participant?.folio || submittedFolio;
        byId("participantTime").textContent = participant?.entryTime || "No disponible";
        byId("participantMethod").textContent = participant?.method === "QR" ? "QR" : participant?.method === "MANUAL" ? "Manual" : "No disponible";
        retryFolio = uncertain ? submittedFolio : "";
        nextButton.textContent = uncertain ? "Revisar el mismo folio" : "Escanear siguiente";
        byId("resultTitle").focus();
    }

    function setBusy(value) {
        busy = value;
        folioInput.disabled = value;
        confirmButton.disabled = value;
        cameraButton.disabled = value;
        logoutButton.disabled = value;
        confirmButton.textContent = value ? "Confirmando…" : "Confirmar asistencia";
        form.setAttribute("aria-busy", String(value));
    }

    async function verifySession() {
        byId("sessionRetry").hidden = true;
        byId("sessionMessage").textContent = "Verificando sesión…";
        try {
            token = auth.getToken();
            if (!token) {
                auth.goToLogin();
                return;
            }
            const result = await auth.validateSession(token);
            if (result.valid === false || result.sessionExpired || result.code === "UNAUTHORIZED") {
                auth.goToLogin(true);
                return;
            }
            if (!result.success || !result.valid || result.role !== "ATTENDANCE") {
                throw new Error(result.message || "No se pudo validar la sesión.");
            }
            auth.saveSession({ ...result, token });
            if (leaving) return;
            ready = true;
            sessionPanel.hidden = true;
            showCapture();
        } catch (error) {
            byId("sessionMessage").textContent = error.message;
            byId("sessionRetry").hidden = false;
        }
    }

    folioInput.addEventListener("input", () => {
        method = "MANUAL";
        scannedFolio = "";
        scanLocked = true;
        if (window.Html5Qrcode && scanner) pauseCamera();
        byId("folioHelp").textContent = "Ingreso manual. Revisa el folio antes de confirmar.";
        cameraMessage.textContent = "Lectura en pausa mientras editas el folio.";
    });

    cameraButton.addEventListener("click", () => {
        void queueCamera(async () => {
            if (!ready || busy || leaving || capturePanel.hidden) return;
            if (window.Html5Qrcode && scanner && cameraState() === Html5QrcodeScannerState.SCANNING) {
                await stopCamera();
                cameraMessage.textContent = "Cámara detenida. Puedes ingresar el folio manualmente.";
            } else {
                await startCamera();
            }
        });
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!ready || busy || leaving) return;
        const folio = folioInput.value.trim();
        if (!folio) {
            folioInput.setCustomValidity("Ingresa o escanea un folio.");
            folioInput.reportValidity();
            folioInput.setCustomValidity("");
            return;
        }
        const submittedMethod = method === "QR" && folio === scannedFolio ? "QR" : "MANUAL";
        retryMethod = submittedMethod;
        scanLocked = true;
        setBusy(true);
        cameraMessage.textContent = "Confirmando asistencia…";
        void queueCamera(stopCamera);
        try {
            const result = await auth.confirmAttendance(token, folio, submittedMethod);
            if (result.sessionExpired || result.code === "UNAUTHORIZED") {
                leaving = true;
                await queueCamera(stopCamera);
                auth.goToLogin(true);
                return;
            }
            const recognized = ["CONFIRMED", "ALREADY_CONFIRMED", "INVALID_FOLIO", "ATTENDANCE_CLOSED"].includes(result.code);
            showResult(result, folio, !recognized);
        } catch (error) {
            showResult({ message: error.message }, folio, true);
        } finally {
            if (!leaving) setBusy(false);
        }
    });

    nextButton.addEventListener("click", () => {
        if (busy || leaving) return;
        if (retryFolio) {
            resultPanel.hidden = true;
            capturePanel.hidden = false;
            folioInput.value = retryFolio;
            method = retryMethod;
            scannedFolio = method === "QR" ? retryFolio : "";
            scanLocked = true;
            byId("folioHelp").textContent = "Consulta el mismo folio para verificar si quedó registrado.";
            cameraMessage.textContent = "Folio conservado. Pulsa Confirmar asistencia para consultar su estado.";
            confirmButton.focus();
        } else {
            showCapture();
        }
    });

    logoutButton.addEventListener("click", async () => {
        if (busy || leaving) return;
        leaving = true;
        logoutButton.disabled = true;
        nextButton.disabled = true;
        setBusy(true);
        logoutButton.textContent = "Cerrando…";
        void queueCamera(stopCamera);
        try {
            const result = await auth.logout(token || auth.getToken());
            if (!result.success && !result.sessionExpired && result.code !== "UNAUTHORIZED") {
                throw new Error(result.message || "No se pudo cerrar la sesión en el servidor.");
            }
            auth.goToLogin();
        } catch (error) {
            leaving = false;
            setBusy(false);
            logoutButton.textContent = "Cerrar sesión";
            nextButton.disabled = false;
            byId("globalMessage").textContent = `${error.message} Vuelve a intentar cerrar sesión.`;
        }
    });

    byId("sessionRetry").addEventListener("click", () => void verifySession());
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            void queueCamera(stopCamera);
        } else if (ready && !busy && !leaving && !capturePanel.hidden && !scanLocked) {
            void queueCamera(startCamera);
        }
    });
    window.addEventListener("pagehide", () => {
        document.querySelectorAll("#reader video").forEach(video => {
            video.srcObject?.getTracks().forEach(track => track.stop());
        });
    });
    window.addEventListener("pageshow", event => {
        if (event.persisted) window.location.reload();
    });

    void auth.loadAppInfo();
    void verifySession();
})();
