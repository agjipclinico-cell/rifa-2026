(() => {
    "use strict";


    const auth =
        window.AttendanceAuth;


    const config =
        window.AttendanceConfig
        ||
        {};


    const FOLIO_PREFIX =
        "RAPC-";


    /*
     * Una operación permanece en memoria local
     * durante 30 segundos desde que se inicia.
     */
    const OPERATION_MEMORY_MS =
        30000;


    /*
     * Asistencia:
     *
     * solicitud inicial
     * +
     * una recuperación automática
     */
    const AUTOMATIC_ATTEMPTS =
        2;


    /*
     * Si el servidor tarda más de este tiempo,
     * mostramos un mensaje neutro al operador.
     */
    const SLOW_NOTICE_MS =
        4000;


    /*
     * El timeout de cada solicitud de asistencia
     * debe ser suficientemente corto para que
     * ambos envíos quepan dentro de los 30 s
     * de memoria local.
     *
     * Puede sobrescribirse desde config.js:
     *
     * ATTENDANCE_REQUEST_TIMEOUT_MS: 10000
     */
    const ATTENDANCE_REQUEST_TIMEOUT_MS =
        Number.isFinite(
            Number(
                config.ATTENDANCE_REQUEST_TIMEOUT_MS
            )
        )
        &&
        Number(
            config.ATTENDANCE_REQUEST_TIMEOUT_MS
        ) > 0
            ?
            Number(
                config.ATTENDANCE_REQUEST_TIMEOUT_MS
            )
            :
            10000;



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
     * Memoria temporal exclusivamente local.
     *
     * No usa:
     *
     * - localStorage
     * - sessionStorage
     * - PropertiesService
     *
     * Desaparece al recargar la página.
     */
    const operationMemory =
        new Map();


    let operationSequence =
        0;


    /*
     * Guarda la operación únicamente cuando
     * necesitamos ofrecer el botón
     * "Repetir operación".
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
         * La operación se elimina físicamente
         * después de los 30 segundos.
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
            100
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
         * Si recientemente enviamos esta operación,
         * hubo un problema de comunicación y ahora
         * el servidor responde ALREADY_CONFIRMED,
         * tratamos el estado final como éxito.
         *
         * No afirmamos cuál de las solicitudes
         * realizó físicamente la escritura.
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
       COLA DE CÁMARA
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



    /* =========================================================
       GUÍAS DEL LECTOR QR
       ========================================================= */

    /*
     * html5-qrcode crea internamente:
     *
     * #qr-shaded-region
     *
     * y dentro de él coloca cuatro barras que
     * forman su guía original.
     *
     * Esas barras son las que html5-qrcode
     * cambia a verde al reconocer un QR.
     *
     * Nosotros las ocultamos SOLO después de
     * detectar correctamente un código para
     * dejar visible nuestra guía personalizada.
     */
    function getNativeQrGuideElements() {

        const shadedRegion =
            document.getElementById(
                "qr-shaded-region"
            );


        if (!shadedRegion) {

            return [];

        }


        return Array
            .from(
                shadedRegion.children
            )
            .filter(
                element =>
                    element instanceof
                        HTMLElement
            );

    }



    function hideNativeQrGuide() {

        getNativeQrGuideElements()
            .forEach(
                element => {

                    /*
                     * Usamos visibility en lugar
                     * de display para no modificar
                     * la geometría del lector.
                     */
                    element.style.visibility =
                        "hidden";

                }
            );

    }



    function restoreNativeQrGuide() {

        getNativeQrGuideElements()
            .forEach(
                element => {

                    element.style.visibility =
                        "";

                }
            );

    }



    function calculateQrGuideSize() {

        /*
         * Intentamos obtener el tamaño REAL
         * del hueco de lectura de html5-qrcode.
         */
        const shadedRegion =
            document.getElementById(
                "qr-shaded-region"
            );


        if (
            shadedRegion
        ) {

            const rect =
                shadedRegion
                    .getBoundingClientRect();


            const style =
                window.getComputedStyle(
                    shadedRegion
                );


            const borderLeft =
                parseFloat(
                    style.borderLeftWidth
                )
                ||
                0;


            const borderRight =
                parseFloat(
                    style.borderRightWidth
                )
                ||
                0;


            const borderTop =
                parseFloat(
                    style.borderTopWidth
                )
                ||
                0;


            const borderBottom =
                parseFloat(
                    style.borderBottomWidth
                )
                ||
                0;


            const scanWidth =
                rect.width
                -
                borderLeft
                -
                borderRight;


            const scanHeight =
                rect.height
                -
                borderTop
                -
                borderBottom;


            const size =
                Math.min(
                    scanWidth,
                    scanHeight
                );


            if (
                Number.isFinite(
                    size
                )
                &&
                size > 0
            ) {

                return Math.floor(
                    size
                );

            }

        }



        /*
         * Fallback por si la estructura interna
         * todavía no está disponible.
         */
        const reader =
            byId(
                "reader"
            );


        if (!reader) {

            return 0;

        }


        const width =
            reader.clientWidth;


        const height =
            reader.clientHeight;


        if (
            width <= 0
            ||
            height <= 0
        ) {

            return 0;

        }


        return Math.floor(
            Math.min(
                width,
                height
            )
            *
            0.75
        );

    }



    function markQrAsRead() {

        const reader =
            byId(
                "reader"
            );


        if (!reader) {

            return;

        }


        const size =
            calculateQrGuideSize();


        if (
            size > 0
        ) {

            reader.style.setProperty(
                "--qr-guide-size",
                `${size}px`
            );

        }


        /*
         * Fundamental:
         *
         * ocultamos la guía nativa que se acaba
         * de volver verde.
         */
        hideNativeQrGuide();


        /*
         * Reiniciamos nuestra animación.
         */
        reader.classList.remove(
            "qr-read-ok"
        );


        void reader.offsetWidth;


        /*
         * Esto activa:
         *
         * #reader.qr-read-ok::after
         *
         * de styles.css.
         */
        reader.classList.add(
            "qr-read-ok"
        );

    }



    function clearQrReadState() {

        const reader =
            byId(
                "reader"
            );


        /*
         * Antes de volver a escanear recuperamos
         * la guía blanca original.
         */
        restoreNativeQrGuide();


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



    /* =========================================================
       CONTROL DE CÁMARA
       ========================================================= */

    function pauseCamera() {

        if (
            scanner
            &&
            cameraState() ===
                Html5QrcodeScannerState
                    .SCANNING
        ) {

            /*
             * true:
             *
             * congela también el video y conserva
             * visible el último frame leído.
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



    /* =========================================================
       QR DETECTADO
       ========================================================= */

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
         * Impide múltiples callbacks del mismo
         * QR mientras se procesa.
         */
        scanLocked =
            true;


        setVisibleFolio(
            folio
        );


        /*
         * Primero congelamos el video.
         */
        pauseCamera();


        /*
         * Después ocultamos la guía verde
         * original y activamos únicamente
         * nuestra guía personalizada.
         */
        markQrAsRead();


        cameraMessage.textContent =
            "QR leído correctamente. Confirmando asistencia…";


        byId(
            "folioHelp"
        )
            .textContent =
            "QR leído correctamente. La asistencia se está confirmando automáticamente.";


        /*
         * La cámara NO se detiene aquí.
         *
         * El último frame sigue visible hasta
         * obtener un resultado.
         */
        void submitAttendance(
            folio,
            "QR"
        );

    }



    /* =========================================================
       INICIAR CÁMARA
       ========================================================= */

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


        /*
         * Elimina nuestra guía verde y devuelve
         * la guía nativa a su estado normal.
         */
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

                /*
                 * Antes de reanudar nos aseguramos
                 * de que no quede oculta la guía
                 * nativa.
                 */
                clearQrReadState();


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
       VISTA DE CAPTURA
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



    /* =========================================================
       RESULTADO
       ========================================================= */

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
         * El frame dejó de ser necesario.
         * Ahora sí apagamos físicamente
         * la cámara.
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
                "Sistema ocupado",

            CONNECTION_ERROR:
                "Problema de conexión"

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
                "No se pudo completar la conexión con el servidor. "
                +
                "La asistencia podría haberse registrado. Puedes repetir la operación.";

        }
        else if (
            recovered
        ) {

            /*
             * No exponemos al operador los detalles
             * internos de recuperación.
             */
            byId(
                "resultMessage"
            )
                .textContent =
                "La asistencia está confirmada.";

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
       AUTORIZACIÓN
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



    async function handleUnauthorized() {

        leaving =
            true;


        await queueCamera(
            stopCamera
        );


        auth.goToLogin(
            true
        );

    }



    /* =========================================================
       MENSAJE DE SERVIDOR LENTO
       ========================================================= */

    function showSlowAttendanceMessage(
        method
    ) {

        if (
            !capturePanel.hidden
        ) {

            cameraMessage.textContent =
                method ===
                    "QR"
                    ?
                    "El servidor está tardando más de lo normal. Estamos confirmando la asistencia…"
                    :
                    "El servidor está tardando más de lo normal. Estamos procesando la asistencia…";

        }
        else {

            byId(
                "resultMessage"
            )
                .textContent =
                "El servidor está tardando más de lo normal. Estamos verificando la asistencia…";

        }

    }



    /* =========================================================
       UNA SOLICITUD DE ASISTENCIA
       ========================================================= */

    async function sendAttendanceRequest(
        folio,
        method
    ) {

        /*
         * Usamos request() directamente porque
         * necesitamos un timeout específico para
         * asistencia.
         *
         * maxAttempts = 1:
         *
         * auth.js NO hace ninguna recuperación
         * interna para esta operación.
         *
         * scanner.js conserva todo el contexto.
         */
        return auth.request(

            "confirmAttendance",

            {
                token,

                folio,

                method
            },

            "POST",

            {
                timeoutMs:
                    ATTENDANCE_REQUEST_TIMEOUT_MS,

                maxAttempts:
                    1
            }

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
         * Si estamos repitiendo manualmente una
         * operación todavía vigente, reutilizamos
         * su memoria.
         *
         * Si expiró, comienza una operación nueva.
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
                "Verificando asistencia…";

        }



        try {

            for (
                let attempt = 1;
                attempt <=
                    AUTOMATIC_ATTEMPTS;
                attempt++
            ) {

                operation.attempts++;



                /*
                 * Aunque fetch todavía siga
                 * esperando, después de unos
                 * segundos comunicamos simplemente
                 * que el servidor está tardando.
                 */
                const slowNoticeTimer =
                    setTimeout(
                        () => {

                            showSlowAttendanceMessage(
                                normalizedMethod
                            );

                        },
                        SLOW_NOTICE_MS
                    );



                try {

                    const result =
                        await sendAttendanceRequest(
                            normalizedFolio,
                            normalizedMethod
                        );


                    clearTimeout(
                        slowNoticeTimer
                    );



                    if (
                        isUnauthorized(
                            result
                        )
                    ) {

                        await handleUnauthorized();


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

                    clearTimeout(
                        slowNoticeTimer
                    );


                    /*
                     * Para la lógica interna sí
                     * necesitamos recordar que no
                     * pudimos conocer el resultado.
                     *
                     * Este detalle nunca se muestra
                     * al operador.
                     */
                    markOperationFailure(
                        operation,
                        error
                    );



                    if (
                        attempt <
                        AUTOMATIC_ATTEMPTS
                    ) {

                        /*
                         * Recuperación automática.
                         *
                         * No decimos:
                         *
                         * - "reintento"
                         * - "respuesta perdida"
                         * - "segundo intento"
                         */
                        showSlowAttendanceMessage(
                            normalizedMethod
                        );


                        continue;

                    }



                    /*
                     * No pudimos obtener un estado
                     * concluyente.
                     */
                    showResult(

                        {
                            success:
                                false,

                            code:
                                "CONNECTION_ERROR",

                            message:
                                "No se pudo completar la conexión con el servidor."
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
       VERIFICACIÓN DE SESIÓN
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
                        token,
                        () => {

                            byId(
                                "sessionMessage"
                            )
                                .textContent =
                                "El servidor está tardando más de lo normal…";

                        }
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


            /*
             * Si el usuario comienza a escribir,
             * quitamos cualquier estado visual de
             * lectura QR.
             */
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
       SIGUIENTE / REPETIR OPERACIÓN
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
                        auth.getToken(),
                        () => {

                            byId(
                                "globalMessage"
                            )
                                .textContent =
                                "El servidor está tardando más de lo normal…";

                        }
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



    /* =========================================================
       INICIALIZACIÓN
       ========================================================= */

    void auth.loadAppInfo();


    void verifySession();

})();
