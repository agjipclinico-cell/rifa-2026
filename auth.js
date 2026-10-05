(() => {
    "use strict";

    const config = window.AttendanceConfig;

    async function request(action, parameters = {}, method = "POST") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS);
        const url = new URL(config.API_URL);
        const body = new URLSearchParams({ action, ...parameters });
        const options = {
            method,
            credentials: "omit",
            redirect: "follow",
            signal: controller.signal
        };

        if (method === "GET") {
            url.search = body.toString();
        } else {
            options.body = body;
        }

        try {
            const startedAt = Date.now();
            console.info("[API envío]", {
                action,
                method
            });
            const response = await fetch(url, options);
            if (!response.ok) throw new Error("HTTP_ERROR");
             const result = await response.json();
            console.info("[API respuesta]", {
                action,
                milliseconds: Date.now() - startedAt,
                httpStatus: response.status,
                success: result?.success,
                code: result?.code,
                message: result?.message
            });
            if (!result || typeof result.success !== "boolean") {
                throw new Error("INVALID_RESPONSE");
            }
            return result;
        } catch (error) {
            console.warn("[API fallo]", {
            action,
            milliseconds: Date.now() - startedAt,
            errorType: error.name,
            message: error.message
            });
            if (error.name === "AbortError") {
                throw new Error("La solicitud tardó demasiado. No se pudo obtener la respuesta.");
            }
            throw new Error("No se pudo obtener una respuesta válida del servidor. Revisa la conexión y la configuración de la API.");
        } finally {
            clearTimeout(timeout);
        }
    }

    function getToken() {
        return sessionStorage.getItem("attendanceToken") || "";
    }

    function saveSession(result) {
        sessionStorage.setItem("attendanceToken", result.token);
        if (Number.isFinite(result.expiresAt)) {
            sessionStorage.setItem("attendanceExpiresAt", String(result.expiresAt));
        } else {
            sessionStorage.removeItem("attendanceExpiresAt");
        }
    }

    function clearSession() {
        sessionStorage.removeItem("attendanceToken");
        sessionStorage.removeItem("attendanceExpiresAt");
    }

    function goToLogin(expired = false) {
        clearSession();
        window.location.replace(expired ? "index.html?expired=1" : "index.html");
    }

    async function loadAppInfo() {
        document.querySelectorAll("[data-app-title]").forEach(element => {
            element.textContent = config.TITLE;
        });
        try {
            const result = await request("appInfo", {}, "GET");
            if (result.success && typeof result.title === "string") {
                document.querySelectorAll("[data-app-title]").forEach(element => {
                    element.textContent = result.title;
                });
            }
        } catch {
        }
    }

    window.AttendanceAuth = Object.freeze({
        request,
        getToken,
        saveSession,
        clearSession,
        goToLogin,
        loadAppInfo,
        login: (username, password) => request("login", { username, password }),
        validateSession: token => request("validateSession", { token }),
        confirmAttendance: (token, folio, method) => request("confirmAttendance", { token, folio, method }),
        logout: token => request("logout", { token })
    });

    async function initLogin() {
        const form = document.getElementById("loginForm");
        const button = document.getElementById("loginButton");
        const message = document.getElementById("loginMessage");
        const password = document.getElementById("password");
        let busy = false;

        function setBusy(value) {
            busy = value;
            for (const element of form.elements) element.disabled = value;
            button.textContent = value ? "Verificando…" : "Iniciar sesión";
            form.setAttribute("aria-busy", String(value));
        }

        function showMessage(text, error = false) {
            message.textContent = text;
            message.classList.toggle("error", error);
        }

        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (busy) return;
            const username = document.getElementById("username").value.trim();
            if (!username || !password.value) {
                showMessage("Ingresa tu usuario y contraseña.", true);
                return;
            }
            const passwordValue = password.value;
            setBusy(true);
            showMessage("");
            try {
                const result = await window.AttendanceAuth.login(username, passwordValue);
                if (!result.success || typeof result.token !== "string" || !result.token || result.role !== "ATTENDANCE") {
                    showMessage(result.message || "No se pudo iniciar sesión. Revisa tus credenciales.", true);
                    return;
                }
                try {
                    saveSession(result);
                } catch {
                    showMessage("El navegador no permite guardar la sesión. Habilita el almacenamiento del sitio.", true);
                    return;
                }
                window.location.replace("scanner.html");
            } catch (error) {
                showMessage(error.message, true);
            } finally {
                password.value = "";
                setBusy(false);
            }
        });

        void loadAppInfo();
        if (new URLSearchParams(window.location.search).has("expired")) {
            showMessage("La sesión expiró. Inicia sesión nuevamente.", true);
        }

        try {
            const token = getToken();
            if (!token) return;
            setBusy(true);
            const result = await window.AttendanceAuth.validateSession(token);
            if (result.success && result.valid && result.role === "ATTENDANCE") {
                saveSession({ ...result, token });
                window.location.replace("scanner.html");
            } else if (result.valid === false || result.sessionExpired || result.code === "UNAUTHORIZED") {
                clearSession();
            } else {
                showMessage(result.message || "No se pudo verificar la sesión. Puedes iniciar sesión nuevamente.", true);
            }
        } catch (error) {
            showMessage(error.message, true);
        } finally {
            setBusy(false);
        }
    }

    if (document.body.dataset.page === "login") void initLogin();
})();
