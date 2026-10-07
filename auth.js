(() => {
    "use strict";


    const config =
        window.AttendanceConfig;


    const DEFAULT_REQUEST_TIMEOUT_MS =
        Number.isFinite(
            Number(
                config.REQUEST_TIMEOUT_MS
            )
        )
        &&
        Number(
            config.REQUEST_TIMEOUT_MS
        ) > 0
            ?
            Number(
                config.REQUEST_TIMEOUT_MS
            )
            :
            30000;


    /*
     * Para login no queremos esperar 30 segundos
     * antes de poder recuperarnos de un problema
     * de ContentService.
     *
     * Cada solicitud de login puede esperar
     * hasta 10 segundos.
     */
    const LOGIN_REQUEST_TIMEOUT_MS =
        Number.isFinite(
            Number(
                config.LOGIN_REQUEST_TIMEOUT_MS
            )
        )
        &&
        Number(
            config.LOGIN_REQUEST_TIMEOUT_MS
        ) > 0
            ?
            Number(
                config.LOGIN_REQUEST_TIMEOUT_MS
            )
            :
            10000;


    /*
     * Después de este tiempo mostramos un mensaje
     * neutro al usuario aunque la solicitud siga
     * procesándose normalmente.
     */
    const SLOW_REQUEST_NOTICE_MS =
        4000;



    function isRecoverableRequestFailure(
        error
    ) {

        if (!error) {

            return false;

        }


        /*
         * 404:
         * fallo que ya observamos en la cadena
         * de redirección de ContentService.
         */
        if (
            error.httpStatus ===
            404
        ) {

            return true;

        }


        /*
         * Errores temporales del servidor.
         */
        if (
            Number.isFinite(
                error.httpStatus
            )
            &&
            error.httpStatus >= 500
            &&
            error.httpStatus <= 599
        ) {

            return true;

        }


        /*
         * Timeout local.
         */
        if (
            error.name ===
            "AbortError"
        ) {

            return true;

        }


        /*
         * Fallo de fetch/red/CORS/redirección.
         */
        if (
            error.name ===
            "TypeError"
        ) {

            return true;

        }


        /*
         * Google devolvió HTML u otro contenido
         * en lugar del JSON esperado.
         */
        if (
            error.name ===
            "SyntaxError"
        ) {

            return true;

        }


        if (
            error.diagnosticCode ===
            "INVALID_RESPONSE"
        ) {

            return true;

        }


        return false;

    }



    function createPublicRequestError(
        error,
        httpStatus
    ) {

        let message;


        if (
            error?.name ===
            "AbortError"
        ) {

            message =
                "El servidor tardó demasiado en completar la operación.";

        }
        else if (
            httpStatus
        ) {

            message =
                "No se pudo completar la conexión con el servidor.";

        }
        else if (
            error?.name ===
            "SyntaxError"
            ||
            error?.diagnosticCode ===
                "INVALID_RESPONSE"
        ) {

            message =
                "El servidor devolvió un resultado inesperado.";

        }
        else {

            message =
                "No se pudo completar la conexión con el servidor.";

        }


        const failure =
            new Error(
                message
            );


        failure.httpStatus =
            httpStatus;


        failure.diagnosticCode =
            error?.diagnosticCode
            ||
            error?.name
            ||
            "REQUEST_FAILED";


        failure.transportFailure =
            true;


        return failure;

    }



    async function request(
        action,
        parameters = {},
        method = "POST",
        options = {}
    ) {

        const timeoutMs =
            Number.isFinite(
                Number(
                    options.timeoutMs
                )
            )
            &&
            Number(
                options.timeoutMs
            ) > 0
                ?
                Number(
                    options.timeoutMs
                )
                :
                DEFAULT_REQUEST_TIMEOUT_MS;


        const maxAttempts =
            Number.isInteger(
                options.maxAttempts
            )
            &&
            options.maxAttempts > 0
                ?
                options.maxAttempts
                :
                1;


        const onSlow =
            typeof options.onSlow ===
                "function"
                ?
                options.onSlow
                :
                null;


        const slowNoticeMs =
            Number.isFinite(
                Number(
                    options.slowNoticeMs
                )
            )
            &&
            Number(
                options.slowNoticeMs
            ) >= 0
                ?
                Number(
                    options.slowNoticeMs
                )
                :
                SLOW_REQUEST_NOTICE_MS;


        let slowNoticeShown =
            false;



        function notifySlow() {

            if (
                slowNoticeShown
                ||
                !onSlow
            ) {

                return;

            }


            slowNoticeShown =
                true;


            try {

                onSlow();

            }
            catch {

                /*
                 * El mensaje visual nunca debe
                 * interferir con la petición.
                 */

            }

        }



        for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt++
        ) {

            const url =
                new URL(
                    config.API_URL
                );


            const body =
                new URLSearchParams({
                    action,
                    ...parameters
                });


            if (
                method ===
                "GET"
            ) {

                url.search =
                    body.toString();

            }


            const controller =
                new AbortController();


            const startedAt =
                Date.now();


            const timeout =
                setTimeout(
                    () => {

                        controller.abort();

                    },
                    timeoutMs
                );


            const slowNotice =
                setTimeout(
                    () => {

                        notifySlow();

                    },
                    slowNoticeMs
                );


            const requestOptions = {

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
                method !==
                "GET"
            ) {

                requestOptions.body =
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
                        requestOptions
                    );


                httpStatus =
                    response.status;


                if (
                    !response.ok
                ) {

                    const error =
                        new Error(
                            `HTTP ${response.status}`
                        );


                    error.httpStatus =
                        response.status;


                    throw error;

                }


                phase =
                    "JSON";


                const result =
                    await response.json();


                if (
                    !result
                    ||
                    typeof result.success !==
                        "boolean"
                ) {

                    const error =
                        new Error(
                            "Respuesta inválida."
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


                const recoverable =
                    isRecoverableRequestFailure(
                        error
                    );


                if (
                    recoverable
                    &&
                    attempt <
                        maxAttempts
                ) {

                    /*
                     * Desde el punto de vista del
                     * usuario simplemente hay una
                     * operación que está tardando.
                     *
                     * No mostramos información sobre
                     * solicitudes internas.
                     */
                    notifySlow();


                    continue;

                }


                throw createPublicRequestError(
                    error,
                    httpStatus
                );

            }
            finally {

                clearTimeout(
                    timeout
                );


                clearTimeout(
                    slowNotice
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
                ?
                "index.html?expired=1"
                :
                "index.html"
        );

    }



    /*
     * El título ya está disponible en config.js.
     *
     * No hacemos una petición a Apps Script solo
     * para obtener appInfo. Esto reduce carga y
     * evita una segunda petición simultánea
     * durante el login.
     */
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

    }



    window.AttendanceAuth =
        Object.freeze({

            request,

            getToken,

            saveSession,

            clearSession,

            goToLogin,

            loadAppInfo,


            /*
             * LOGIN
             *
             * Máximo:
             *
             * solicitud inicial
             * + recuperación 1
             * + recuperación 2
             *
             * Solo ocurre ante fallos técnicos.
             *
             * Una respuesta válida como
             * "credenciales incorrectas"
             * jamás se repite.
             */
            login:
                (
                    username,
                    password,
                    onSlow = null
                ) =>
                    request(
                        "login",
                        {
                            username,
                            password
                        },
                        "POST",
                        {
                            timeoutMs:
                                LOGIN_REQUEST_TIMEOUT_MS,

                            maxAttempts:
                                3,

                            onSlow
                        }
                    ),


            /*
             * validateSession no modifica
             * información operativa.
             */
            validateSession:
                (
                    token,
                    onSlow = null
                ) =>
                    request(
                        "validateSession",
                        {
                            token
                        },
                        "POST",
                        {
                            maxAttempts:
                                2,

                            onSlow
                        }
                    ),


            /*
             * IMPORTANTE:
             *
             * Aquí se hace exactamente una
             * solicitud.
             *
             * La memoria de 30 segundos y la
             * recuperación de asistencia viven
             * exclusivamente en scanner.js.
             */
            confirmAttendance:
                (
                    token,
                    folio,
                    method
                ) =>
                    request(
                        "confirmAttendance",
                        {
                            token,
                            folio,
                            method
                        },
                        "POST",
                        {
                            maxAttempts:
                                1
                        }
                    ),


            /*
             * Cerrar una sesión ya inexistente
             * sigue dejando el mismo estado final.
             */
            logout:
                (
                    token,
                    onSlow = null
                ) =>
                    request(
                        "logout",
                        {
                            token
                        },
                        "POST",
                        {
                            maxAttempts:
                                2,

                            onSlow
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
                    ?
                    "Verificando…"
                    :
                    "Iniciar sesión";


            form.setAttribute(
                "aria-busy",
                String(
                    value
                )
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



        function showSlowServerMessage() {

            showMessage(
                "El servidor está tardando más de lo normal. Seguimos procesando tu acceso."
            );

        }



        form.addEventListener(
            "submit",
            async event => {

                event.preventDefault();


                if (busy) {

                    return;

                }


                const username =
                    document
                        .getElementById(
                            "username"
                        )
                        .value
                        .trim();


                if (
                    !username
                    ||
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
                                passwordValue,
                                showSlowServerMessage
                            );


                    if (
                        !result.success
                        ||
                        typeof result.token !==
                            "string"
                        ||
                        !result.token
                        ||
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
                        error.message
                        ||
                        "No se pudo conectar con el servidor. Intenta nuevamente.",
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



        /*
         * Solo utiliza config.TITLE.
         * Ya no genera una solicitud appInfo.
         */
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

            const storedToken =
                getToken();


            if (!storedToken) {

                return;

            }


            setBusy(
                true
            );


            const result =
                await window
                    .AttendanceAuth
                    .validateSession(
                        storedToken,
                        showSlowServerMessage
                    );


            if (
                result.success
                &&
                result.valid
                &&
                result.role ===
                    "ATTENDANCE"
            ) {

                saveSession({

                    ...result,

                    token:
                        storedToken

                });


                window.location.replace(
                    "scanner.html"
                );

            }
            else if (
                result.valid ===
                    false
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
                error.message
                ||
                "No se pudo conectar con el servidor. Puedes iniciar sesión nuevamente.",
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
