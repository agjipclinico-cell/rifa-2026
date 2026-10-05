(() => {
    "use strict";

    const auth =
        window.AttendanceAuth;


    const FOLIO_PREFIX =
        "RAPC-";


    const byId =
        id =>
            document.getElementById(id);


    const sessionPanel =
        byId("sessionPanel");

    const capturePanel =
        byId("capturePanel");

    const resultPanel =
        byId("resultPanel");

    const form =
        byId("attendanceForm");

    const folioInput =
        byId("folio");

    const confirmButton =
        byId("confirmButton");

    const cameraButton =
        byId("cameraButton");

    const cameraMessage =
        byId("cameraMessage");

    const logoutButton =
        byId("logoutButton");

    const nextButton =
        byId("nextButton");


    let scanner =
        null;


    let cameraQueue =
        Promise.resolve();


    let token =
        "";


    let ready =
        false;


    let busy =
        false;


    let leaving =
        false;


    let scanLocked =
        false;


    /*
     * Estos valores se utilizan únicamente
     * cuando la respuesta del servidor se pierde
     * incluso después del reintento automático
     * realizado por auth.js.
     */
    let retryFolio =
        "";


    let retryMethod =
        "MANUAL";


    let retryRequestId =
        "";


    function normalizeFolioSuffix(
        value
    ) {

        let text =
            String(
                value || ""
            )
                .trim()
                .toUpperCase();


        /*
         * Permite pegar accidentalmente el folio
         * completo, por ejemplo RAPC-P9W4.
         */
        if (
            text.startsWith(
                FOLIO_PREFIX
            )
        ) {

            text =
                text.slice(
                    FOLIO_PREFIX.length
                );

        }


        return text
            .replace(
                /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g,
                ""
            )
            .slice(
                0,
                4
            );

    }


    function buildManualFolio() {

        const suffix =
            normalizeFolioSuffix(
                folioInput.value
            );


        if (
            suffix.length !==
            4
        ) {

            return "";

        }


        return (
            FOLIO_PREFIX
            +
            suffix
        );

    }


    function setVisibleFolio(
        fullFolio
    ) {

        const normalized =
            String(
                fullFolio || ""
            )
                .trim()
                .toUpperCase();


        folioInput.value =
            normalized.startsWith(
                FOLIO_PREFIX
            )
                ?
                normalizeFolioSuffix(
                    normalized
                )
                :
                "";

    }


    function queueCamera(
        operation
    ) {

        cameraQueue =
            cameraQueue
                .then(
                    operation
                )
                .catch(
                    () => {

                        cameraMessage.textContent =
                            "No se pudo controlar la cámara. Puedes ingresar el folio manualmente.";

                    }
                );


        return cameraQueue;

    }


    function cameraState() {

        return scanner
            ?
            scanner.getState()
            :
            1;

    }


    function pauseCamera() {

        if (
            scanner
            &&
            cameraState() ===
                Html5QrcodeScannerState.SCANNING
        ) {

            scanner.pause(
                true
            );

        }


        cameraButton.textContent =
            "Leer otro QR";

    }


    async function stopCamera() {

        if (!scanner)
            return;


        const state =
            cameraState();


        if (
            state ===
                Html5QrcodeScannerState.SCANNING
            ||
            state ===
                Html5QrcodeScannerState.PAUSED
        ) {

            try {

                await scanner.stop();

            }
            catch {

                document
                    .querySelectorAll(
                        "#reader video"
                    )
                    .forEach(
                        video => {

                            video.srcObject
                                ?.getTracks()
                                .forEach(
                                    track =>
                                        track.stop()
                                );

                        }
                    );


                scanner =
                    null;


                byId("reader")
                    .replaceChildren();

            }

        }


        cameraButton.textContent =
            "Activar cámara";

    }


    function onQrRead(
        text
    ) {

        if (
            !ready
            ||
            busy
            ||
            leaving
            ||
            scanLocked
            ||
            capturePanel.hidden
        ) {

            return;

        }


        const folio =
            String(
                text || ""
            )
                .trim()
                .toUpperCase();


        if (!folio)
            return;


        /*
         * Se bloquea inmediatamente para evitar que
         * html5-qrcode entregue varias veces el mismo
         * QR mientras se procesa.
         */
        scanLocked =
            true;


        setVisibleFolio(
            folio
        );


        pauseCamera();


        cameraMessage.textContent =
            "QR detectado. Confirmando asistencia…";


        byId("folioHelp")
            .textContent =
            "QR detectado. La asistencia se está confirmando automáticamente.";


        /*
         * La lectura QR se envía inmediatamente.
         * No requiere pulsar Confirmar asistencia.
         */
        void submitAttendance(
            folio,
            "QR"
        );

    }


    async function startCamera() {

        if (
            !ready
            ||
            busy
            ||
            leaving
            ||
            capturePanel.hidden
            ||
            document.hidden
        ) {

            return;

        }


        if (
            !window.Html5Qrcode
        ) {

            cameraMessage.textContent =
                "El lector QR no está disponible. Puedes ingresar el folio manualmente.";

            return;

        }


        if (
            !window.isSecureContext
            ||
            !navigator.mediaDevices
                ?.getUserMedia
        ) {

            cameraMessage.textContent =
                "La cámara necesita HTTPS y un navegador compatible. Puedes ingresar el folio manualmente.";

            return;

        }


        cameraButton.disabled =
            true;


        scanLocked =
            false;


        cameraMessage.textContent =
            "Activando cámara…";


        try {

            if (!scanner) {

                scanner =
                    new Html5Qrcode(
                        "reader",
                        {
                            formatsToSupport: [
                                Html5QrcodeSupportedFormats
                                    .QR_CODE
                            ],

                            verbose:
                                false
                        }
                    );

            }


            if (
                cameraState() ===
                Html5QrcodeScannerState.PAUSED
            ) {

                scanner.resume();

            }
            else if (
                cameraState() !==
                Html5QrcodeScannerState.SCANNING
            ) {

                await scanner.start(

                    {
                        facingMode:
                            "environment"
                    },

                    {
                        fps:
                            10,

                        qrbox:
                            (
                                width,
                                height
                            ) => {

                                const size =
                                    Math.floor(
                                        Math.min(
                                            width,
                                            height
                                        )
                                        *
                                        0.75
                                    );


                                return {

                                    width:
                                        size,

                                    height:
                                        size

                                };

                            }
                    },

                    onQrRead,

                    () => {}

                );

            }


            if (
                busy
                ||
                leaving
                ||
                capturePanel.hidden
                ||
                document.hidden
            ) {

                await stopCamera();

                return;

            }


            if (
                scanLocked
            ) {

                pauseCamera();

            }
            else {

                cameraButton.textContent =
                    "Detener cámara";


                cameraMessage.textContent =
                    "Coloca el QR dentro del recuadro.";

            }

        }
        catch {

            cameraMessage.textContent =
                "No se pudo activar la cámara. Revisa el permiso del navegador o ingresa el folio manualmente.";


            cameraButton.textContent =
                "Activar cámara";

        }
        finally {

            cameraButton.disabled =
                busy
                ||
                leaving;

        }

    }


    function showCapture() {

        resultPanel.hidden =
            true;


        capturePanel.hidden =
            false;


        folioInput.value =
            "";


        scanLocked =
            false;


        retryFolio =
            "";


        retryMethod =
            "MANUAL";


        retryRequestId =
            "";


        byId("folioHelp")
            .textContent =
            "Escanea el QR o ingresa los 4 caracteres finales del folio.";


        byId("globalMessage")
            .textContent =
            "";


        void queueCamera(
            startCamera
        );

    }


    function showResult(
        result,
        submittedFolio,
        uncertain = false,
        submittedMethod = "MANUAL",
        requestId = ""
    ) {

        capturePanel.hidden =
            true;


        resultPanel.hidden =
            false;


        void queueCamera(
            stopCamera
        );


        const confirmed =
            result.success
            &&
            result.code ===
                "CONFIRMED";


        const already =
            result.success
            &&
            result.code ===
                "ALREADY_CONFIRMED";


        const titles = {

            INVALID_FOLIO:
                "Folio no válido",

            ATTENDANCE_CLOSED:
                "Registro de asistencia cerrado",

            INVALID_METHOD:
                "Método no válido",

            INVALID_REQUEST_ID:
                "Solicitud no válida",

            REQUEST_ID_REUSED:
                "Solicitud no válida",

            BUSY:
                "Sistema ocupado"

        };


        resultPanel.className =
            `card result ${
                confirmed
                    ?
                    "success"
                    :
                    already
                    ||
                    uncertain
                        ?
                        "warning"
                        :
                        "error"
            }`;


        byId("resultBadge")
            .textContent =
            confirmed
                ?
                "Entrada registrada"
                :
                already
                    ?
                    "Registro previo"
                    :
                    uncertain
                        ?
                        "Resultado pendiente"
                        :
                        "Registro no confirmado";


        byId("resultTitle")
            .textContent =
            confirmed
                ?
                "Confirmación exitosa"
                :
                already
                    ?
                    "Colaborador ya confirmado"
                    :
                    uncertain
                        ?
                        "No se pudo recuperar la respuesta"
                        :
                        titles[
                            result.code
                        ]
                        ||
                        "No se pudo confirmar";


        byId("resultMessage")
            .textContent =
            uncertain
                ?
                (
                    result.message
                    ||
                    "No se pudo recuperar la respuesta del servidor."
                )
                +
                " Puedes reintentar la misma operación sin generar un registro duplicado."
                :
                (
                    result.message
                    ||
                    "El servidor no devolvió un resultado reconocido."
                );


        const participant =
            result.participant;


        byId("participantDetails")
            .hidden =
            !(
                confirmed
                ||
                already
            )
            ||
            !participant;


        byId("participantName")
            .textContent =
            participant?.name
            ||
            "";


        byId("participantFolio")
            .textContent =
            participant?.folio
            ||
            submittedFolio;


        byId("participantTime")
            .textContent =
            participant?.entryTime
            ||
            "No disponible";


        byId("participantMethod")
            .textContent =
            participant?.method ===
                "QR"
                ?
                "QR"
                :
                participant?.method ===
                    "MANUAL"
                    ?
                    "Manual"
                    :
                    "No disponible";


        if (
            uncertain
        ) {

            retryFolio =
                submittedFolio;


            retryMethod =
                submittedMethod;


            retryRequestId =
                requestId;

        }
        else {

            retryFolio =
                "";


            retryRequestId =
                "";

        }


        nextButton.textContent =
            uncertain
                ?
                "Reintentar verificación"
                :
                "Escanear siguiente";


        byId("resultTitle")
            .focus();

    }


    function setBusy(
        value
    ) {

        busy =
            value;


        folioInput.disabled =
            value;


        confirmButton.disabled =
            value;


        cameraButton.disabled =
            value;


        logoutButton.disabled =
            value;


        nextButton.disabled =
            value;


        confirmButton.textContent =
            value
                ?
                "Confirmando…"
                :
                "Confirmar asistencia";


        form.setAttribute(
            "aria-busy",
            String(value)
        );

    }


    async function submitAttendance(
        folio,
        submittedMethod,
        requestId =
            auth.createRequestId()
    ) {

        if (
            !ready
            ||
            busy
            ||
            leaving
        ) {

            return;

        }


        const normalizedFolio =
            String(
                folio || ""
            )
                .trim()
                .toUpperCase();


        if (!normalizedFolio)
            return;


        scanLocked =
            true;


        setBusy(
            true
        );


        cameraMessage.textContent =
            "Confirmando asistencia…";


        void queueCamera(
            stopCamera
        );


        try {

            const result =
                await auth
                    .confirmAttendance(
                        token,
                        normalizedFolio,
                        submittedMethod,
                        requestId
                    );


            if (
                result.sessionExpired
                ||
                result.code ===
                    "UNAUTHORIZED"
            ) {

                leaving =
                    true;


                await queueCamera(
                    stopCamera
                );


                auth.goToLogin(
                    true
                );


                return;

            }


            showResult(
                result,
                normalizedFolio,
                false,
                submittedMethod,
                requestId
            );

        }
        catch (error) {

            /*
             * auth.js ya realizó su reintento
             * automático.
             *
             * Si todavía falla, conservamos el
             * requestId para que el operador pueda
             * volver a consultar exactamente la
             * misma operación.
             */
            showResult(

                {
                    message:
                        error.message
                },

                normalizedFolio,

                true,

                submittedMethod,

                requestId

            );

        }
        finally {

            if (!leaving) {

                setBusy(
                    false
                );

            }

        }

    }


    async function verifySession() {

        byId("sessionRetry")
            .hidden =
            true;


        byId("sessionMessage")
            .textContent =
            "Verificando sesión…";


        try {

            token =
                auth.getToken();


            if (!token) {

                auth.goToLogin();

                return;

            }


            const result =
                await auth
                    .validateSession(
                        token
                    );


            if (
                result.valid ===
                    false
                ||
                result.sessionExpired
                ||
                result.code ===
                    "UNAUTHORIZED"
            ) {

                auth.goToLogin(
                    true
                );


                return;

            }


            if (
                !result.success
                ||
                !result.valid
                ||
                result.role !==
                    "ATTENDANCE"
            ) {

                throw new Error(
                    result.message
                    ||
                    "No se pudo validar la sesión."
                );

            }


            auth.saveSession({

                ...result,

                token

            });


            if (leaving)
                return;


            ready =
                true;


            sessionPanel.hidden =
                true;


            showCapture();

        }
        catch (error) {

            byId("sessionMessage")
                .textContent =
                error.message;


            byId("sessionRetry")
                .hidden =
                false;

        }

    }


    /*
     * Captura manual:
     * el input contiene únicamente los cuatro
     * caracteres posteriores a RAPC-.
     */
    folioInput.addEventListener(
        "input",
        () => {

            const normalized =
                normalizeFolioSuffix(
                    folioInput.value
                );


            if (
                folioInput.value !==
                normalized
            ) {

                folioInput.value =
                    normalized;

            }


            scanLocked =
                true;


            if (
                window.Html5Qrcode
                &&
                scanner
            ) {

                pauseCamera();

            }


            byId("folioHelp")
                .textContent =
                "Ingreso manual. Escribe los 4 caracteres finales del folio.";


            cameraMessage.textContent =
                "Lectura en pausa mientras editas el folio.";

        }
    );


    cameraButton.addEventListener(
        "click",
        () => {

            void queueCamera(
                async () => {

                    if (
                        !ready
                        ||
                        busy
                        ||
                        leaving
                        ||
                        capturePanel.hidden
                    ) {

                        return;

                    }


                    if (
                        window.Html5Qrcode
                        &&
                        scanner
                        &&
                        cameraState() ===
                            Html5QrcodeScannerState
                                .SCANNING
                    ) {

                        await stopCamera();


                        cameraMessage.textContent =
                            "Cámara detenida. Puedes ingresar el folio manualmente.";

                    }
                    else {

                        await startCamera();

                    }

                }
            );

        }
    );


    /*
     * El formulario se usa únicamente para captura
     * manual.
     *
     * Un QR nunca necesita este botón porque
     * onQrRead() llama directamente a
     * submitAttendance().
     */
    form.addEventListener(
        "submit",
        event => {

            event.preventDefault();


            if (
                !ready
                ||
                busy
                ||
                leaving
            ) {

                return;

            }


            const folio =
                buildManualFolio();


            if (!folio) {

                folioInput
                    .setCustomValidity(
                        "Ingresa los 4 caracteres finales del folio."
                    );


                folioInput
                    .reportValidity();


                folioInput
                    .setCustomValidity(
                        ""
                    );


                return;

            }


            void submitAttendance(
                folio,
                "MANUAL"
            );

        }
    );


    nextButton.addEventListener(
        "click",
        () => {

            if (
                busy
                ||
                leaving
            ) {

                return;

            }


            /*
             * Si la respuesta se perdió incluso
             * después del reintento automático,
             * volvemos a enviar exactamente la
             * misma operación.
             */
            if (
                retryFolio
                &&
                retryRequestId
            ) {

                byId("resultMessage")
                    .textContent =
                    "Reintentando la misma operación…";


                void submitAttendance(
                    retryFolio,
                    retryMethod,
                    retryRequestId
                );


                return;

            }


            showCapture();

        }
    );


    logoutButton.addEventListener(
        "click",
        async () => {

            if (
                busy
                ||
                leaving
            ) {

                return;

            }


            leaving =
                true;


            logoutButton.disabled =
                true;


            nextButton.disabled =
                true;


            setBusy(
                true
            );


            logoutButton.textContent =
                "Cerrando…";


            void queueCamera(
                stopCamera
            );


            try {

                const result =
                    await auth.logout(
                        token
                        ||
                        auth.getToken()
                    );


                if (
                    !result.success
                    &&
                    !result.sessionExpired
                    &&
                    result.code !==
                        "UNAUTHORIZED"
                ) {

                    throw new Error(
                        result.message
                        ||
                        "No se pudo cerrar la sesión en el servidor."
                    );

                }


                auth.goToLogin();

            }
            catch (error) {

                leaving =
                    false;


                setBusy(
                    false
                );


                logoutButton.textContent =
                    "Cerrar sesión";


                byId("globalMessage")
                    .textContent =
                    `${error.message} Vuelve a intentar cerrar sesión.`;

            }

        }
    );


    byId("sessionRetry")
        .addEventListener(
            "click",
            () =>
                void verifySession()
        );


    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.hidden
            ) {

                void queueCamera(
                    stopCamera
                );

            }
            else if (
                ready
                &&
                !busy
                &&
                !leaving
                &&
                !capturePanel.hidden
                &&
                !scanLocked
            ) {

                void queueCamera(
                    startCamera
                );

            }

        }
    );


    window.addEventListener(
        "pagehide",
        () => {

            document
                .querySelectorAll(
                    "#reader video"
                )
                .forEach(
                    video => {

                        video.srcObject
                            ?.getTracks()
                            .forEach(
                                track =>
                                    track.stop()
                            );

                    }
                );

        }
    );


    window.addEventListener(
        "pageshow",
        event => {

            if (
                event.persisted
            ) {

                window.location.reload();

            }

        }
    );


    void auth.loadAppInfo();

    void verifySession();

})();
