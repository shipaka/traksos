package ru.traksos.minidiagnostic

// These are separate auxiliary contexts, never implicit brake ECU mapping.
object HaldexAuxReference {
    const val HUB_SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/pb0268m_en.pdf"
    private const val SOFT_SOURCE="https://www.haldex.com/globalassets/europe/61.-documents/ebs-system/006300019_en.pdf#page=124"
    private val soft=mapOf(
        "Incorrect Number of Sensors" to "В одном из каналов отсутствуют работоспособные подключённые датчики; проверить количество и подключение.",
        "Sensor Error" to "Обнаружен неисправный датчик; точный датчик необходимо определить проверкой.",
        "EE Data Mismatch" to "Данные о датчиках, сохранённые в Gen3 и Soft Docking, расходятся."
    )
    fun softDocking(code:String):DisplayLookup? {
        val c=soft[code] ?: return null
        return DisplayLookup("Soft Docking · EB+ Gen3",c,SOFT_SOURCE,true)
    }
    private val hubLabels=setOf("ECU SHUTDOWN","Shutdown FET")
    fun canHub(code:String):DisplayLookup? = if(code in hubLabels)
        DisplayLookup("EB+ CAN Hub","Известен дефект передачи ISO CAN у деталей периода 25.09.2024–09.04.2025. Сверить маркировку и применимость бюллетеня у Haldex; сообщение само по себе не доказывает причину.",HUB_SOURCE+" · PB0268M, 17.11.2025",false) else null
    val count get()=soft.size+1
}
