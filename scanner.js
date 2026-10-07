(() => {
    "use strict";


    const auth =
        window.AttendanceAuth;


    const FOLIO_PREFIX =
        "RAPC-";


    const OPERATION_MEMORY_MS =
        30000;


    const AUTOMATIC_ATTEMPTS =
        2;



    const byId =
        id =>
            document.getElementById(
                id
            );



    const sessionPanel =
        byId(
            "sessionPanel"
        );


    const capturePanel =
        byId(
            "capturePanel"
        );


    const resultPanel =
        byId(
            "resultPanel"
        );


    const form =
        byId(
            "attendanceForm"
        );


    const folioInput =
        byId(
            "folio"
        );


    const confirmButton =
        byId(
            "confirmButton"
        );


    const cameraButton =
        byId(
            "cameraButton"
        );


    const cameraMessage =
        byId(
            "cameraMessage"
        );


    const logoutButton =
        byId(
            "logoutButton"
        );


    const nextButton =
        byId(
            "nextButton"
        );



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
     * Memoria RAM de operaciones.
     *
     * No usa localStorage.
     * No usa sessionStorage.
     * No envía identificadores al servidor.
     */
    const operationMemory =
        new Map();


    let operationSequence =
        0;


    /*
     * Solo se utiliza cuando ambos intentos
     * terminaron sin una respuesta utilizable.
     */
    let retryOperation =
        null;



    /* =========================================================
       FOLIOS
       ========================================================= */

    function normalizeFolioSuffix(
        value
    ) {

        let text =
            String(
                value || ""
            )
                .trim()
                .toUpperCase();


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



    /* =========================================================
       MEMORIA LOCAL DE OPERACIONES
       ========================================================= */

    function createOperationKey() {

        operationSequence++;


        return (
            "ATTENDANCE:"
            +
            Date.now()
            +
            ":"
            +
            operationSequence
        );

    }



    function createAttendanceOperation(
        folio,
        method
    ) {

        const now =
            Date.now();


        const operation = {

            key:
                createOperationKey(),

            type:
                "ATTENDANCE",

            folio,

            method,

            createdAt:
                now,

            expiresAt:
                now
                +
                OPERATION_MEMORY_MS,

            attempts:
                0,

            lostResponse:
                false,

            lastError:
                ""

        };


        operationMemory.set(
            operation.key,
            operation
        );


        /*
         * Eliminación física de la memoria
         * una vez pasados los 30 segundos.
         */
        setTimeout(
            () => {

                const current =
                    operationMemory.get(
                        operation.key
                    );


                if (
                    current ===
                    operation
                ) {

                    operationMemory.delete(
                        operation.key
                    );

                }

            },
            OPERATION_MEMORY_MS
            +
            50
        );


        return operation;

    }



    function getAttendanceOperation(
        key
    ) {

        if (!key) {

            return null;

        }


        const operation =
            operationMemory.get(
                key
            );


        if (!operation) {

            return null;

        }


        if (
            Date.now() >=
            operation.expiresAt
        ) {

            operationMemory.delete(
                key
            );


            return null;

        }


        return operation;

    }



    function markOperationFailure(
        operation,
        error
    ) {

        if (!operation) {

            return;

        }


        operation.lostResponse =
            true;


        operation.lastError =
            error?.message
            ||
            "";

    }



    function interpretAttendanceResponse(
        result,
        operation
    ) {

        /*
         * Caso fundamental:
         *
         * intento 1:
         * servidor registra
         * pero respuesta se pierde
         *
         * intento 2:
         * servidor responde ALREADY_CONFIRMED
         *
         * Como conocemos el contexto local,
         * lo interpretamos como una confirmación
         * exitosa de la operación actual.
         */
        if (
            result
            &&
            result.success
            &&
            result.code ===
                "ALREADY_CONFIRMED"
            &&
            operation
            &&
            operation.lostResponse
            &&
            Date.now() <
                operation.expiresAt
        ) {

            return {

                ...result,

                code:
                    "CONFIRMED_RECOVERED",

                message:
                    "La asistencia está confirmada."

            };

        }


        return result;

    }



    /* =========================================================
       CÁMARA
       ========================================================= */

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



    function markQrAsRead() {

        const reader =
            byId(
                "reader"
            );


        if (!reader) {

            return;

        }


        /*
         * Igualamos aproximadamente el tamaño
         * de las guías al qrbox configurado
         * en html5-qrcode.
         */
        const width =
            reader.clientWidth;


        const height =
            reader.clientHeight;


        if (
            width > 0
            &&
            height > 0
        ) {

            const size =
                Math.floor(
                    Math.min(
                        width,
                        height
                    )
                    *
                    0.75
                );


            reader.style.setProperty(
                "--qr-guide-size",
                `${size}px`
            );

        }


        /*
         * Reinicia la pequeña animación si
         * fuera necesario.
         */
        reader.classList.remove(
            "qr-read-ok"
        );


        void reader.offsetWidth;


        reader.classList.add(
            "qr-read-ok"
        );

    }



    function clearQrReadState() {

        const reader =
            byId(
                "reader"
            );


        if (!reader) {

            return;

        }


        reader.classList.remove(
            "qr-read-ok"
        );


        reader.style.removeProperty(
            "--qr-guide-size"
        );

    }



    function pauseCamera() {

        if (
            scanner
            &&
            cameraState() ===
                Html5QrcodeScannerState
                    .SCANNING
        ) {

            /*
             * true indica a html5-qrcode que
             * también pause el video.
             *
             * Así queda visible el último frame.
             */
            scanner.pause(
                true
            );

        }


        cameraButton.textContent =
            "Leer otro QR";

    }



    async function stopCamera() {

        if (!scanner) {

            return;

        }


        const state =
            cameraState();


        if (
            state ===
                Html5QrcodeScannerState
                    .SCANNING
            ||
            state ===
                Html5QrcodeScannerState
                    .PAUSED
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


                byId(
                    "reader"
                )
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


        if (!folio) {

            return;

        }


        /*
         * Se bloquea inmediatamente para impedir
         * lecturas repetidas del mismo frame.
         */
        scanLocked =
            true;


        setVisibleFolio(
            folio
        );


        /*
         * Feedback visual inmediato:
         *
         * 1. guías verdes
         * 2. último frame congelado
         * 3. texto de confirmación
         */
        markQrAsRead();


        pauseCamera();


        cameraMessage.textContent =
            "QR leído correctamente. Confirmando asistencia…";


        byId(
            "folioHelp"
        )
            .textContent =
            "QR leído correctamente. La asistencia se está confirmando automáticamente.";


        /*
         * IMPORTANTE:
         *
         * Ya NO detenemos la cámara aquí.
         * El frame permanece congelado mientras
         * esperamos al servidor.
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


        clearQrReadState();


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
                Html5QrcodeScannerState
                    .PAUSED
            ) {

                scanner.resume();

            }
            else if (
                cameraState() !==
                Html5QrcodeScannerState
                    .SCANNING
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



    /* =========================================================
       VISTAS
       ========================================================= */

    function showCapture() {

        resultPanel.hidden =
            true;


        capturePanel.hidden =
            false;


        folioInput.value =
            "";


        scanLocked =
            false;


        retryOperation =
            null;


        clearQrReadState();


        byId(
            "folioHelp"
        )
            .textContent =
            "Escanea el QR o ingresa los 4 caracteres finales del folio.";


        byId(
            "globalMessage"
        )
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
        operationKey = ""
    ) {

        capturePanel.hidden =
            true;


        resultPanel.hidden =
            false;


        /*
         * Ahora sí dejamos de utilizar
         * físicamente la cámara.
         *
         * Hasta este momento el frame QR
         * permaneció congelado y visible.
         */
        void queueCamera(
            stopCamera
        );



        const recovered =
            result.success
            &&
            result.code ===
                "CONFIRMED_RECOVERED";


        const confirmed =
            result.success
            &&
            (
                result.code ===
                    "CONFIRMED"
                ||
                recovered
            );


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



        byId(
            "resultBadge"
        )
            .textContent =
            recovered
                ?
                "Entrada confirmada"
                :
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
                            "Problema de conexión"
                            :
                            "Registro no confirmado";



        byId(
            "resultTitle"
        )
            .textContent =
            recovered
                ?
                "Asistencia confirmada"
                :
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
                            "No se pudo confirmar el resultado"
                            :
                            titles[
                                result.code
                            ]
                            ||
                            "No se pudo confirmar";



        if (
            uncertain
        ) {

            byId(
                "resultMessage"
            )
                .textContent =
                "No se pudo recibir una respuesta del servidor después de dos intentos. "
                +
                "La asistencia pudo haberse registrado. Puedes repetir la operación.";

        }
        else if (
            recovered
        ) {

            byId(
                "resultMessage"
            )
                .textContent =
                "La asistencia está confirmada. La respuesta de un intento anterior no se recibió correctamente.";

        }
        else {

            byId(
                "resultMessage"
            )
                .textContent =
                result.message
                ||
                "El servidor no devolvió un resultado reconocido.";

        }



        const participant =
            result.participant;



        byId(
            "participantDetails"
        )
            .hidden =
            !(
                confirmed
                ||
                already
            )
            ||
            !participant;



        byId(
            "participantName"
        )
            .textContent =
            participant?.name
            ||
            "";



        byId(
            "participantFolio"
        )
            .textContent =
            participant?.folio
            ||
            submittedFolio;



        byId(
            "participantTime"
        )
            .textContent =
            participant?.entryTime
            ||
            "No disponible";



        byId(
            "participantMethod"
        )
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

            retryOperation = {

                key:
                    operationKey,

                folio:
                    submittedFolio,

                method:
                    submittedMethod

            };

        }
        else {

            retryOperation =
                null;

        }



        nextButton.textContent =
            uncertain
                ?
                "Repetir operación"
                :
                "Escanear siguiente";



        byId(
            "resultTitle"
        )
            .focus();

    }



    /* =========================================================
       ESTADO DE INTERFAZ
       ========================================================= */

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
            String(
                value
            )
        );

    }



    /* =========================================================
       RESPUESTAS DEL SERVIDOR
       ========================================================= */

    function isUnauthorized(
        result
    ) {

        return (
            result?.sessionExpired
            ||
            result?.code ===
                "UNAUTHORIZED"
        );

    }



    function handleUnauthorized() {

        leaving =
            true;


        void queueCamera(
            stopCamera
        );


        auth.goToLogin(
            true
        );

    }



    /* =========================================================
       REGISTRO DE ASISTENCIA
       ========================================================= */

    async function submitAttendance(
        folio,
        submittedMethod,
        existingOperationKey = ""
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


        if (!normalizedFolio) {

            return;

        }



        const normalizedMethod =
            submittedMethod ===
                "QR"
                ?
                "QR"
                :
                "MANUAL";



        /*
         * En un escaneo/registro nuevo siempre
         * se crea una operación nueva.
         *
         * Solo "Repetir operación" proporciona
         * existingOperationKey.
         */
        let operation =
            getAttendanceOperation(
                existingOperationKey
            );


        if (!operation) {

            operation =
                createAttendanceOperation(
                    normalizedFolio,
                    normalizedMethod
                );

        }



        scanLocked =
            true;


        retryOperation =
            null;


        setBusy(
            true
        );



        if (
            !capturePanel.hidden
        ) {

            cameraMessage.textContent =
                normalizedMethod ===
                    "QR"
                    ?
                    "QR leído correctamente. Confirmando asistencia…"
                    :
                    "Confirmando asistencia…";

        }
        else {

            byId(
                "resultMessage"
            )
                .textContent =
                "Repitiendo operación…";

        }



        try {

            for (
                let attempt = 1;
                attempt <= AUTOMATIC_ATTEMPTS;
                attempt++
            ) {

                operation.attempts++;


                try {

                    const result =
                        await auth
                            .confirmAttendance(
                                token,
                                normalizedFolio,
                                normalizedMethod
                            );



                    if (
                        isUnauthorized(
                            result
                        )
                    ) {

                        handleUnauthorized();


                        return;

                    }



                    const interpreted =
                        interpretAttendanceResponse(
                            result,
                            operation
                        );



                    showResult(
                        interpreted,
                        normalizedFolio,
                        false,
                        normalizedMethod,
                        operation.key
                    );


                    return;

                }
                catch (error) {

                    /*
                     * Llegar aquí significa que no
                     * obtuvimos una respuesta HTTP/JSON
                     * utilizable.
                     *
                     * NO significa que Apps Script
                     * necesariamente haya fallado.
                     */
                    markOperationFailure(
                        operation,
                        error
                    );



                    if (
                        attempt <
                        AUTOMATIC_ATTEMPTS
                    ) {

                        if (
                            !capturePanel.hidden
                        ) {

                            cameraMessage.textContent =
                                "Respuesta no recibida. Reintentando confirmación…";

                        }
                        else {

                            byId(
                                "resultMessage"
                            )
                                .textContent =
                                "Respuesta no recibida. Reintentando operación…";

                        }


                        continue;

                    }



                    /*
                     * También falló el segundo intento.
                     *
                     * Mostramos el error y permitimos
                     * al operador repetir manualmente.
                     */
                    showResult(

                        {
                            success:
                                false,

                            code:
                                "CONNECTION_ERROR",

                            message:
                                error.message
                        },

                        normalizedFolio,

                        true,

                        normalizedMethod,

                        operation.key

                    );


                    return;

                }

            }

        }
        finally {

            if (!leaving) {

                setBusy(
                    false
                );

            }

        }

    }



    /* =========================================================
       SESIÓN
       ========================================================= */

    async function verifySession() {

        byId(
            "sessionRetry"
        )
            .hidden =
            true;


        byId(
            "sessionMessage"
        )
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


            if (leaving) {

                return;

            }


            ready =
                true;


            sessionPanel.hidden =
                true;


            showCapture();

        }
        catch (error) {

            byId(
                "sessionMessage"
            )
                .textContent =
                error.message;


            byId(
                "sessionRetry"
            )
                .hidden =
                false;

        }

    }



    /* =========================================================
       CAPTURA MANUAL
       ========================================================= */

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


            clearQrReadState();


            if (
                window.Html5Qrcode
                &&
                scanner
            ) {

                pauseCamera();

            }


            byId(
                "folioHelp"
            )
                .textContent =
                "Ingreso manual. Escribe los 4 caracteres finales del folio.";


            cameraMessage.textContent =
                "Lectura en pausa mientras editas el folio.";

        }
    );



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



    /* =========================================================
       BOTÓN DE CÁMARA
       ========================================================= */

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

                        scanLocked =
                            false;


                        clearQrReadState();


                        await startCamera();

                    }

                }
            );

        }
    );



    /* =========================================================
       SIGUIENTE / REINTENTO MANUAL
       ========================================================= */

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


            if (
                retryOperation
            ) {

                const pending = {

                    ...retryOperation

                };


                void submitAttendance(
                    pending.folio,
                    pending.method,
                    pending.key
                );


                return;

            }


            showCapture();

        }
    );



    /* =========================================================
       LOGOUT
       ========================================================= */

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


                byId(
                    "globalMessage"
                )
                    .textContent =
                    `${error.message} Vuelve a intentar cerrar sesión.`;

            }

        }
    );



    /* =========================================================
       REINTENTO DE SESIÓN
       ========================================================= */

    byId(
        "sessionRetry"
    )
        .addEventListener(
            "click",
            () =>
                void verifySession()
        );



    /* =========================================================
       CICLO DE VIDA
       ========================================================= */

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
