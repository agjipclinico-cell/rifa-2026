(() => {
    "use strict";

    const config = window.AttendanceConfig;


    function createRequestId() {

        if (
            window.crypto &&
            typeof window.crypto.randomUUID === "function"
        ) {
            return window.crypto.randomUUID();
        }


        if (
            window.crypto &&
            typeof window.crypto.getRandomValues === "function"
        ) {

            const bytes =
                new Uint8Array(16);

            window.crypto.getRandomValues(
                bytes
            );

            return Array
                .from(
                    bytes,
                    value =>
                        value
                            .toString(16)
                            .padStart(2, "0")
                )
                .join("");

        }


        return (
            Date.now().toString(36)
            +
            "-"
            +
            Math.random()
                .toString(36)
                .slice(2)
            +
            Math.random()
                .toString(36)
                .slice(2)
        );

    }


    async function request(
        action,
        parameters = {},
        method = "POST"
    ) {

        const url =
            new URL(
                config.API_URL
            );


        /*
         * El body se crea una sola vez.
         *
         * Esto es especialmente importante para
         * confirmAttendance, porque todos los
         * reintentos conservan exactamente el mismo
         * requestId.
         */
        const body =
            new URLSearchParams({
                action,
                ...parameters
            });


        if (
            method === "GET"
        ) {

            url.search =
                body.toString();

        }


        /*
         * Solo estas operaciones pueden reintentarse
         * automáticamente.
         *
         * confirmAttendance es idempotente gracias
         * al requestId almacenado en Apps Script.
         *
         * validateSession y appInfo son de lectura.
         *
         * logout también es idempotente: eliminar
         * dos veces una sesión produce el mismo
         * estado final.
         *
         * login NO se incluye porque un primer login
         * cuya respuesta se haya perdido podría haber
         * creado ya una sesión.
         */
        const retryableActions =
            new Set([
                "appInfo",
                "validateSession",
                "confirmAttendance",
                "logout"
            ]);


        const maxAttempts =
            retryableActions.has(
                action
            )
                ? 2
                : 1;


        for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt++
        ) {

            const startedAt =
                Date.now();


            const controller =
                new AbortController();


            const timeout =
                setTimeout(
                    () =>
                        controller.abort(),
                    config.REQUEST_TIMEOUT_MS
                );


            const options = {

                method,

                credentials:
                    "omit",

                redirect:
                    "follow",

                cache:
                    "no-store",

                signal:
                    controller.signal

            };


            if (
                method !== "GET"
            ) {

                options.body =
                    body;

            }


            let phase =
                "FETCH";

            let httpStatus =
                null;


            try {

                console.info(
                    "[API envío]",
                    {
                        action,
                        method,
                        attempt
                    }
                );


                const response =
                    await fetch(
                        url,
                        options
                    );


                httpStatus =
                    response.status;


                if (
                    !response.ok
                ) {

                    const error =
                        new Error(
                            `El servidor respondió HTTP ${response.status}.`
                        );


                    error.httpStatus =
                        response.status;


                    throw error;

                }


                phase =
                    "JSON";


                /*
                 * Si Google devuelve accidentalmente
                 * una página HTML en lugar del JSON
                 * de ContentService, esta operación
                 * lanzará SyntaxError.
                 *
                 * Para acciones idempotentes ese
                 * error puede reintentarse.
                 */
                const result =
                    await response.json();


                if (
                    !result ||
                    typeof result.success !==
                        "boolean"
                ) {

                    const error =
                        new Error(
                            "La respuesta no contiene success como booleano."
                        );


                    error.diagnosticCode =
                        "INVALID_RESPONSE";


                    throw error;

                }


                console.info(
                    "[API respuesta]",
                    {
                        action,
                        attempt,
                        milliseconds:
                            Date.now()
                            -
                            startedAt,
                        httpStatus,
                        success:
                            result.success,
                        code:
                            result.code
                    }
                );


                return result;

            }
            catch (error) {

                console.warn(
                    "[API fallo]",
                    {
                        action,
                        attempt,
                        phase,
                        milliseconds:
                            Date.now()
                            -
                            startedAt,
                        httpStatus,
                        errorType:
                            error.name,
                        diagnosticCode:
                            error.diagnosticCode
                    }
                );


                /*
                 * Fallos de transporte que pueden
                 * ocurrir aunque Apps Script haya
                 * ejecutado correctamente la acción.
                 *
                 * 404:
                 * fallo observado en la redirección
                 * de ContentService.
                 *
                 * SyntaxError:
                 * Google devolvió HTML u otro contenido
                 * en lugar del JSON esperado.
                 *
                 * TypeError:
                 * normalmente un fallo de fetch/red.
                 *
                 * AbortError:
                 * timeout local.
                 *
                 * INVALID_RESPONSE:
                 * hubo respuesta, pero no cumple
                 * el contrato esperado.
                 */
                const retryableFailure =
                    error.httpStatus === 404
                    ||
                    error.name === "SyntaxError"
                    ||
                    error.name === "TypeError"
                    ||
                    error.name === "AbortError"
                    ||
                    error.diagnosticCode ===
                        "INVALID_RESPONSE";


                if (
                    retryableActions.has(
                        action
                    )
                    &&
                    retryableFailure
                    &&
                    attempt < maxAttempts
                ) {

                    let reason;


                    if (
                        error.httpStatus
                    ) {

                        reason =
                            `HTTP_${error.httpStatus}`;

                    }
                    else {

                        reason =
                            error.diagnosticCode
                            ||
                            error.name;

                    }


                    console.info(
                        "[API reintento]",
                        {
                            action,
                            reason,
                            nextAttempt:
                                attempt + 1
                        }
                    );


                    continue;

                }


                let message;


                if (
                    error.name ===
                        "AbortError"
                ) {

                    message =
                        "Se agotó el tiempo de espera de la respuesta.";

                }
                else if (
                    error.httpStatus
                ) {

                    message =
                        `No se pudo recuperar la respuesta del servidor (HTTP ${error.httpStatus}).`;

                }
                else if (
                    error.name ===
                        "SyntaxError"
                ) {

                    message =
                        "El servidor respondió con un formato inesperado.";

                }
                else if (
                    error.diagnosticCode ===
                        "INVALID_RESPONSE"
                ) {

                    message =
                        error.message;

                }
                else {

                    message =
                        "El navegador no pudo recibir la respuesta. Revisa la conexión y vuelve a intentarlo.";

                }


                const failure =
                    new Error(
                        message
                    );


                failure.httpStatus =
                    httpStatus;


                failure.diagnosticCode =
                    error.diagnosticCode
                    ||
                    error.name;


                throw failure;

            }
            finally {

                clearTimeout(
                    timeout
                );

            }

        }

    }


    function getToken() {

        return (
            sessionStorage
                .getItem(
                    "attendanceToken"
                )
            ||
            ""
        );

    }


    function saveSession(
        result
    ) {

        sessionStorage.setItem(
            "attendanceToken",
            result.token
        );


        if (
            Number.isFinite(
                result.expiresAt
            )
        ) {

            sessionStorage.setItem(
                "attendanceExpiresAt",
                String(
                    result.expiresAt
                )
            );

        }
        else {

            sessionStorage.removeItem(
                "attendanceExpiresAt"
            );

        }

    }


    function clearSession() {

        sessionStorage.removeItem(
            "attendanceToken"
        );

        sessionStorage.removeItem(
            "attendanceExpiresAt"
        );

    }


    function goToLogin(
        expired = false
    ) {

        clearSession();


        window.location.replace(
            expired
                ? "index.html?expired=1"
                : "index.html"
        );

    }


    async function loadAppInfo() {

        document
            .querySelectorAll(
                "[data-app-title]"
            )
            .forEach(
                element => {

                    element.textContent =
                        config.TITLE;

                }
            );


        try {

            const result =
                await request(
                    "appInfo",
                    {},
                    "GET"
                );


            if (
                result.success &&
                typeof result.title ===
                    "string"
            ) {

                document
                    .querySelectorAll(
                        "[data-app-title]"
                    )
                    .forEach(
                        element => {

                            element.textContent =
                                result.title;

                        }
                    );

            }

        }
        catch {

            /*
             * appInfo no es crítico.
             * Si falla, se conserva el título
             * definido localmente en config.js.
             */

        }

    }


    window.AttendanceAuth =
        Object.freeze({

            request,

            createRequestId,

            getToken,

            saveSession,

            clearSession,

            goToLogin,

            loadAppInfo,


            login:
                (
                    username,
                    password
                ) =>
                    request(
                        "login",
                        {
                            username,
                            password
                        }
                    ),


            validateSession:
                token =>
                    request(
                        "validateSession",
                        {
                            token
                        }
                    ),


            /*
             * requestId normalmente se genera aquí.
             *
             * scanner.js puede proporcionarlo
             * explícitamente cuando necesita
             * reintentar exactamente la misma
             * operación.
             */
            confirmAttendance:
                (
                    token,
                    folio,
                    method,
                    requestId =
                        createRequestId()
                ) =>
                    request(
                        "confirmAttendance",
                        {
                            token,
                            folio,
                            method,
                            requestId
                        }
                    ),


            logout:
                token =>
                    request(
                        "logout",
                        {
                            token
                        }
                    )

        });


    async function initLogin() {

        const form =
            document.getElementById(
                "loginForm"
            );


        const button =
            document.getElementById(
                "loginButton"
            );


        const message =
            document.getElementById(
                "loginMessage"
            );


        const password =
            document.getElementById(
                "password"
            );


        let busy =
            false;


        function setBusy(
            value
        ) {

            busy =
                value;


            for (
                const element
                of form.elements
            ) {

                element.disabled =
                    value;

            }


            button.textContent =
                value
                    ? "Verificando…"
                    : "Iniciar sesión";


            form.setAttribute(
                "aria-busy",
                String(value)
            );

        }


        function showMessage(
            text,
            error = false
        ) {

            message.textContent =
                text;


            message.classList.toggle(
                "error",
                error
            );

        }


        form.addEventListener(
            "submit",
            async event => {

                event.preventDefault();


                if (busy)
                    return;


                const username =
                    document
                        .getElementById(
                            "username"
                        )
                        .value
                        .trim();


                if (
                    !username ||
                    !password.value
                ) {

                    showMessage(
                        "Ingresa tu usuario y contraseña.",
                        true
                    );

                    return;

                }


                const passwordValue =
                    password.value;


                setBusy(
                    true
                );


                showMessage(
                    ""
                );


                try {

                    const result =
                        await window
                            .AttendanceAuth
                            .login(
                                username,
                                passwordValue
                            );


                    if (
                        !result.success ||
                        typeof result.token !==
                            "string" ||
                        !result.token ||
                        result.role !==
                            "ATTENDANCE"
                    ) {

                        showMessage(
                            result.message
                            ||
                            "No se pudo iniciar sesión. Revisa tus credenciales.",
                            true
                        );

                        return;

                    }


                    try {

                        saveSession(
                            result
                        );

                    }
                    catch {

                        showMessage(
                            "El navegador no permite guardar la sesión. Habilita el almacenamiento del sitio.",
                            true
                        );

                        return;

                    }


                    window.location.replace(
                        "scanner.html"
                    );

                }
                catch (error) {

                    showMessage(
                        error.message,
                        true
                    );

                }
                finally {

                    password.value =
                        "";


                    setBusy(
                        false
                    );

                }

            }
        );


        void loadAppInfo();


        if (
            new URLSearchParams(
                window.location.search
            ).has(
                "expired"
            )
        ) {

            showMessage(
                "La sesión expiró. Inicia sesión nuevamente.",
                true
            );

        }


        try {

            const token =
                getToken();


            if (!token)
                return;


            setBusy(
                true
            );


            const result =
                await window
                    .AttendanceAuth
                    .validateSession(
                        token
                    );


            if (
                result.success &&
                result.valid &&
                result.role ===
                    "ATTENDANCE"
            ) {

                saveSession({

                    ...result,

                    token

                });


                window.location.replace(
                    "scanner.html"
                );

            }
            else if (
                result.valid === false
                ||
                result.sessionExpired
                ||
                result.code ===
                    "UNAUTHORIZED"
            ) {

                clearSession();

            }
            else {

                showMessage(
                    result.message
                    ||
                    "No se pudo verificar la sesión. Puedes iniciar sesión nuevamente.",
                    true
                );

            }

        }
        catch (error) {

            showMessage(
                error.message,
                true
            );

        }
        finally {

            setBusy(
                false
            );

        }

    }


    if (
        document.body.dataset.page ===
            "login"
    ) {

        void initLogin();

    }

})();
