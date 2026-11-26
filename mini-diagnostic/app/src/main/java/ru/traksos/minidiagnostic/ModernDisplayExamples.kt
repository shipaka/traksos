package ru.traksos.minidiagnostic

// Observed diagnostic display examples only; not raw ECU messages.
object ModernDisplayExamples {
    const val HALDEX_SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/sb010m_en.pdf#page=31"
    const val HUMBAUR_SOURCE="https://www.humbaur.com/Downloads_Anleitungen/EN_Downloads/Operating%20manuals/Operating_instructions_SmartBoard.pdf#page=14"
    fun haldex4(code:String):DisplayLookup? = HaldexEb4DiagReference.lookup(code)
    fun wabcoE(code:String):DisplayLookup? = if(code=="251/05")
        DisplayLookup("Электропитание","Нарушение цепи питания (обрыв)",HUMBAUR_SOURCE+" · наблюдаемая пара; компонент: "+SmartBoardReference.SOURCE_TYPES,true) else null
    val count get()=HaldexEb4DiagReference.count+1
}
