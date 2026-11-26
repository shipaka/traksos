package ru.traksos.minidiagnostic

// Independent manual reference namespaces, never a raw wire decoder.
object LegacyDisplayReference {
    const val VCS_SOURCE="https://www.wabco-customercentre.com/catalog/docs/8150100083.pdf"
    const val HALDEX_SOURCE="https://www.manualslib.com/manual/1181878/Haldex-EbPlus-Gen3.html?page=105"
    // WABCO 8150100083, annex 2, printed page 28. Code identifies component, not failure mode.
    private val vcs=mapOf(
        "3" to "Датчик колеса C",
        "4" to "Датчик колеса D",
        "5" to "Датчик колеса E",
        "6" to "Датчик колеса F",
        "7" to "Внешний модулятор RD (L)",
        "9" to "Впускной клапан 2 внутреннего модулятора",
        "10" to "Впускной клапан 1 внутреннего модулятора",
        "11" to "Выпускной клапан внутреннего модулятора",
        "14" to "Электропитание",
        "15" to "Внутренняя неисправность ЭБУ",
        "18" to "Цепи GenericIO"
    )
    fun vcsFlash(code:String):String?=vcs[code]
    val vcsCount:Int get()=vcs.size
    // Haldex Gen3 installation guide, 2013, p105, Info Centre 1 text codes only.
    private val haldex=buildMap<String,Pair<String,String>> {
        for (sensor in listOf("1A","1B","2A","2B")) {
            put("S"+sensor+" CONT","Датчик колеса "+sensor to "Нарушение электрической цепи")
            put("S"+sensor+" SIGNAL","Датчик колеса "+sensor to "Нестабильный или слабый сигнал")
            put("S"+sensor+" OUTPUT","Датчик колеса "+sensor to "Недостаточный уровень сигнала")
        }
        put("RESR SC","Датчик давления в ресивере" to "Короткое замыкание")
        put("RESR OC","Датчик давления в ресивере" to "Обрыв цепи")
        put("LAT ACC OC","Датчик бокового ускорения" to "Обрыв цепи")
        put("LAT ACC SC","Датчик бокового ускорения" to "Короткое замыкание")
        put("LAT ACC SIGNAL","Датчик бокового ускорения" to "Нарушение сигнала")
    }
    fun haldexInfo1(code:String):Pair<String,String>?=haldex[code]
    val haldexCount:Int get()=haldex.size
}
