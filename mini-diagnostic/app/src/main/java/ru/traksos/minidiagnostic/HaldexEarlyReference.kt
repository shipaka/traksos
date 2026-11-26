package ru.traksos.minidiagnostic

// Separate early EB+ edition, not an electrical protocol or executable profile.
object HaldexEarlyReference {
    const val SOURCE="https://www.dttl.co.nz/wp-content/uploads/2022/03/Haldex_EB-_operators_guide.pdf"
    const val PART_SOURCE="https://www.haldex.com/en/europe/trailer-application-guide/ebs/eb-gen2gen1/eb-gen1-series/"
    private val rows=mapOf(
        "S1A CONT" to ("Колёсный датчик 1A" to "Обрыв или КЗ"),
        "S1A SIGNAL" to ("Колёсный датчик 1A" to "Сбой сигнала"),
        "S1A OUTPUT" to ("Колёсный датчик 1A" to "Слабый сигнал датчика"),
        "S1B CONT" to ("Колёсный датчик 1B" to "Обрыв или КЗ"),
        "S1B SIGNAL" to ("Колёсный датчик 1B" to "Сбой сигнала"),
        "S1B OUTPUT" to ("Колёсный датчик 1B" to "Слабый сигнал датчика"),
        "S2A CONT" to ("Колёсный датчик 2A" to "Обрыв или КЗ"),
        "S2A SIGNAL" to ("Колёсный датчик 2A" to "Сбой сигнала"),
        "S2A OUTPUT" to ("Колёсный датчик 2A" to "Слабый сигнал датчика"),
        "S2B CONT" to ("Колёсный датчик 2B" to "Обрыв или КЗ"),
        "S2B SIGNAL" to ("Колёсный датчик 2B" to "Сбой сигнала"),
        "S2B OUTPUT" to ("Колёсный датчик 2B" to "Слабый сигнал датчика"),
        "BRK APPLY SC" to ("Соленоид подачи тормозного давления" to "КЗ"),
        "EPRV 21 HOLD SC" to ("Модулятор 21: соленоид удержания" to "КЗ"),
        "EPRV 21 DUMP SC" to ("Модулятор 21: соленоид выпуска" to "КЗ"),
        "EPRV 22 HOLD SC" to ("Модулятор 22: соленоид удержания" to "КЗ"),
        "EPRV 22 DUMP SC" to ("Модулятор 22: соленоид выпуска" to "КЗ"),
        "BRK APPLY OC" to ("Соленоид подачи тормозного давления" to "Обрыв"),
        "EPRV 21 HOLD OC" to ("Модулятор 21: соленоид удержания" to "Обрыв"),
        "EPRV 21 DUMP OC" to ("Модулятор 21: соленоид выпуска" to "Обрыв"),
        "EPRV 22 HOLD OC" to ("Модулятор 22: соленоид удержания" to "Обрыв"),
        "EPRV 22 DUMP OC" to ("Модулятор 22: соленоид выпуска" to "Обрыв"),
        "BRK APPLY SC DRIVE" to ("Соленоид подачи тормозного давления" to "КЗ с постоянным возбуждением"),
        "EPRV 21 HOLD SC DRIVE" to ("Модулятор 21: соленоид удержания" to "КЗ с постоянным возбуждением"),
        "EPRV 21 DUMP SC DRIVE" to ("Модулятор 21: соленоид выпуска" to "КЗ с постоянным возбуждением"),
        "EPRV 22 HOLD SC DRIVE" to ("Модулятор 22: соленоид удержания" to "КЗ с постоянным возбуждением"),
        "EPRV 22 DUMP SC DRIVE" to ("Модулятор 22: соленоид выпуска" to "КЗ с постоянным возбуждением"),
        "BRK APPLY UNSPEC" to ("Соленоид подачи тормозного давления" to "Сбой цепи управления"),
        "EPRV 21 HOLD UNSPEC" to ("Модулятор 21: соленоид удержания" to "Сбой цепи управления"),
        "EPRV 21 DUMP UNSPEC" to ("Модулятор 21: соленоид выпуска" to "Сбой цепи управления"),
        "EPRV 22 HOLD UNSPEC" to ("Модулятор 22: соленоид удержания" to "Сбой цепи управления"),
        "EPRV 22 DUMP UNSPEC" to ("Модулятор 22: соленоид выпуска" to "Сбой цепи управления"),
        "DEMAND SC" to ("Датчик управляющего давления" to "КЗ"),
        "RESR SC" to ("Датчик давления ресивера" to "КЗ"),
        "SUSP SC" to ("Датчик давления подвески" to "КЗ"),
        "EPRV 21 DEL SC" to ("Датчик выходного давления 21" to "КЗ"),
        "EPRV 22 DEL SC" to ("Датчик выходного давления 22" to "КЗ"),
        "REV SWITCH SC" to ("Реле давления аварийного клапана" to "КЗ"),
        "LAT ACC SC" to ("Датчик бокового ускорения" to "КЗ"),
        "DEMAND OC" to ("Датчик управляющего давления" to "Обрыв"),
        "RESR OC" to ("Датчик давления ресивера" to "Обрыв"),
        "SUSP OC" to ("Датчик давления подвески" to "Обрыв"),
        "EPRV 21 DEL OC" to ("Датчик выходного давления 21" to "Обрыв"),
        "EPRV 22 DEL OC" to ("Датчик выходного давления 22" to "Обрыв"),
        "REV SWITCH OC" to ("Реле давления аварийного клапана" to "Обрыв"),
        "LAT ACC OC" to ("Датчик бокового ускорения" to "Обрыв"),
        "EPRV 21 SLOW REC" to ("Колесо модулятора 21" to "Замедленное восстановление скорости"),
        "EPRV 22 SLOW REC" to ("Колесо модулятора 22" to "Замедленное восстановление скорости"),
        "SUSP LOW" to ("Давление подвески" to "Вне рабочего диапазона"),
        "REV SWITCH PNEUMATIC" to ("Реле давления аварийного клапана" to "Пневматический сбой"),
        "REV SWITCH SIGNAL" to ("Реле давления аварийного клапана" to "Не сработало"),
        "PNEUMATIC DEMAND LOSS" to ("Пневматическое управление" to "Нет соответствующего управляющего давления"),
        "TOWED CAN DEMAND LOSS" to ("CAN тягач–прицеп" to "Нарушение линии связи"),
        "TOWED CAN CONTROL LOSS" to ("CAN тягач–прицеп" to "Нарушение обмена данными"),
        "PWR ISO7638 FAIL" to ("Питание ISO 7638" to "Пропало на контакте 1 или 2"),
        "PWR LO VOLT" to ("Питание ЭБУ" to "Ниже 19 В при возбуждённом соленоиде подачи тормозного давления"),
        "PWR HI VOLT" to ("Питание ЭБУ" to "Выше 32 В"),
        "PWR UNSPEC" to ("ЭБУ" to "Внутренний сбой"),
        "ECU EE ERR" to ("ЭБУ" to "Внутренняя ошибка или отсутствует программирование"),
        "ECU PARAM ERR" to ("ЭБУ" to "Внутренняя ошибка или отсутствует программирование"),
        "ECU EE UNSPEC" to ("ЭБУ" to "Внутренняя ошибка или отсутствует программирование"),
        "AUX1" to ("Дополнительная цепь 1" to "Обрыв или КЗ"),
        "AUX2" to ("Дополнительная цепь 2" to "Обрыв или КЗ"),
        "AUX3" to ("Дополнительная цепь 3" to "Обрыв или КЗ"),
        "AUX4" to ("Дополнительная цепь 4" to "Обрыв или КЗ"),
        "AUX5" to ("Дополнительная цепь 5" to "Обрыв или КЗ"),
        "BRAKE PADS" to ("Контроль износа" to "Обрыв проводки"),
        "LAT ACC SIGNAL" to ("Датчик бокового ускорения" to "Нарушение сигнала"),
        "SLAVE VALVE SENSOR" to ("Датчики давления ведомого клапана" to "Обрыв или КЗ"),
        "SLAVE VALVE MODULATOR" to ("Соленоиды ведомого клапана" to "Обрыв или КЗ"),
        "SLAVE VALVE CABLE" to ("Жгут ведомого клапана" to "Обрыв или КЗ"),
        "SLAVE VALVE SLOW REC" to ("Колесо ведомого клапана" to "Замедленное восстановление скорости"),
        "SLAVE SUSP LOW" to ("Давление подвески ведомого блока" to "Вне рабочего диапазона")
    )
    fun lookup(code:String)=rows[code]
    val count get()=rows.size
    // Main/ECU assemblies explicitly listed by manufacturer. No valve-only or
    // shared aftermarket replacement numbers. A listed number is not a wire identity.
    private val parts=setOf("810003101","810005101","810004101","810006101","810001102","810001101","810007101","810005302","810012001","810007301","810008303","810008302","810008301","810001303","810001302","810001301","810006301","810009302","810009301","810011001","810016001","810020001","810010002","810010001","810017001","810014002","810021001","812001101","812001201","812001301","812001202","812012001","812013001","812011001","812010001")
    fun isListedPart(input:String):Boolean {
        if(input.length>120 || input.any { it !in '0'..'9' && it!=' ' && it!='-' })return false
        return input.filter { it in '0'..'9' } in parts
    }
    val partCount get()=parts.size
}
