package ru.traksos.minidiagnostic

// Independent manual reference namespaces, never a raw wire decoder.
object LegacyDisplayReference {
    const val VCS_SOURCE="https://www.wabco-customercentre.com/catalog/docs/8150100083.pdf"
    const val HALDEX_SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300018_ru.pdf"
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
    fun haldexInfo1(code:String):Pair<String,String>?=haldex[code] ?: HaldexExpandedReference.gen3(code)
    val haldexCount:Int get()=haldex.size+HaldexExpandedReference.gen3Count
}
