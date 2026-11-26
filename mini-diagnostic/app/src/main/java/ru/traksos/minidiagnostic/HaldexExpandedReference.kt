package ru.traksos.minidiagnostic

// Manufacturer display labels only. Gen2 and Gen3 are separate reference editions.
// No DTC bytes, addressing, live transport, or fault activation is implied.
object HaldexExpandedReference {
    const val GEN2_SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/000700341_gb.pdf"
    // Gen3 2013 Russian guide pp106-108; checked against 2021 English guide pp110-112.
    private val extra3=buildMap<String,Pair<String,String>> {
        for(m in listOf(21,22)) {
            for((key,part) in listOf("HOLD" to "клапан удержания","DUMP" to "выпускной клапан")) {
                val name="Модулятор $m: $part"
                put("EPRV $m $key SC",name to "КЗ обмотки")
                put("EPRV $m $key OC",name to "Обрыв цепи")
                put("EPRV $m $key SC DRIVE",name to "КЗ с постоянным возбуждением")
                put("EPRV $m $key UNSPEC",name to "Сбой управления обмоткой")
            }
            put("EPRV $m SLOW REC","Модулятор $m" to "Замедленное восстановление скорости одного колеса")
            put("EPRV $m DEL SC","Датчик выходного давления $m" to "КЗ")
            put("EPRV $m DEL OC","Датчик выходного давления $m" to "Обрыв")
        }
        put("DEMAND SC","Датчик управляющего давления" to "КЗ")
        put("DEMAND OC","Датчик управляющего давления" to "Обрыв")
        put("SUSP SC","Датчик давления подвески" to "КЗ")
        put("SUSP OC","Датчик давления подвески" to "Обрыв")
        put("SUSP OUT OF RANGE","Давление подвески" to "Вне допустимого диапазона")
        put("REV SWITCH SC","Реле давления REV" to "КЗ")
        put("REV SWITCH OC","Реле давления REV" to "Обрыв")
        put("REV SWITCH PNEUMATIC","Реле давления REV" to "Пневматический сбой")
        put("REV SWITCH SIGNAL","Реле давления REV" to "Не сработало")
        put("PWR ISO 7638 FAIL","Питание ISO 7638" to "Пропало на контакте 1 или 2")
        put("PWR LO VOLT","Питание ЭБУ" to "Ниже 8 В при возбуждении тормозного соленоида")
        put("PWR HI VOLT","Питание ЭБУ" to "Выше 32 В")
        put("PWR UNSPEC","ЭБУ" to "Внутренний сбой")
        put("BRAKE PADS","Контроль износа накладок" to "Разрыв цепи")
        put("BRK APPLY SC","Соленоид подачи тормозного давления" to "КЗ")
        put("BRK APPLY OC","Соленоид подачи тормозного давления" to "Обрыв")
        put("BRK APPLY SC DRIVE","Соленоид подачи тормозного давления" to "КЗ с постоянным возбуждением")
        // BRK APPLY UNSPEC: omit, different meaning in Info Centre 2 table.
        for(i in 1..5) put("AUX$i","Дополнительная цепь $i" to "Обрыв либо КЗ системы или проводки; назначение зависит от конфигурации")
        put("SLAVE VALVE SENSOR","Датчик давления ведомого клапана" to "Обрыв либо КЗ")
        put("SLAVE VALVE MODULATOR","Соленоиды ведомого клапана" to "Обрыв либо КЗ")
        put("SLAVE VALVE CABLE","Жгут ведомого клапана" to "Обрыв либо КЗ")
        put("SLAVE VALVE SLOW REC","Ведомый клапан" to "Замедленное восстановление скорости одного колеса")
        put("SLAVE SUSP LOW","Давление подвески ведомого блока" to "Вне рабочего диапазона")
        put("PNEUMATIC DEMAND LOSS","Пневматическое управление" to "Нет соответствующего управляющего давления")
        put("TOWED CAN DEMAND LOSS","CAN тягач–прицеп" to "Нарушение линии связи")
        put("TOWED CAN CONTROL LOSS","CAN тягач–прицеп" to "Нарушение обмена данными")
        for(code in listOf("ECU EE ERR","ECU PARAM ERR","ECU EE UNSPEC"))
            put(code,"ЭБУ" to "Внутренний сбой либо отсутствует программирование")
    }
    // Gen2 operator's guide pp9–10, HTML transcription. Only explicit, independently
    // observed labels are included. Avoid copying Gen3 thresholds into Gen2.
    private val edition2 by lazy {
        val verified=buildList<String> {
            for(s in listOf("1A","1B","2A","2B"))
                for(t in listOf("CONT","SIGNAL","OUTPUT")) add("S$s $t")
            for(m in listOf(21,22)) {
                for(k in listOf("HOLD","DUMP")) for(t in listOf("SC","OC","SC DRIVE","UNSPEC"))
                    add("EPRV $m $k $t")
                for(t in listOf("SLOW REC","DEL SC","DEL OC")) add("EPRV $m $t")
            }
            addAll(listOf("DEMAND SC","DEMAND OC","RESR SC","RESR OC","SUSP SC","SUSP OC","SUSP OUT OF RANGE",
                "REV SWITCH SC","REV SWITCH OC","REV SWITCH PNEUMATIC","REV SWITCH SIGNAL",
                "PNEUMATIC DEMAND LOSS","TOWED CAN DEMAND LOSS","TOWED CAN CONTROL LOSS",
                "PWR HI VOLT","PWR UNSPEC","ECU EE ERR","ECU PARAM ERR","ECU EE UNSPEC","BRAKE PADS",
                "LAT ACC OC","LAT ACC SC","LAT ACC SIGNAL","BRK APPLY SC","BRK APPLY SC DRIVE",
                "SLAVE VALVE SENSOR","SLAVE VALVE MODULATOR","SLAVE VALVE CABLE","SLAVE VALVE SLOW REC","SLAVE SUSP LOW"))
            for(i in 1..5) add("AUX$i")
        }
        // Explicit allowlist from the Gen2 manual, not a blanket inheritance rule.
        val values=verified.associateWith { requireNotNull(LegacyDisplayReference.haldexInfo1(it)) }.toMutableMap()
        values["PWR ISO7638 FAIL"]="Питание ISO 7638" to "Пропало на контакте 1 или 2"
        values["PWR LO VOLT"]="Питание ЭБУ" to "Ниже 19 В при возбуждении тормозного соленоида (данная редакция Gen2)"
        // Original PDF p9 itself prints short circuit for OC/UNSPEC; leave ambiguous entries excluded.
        // Keep the Gen2 wording independent of Gen3 for the wheel recovery messages.
        for(m in listOf(21,22))
            values["EPRV $m SLOW REC"]="Колесо модулятора $m" to "Замедленное восстановление скорости колеса"
        values["SLAVE VALVE SLOW REC"]="Колесо ведомого клапана" to "Замедленное восстановление скорости колеса"
        for(s in listOf("1A","1B","2A","2B")) {
            values["S$s CONT"]="Колёсный датчик $s" to "Обрыв или КЗ датчика либо проводки"
            values["S$s SIGNAL"]="Колёсный датчик $s" to "Нарушение сигнала"
            values["S$s OUTPUT"]="Колёсный датчик $s" to "Недостаточный выходной сигнал; проверить систему датчика"
        }
        values.toMap()
    }
    fun gen3(code:String)=extra3[code]
    fun gen2(code:String)=edition2[code]
    val gen3Count get()=extra3.size
    val gen2Count get()=edition2.size
}
