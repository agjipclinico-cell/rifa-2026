(() => {
    "use strict";


    const config =
        window.AttendanceConfig;



    function normalizeTimeout(
        value,
        fallback
    ) {

        const number =
            Number(
                value
            );


        return (
            Number.isFinite(
                number
            )
            &&
            number > 0
        )
            ?
            number
            :
            fallback;

    }



    const DEFAULT_REQUEST_TIMEOUT_MS =
        normalizeTimeout(
            config.REQUEST_TIMEOUT_MS,
            15000
        );


    const ATTENDANCE_REQUEST_TIMEOUT_MS =
        normalizeTimeout(
            config.ATTENDANCE_REQUEST_TIMEOUT_MS,
            10000
        );



    async function request(
        action,
        parameters = {},
        method = "POST",
        timeoutMs =
            DEFAULT_REQUEST_TIMEOUT_MS
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



        const startedAt =
            Date.now();


        const controller =
            new AbortController();


        const timeout =
            setTimeout(
                () =>
                    controller.abort(),
                timeoutMs
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
            method !==
            "GET"
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
                    method
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


            /*
             * scanner.js puede distinguir que no
             * recibió una respuesta utilizable.
             */
            failure.transportFailure =
                true;


            throw failure;

        }
        finally {

            clearTimeout(
                timeout
            );

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
                result.success
                &&
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
             */
        }

    }



    window.AttendanceAuth =
        Object.freeze({

            request,

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
             * Una llamada = una petición HTTP.
             *
             * scanner.js decide si debe hacerse
             * un segundo intento.
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
                        ATTENDANCE_REQUEST_TIMEOUT_MS
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
                                passwordValue
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


            if (!token) {

                return;

            }


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
                result.success
                &&
                result.valid
                &&
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
