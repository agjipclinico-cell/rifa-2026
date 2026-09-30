const APP_CONFIG = Object.freeze({

    API_URL:
        "https://script.google.com/macros/s/AKfycbxo1msbWuO_y1wZ3148SUuTW31UDOJQXGVEFfjKnH6Bq8gAqFCM43sWoqO4WprHtyvl_w/exec",

    SESSION_KEY:
        "rifa2026_attendance_session",

    REQUIRED_ROLE:
        "ATTENDANCE",

    FOLIO_PATTERN:
        /^RAPC-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/,

    QR: Object.freeze({

        FPS: 20,

        BOX_SIZE: 320

    })

});
