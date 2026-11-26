package ru.traksos.minidiagnostic

// Educational descriptions, not cable pinouts or executable transport profiles.
// Choosing a route in this guide never enables a bus or electrical power.
enum class ConnectionPlace(val title:String) {
    FRONT("Передняя розетка ABS/EBS"),
    SIDE("Боковой диагностический разъём"),
    DIRECT("Напрямую к модулятору"),
    UNKNOWN("Разъём или блок неизвестен")
}
enum class ElectricalPath(val title:String) {
    ISO11992("CAN ISO 11992"),
    K_LINE("K-line"),
    ISO11898("CAN ISO 11898")
}
data class GuideEntry(val place:ConnectionPlace,val explanation:String,
    val possiblePaths:Set<ElectricalPath>,val examples:String,val warning:String,
    val sources:List<String>)
object DiagnosticGuide {
    const val blocked = "Реальное подключение пока не разрешено: нет проверенного кабеля, схемы и профиля для конкретного ЭБУ."
    val checks = listOf(
        "Прицеп неподвижен и надёжно зафиксирован.",
        "Записаны производитель, номер детали ЭБУ и версия блока.",
        "Сверены схема производителя, вид контактов и точный номер кабеля.",
        "Проверены напряжение питания, тип интерфейса, масса и отсутствие обратной подачи.",
        "Питание и диагностические линии отключены перед перестановкой кабеля."
    )
    private const val WABCO = "https://www.wabco-customercentre.com/catalog/ru_RU/4463010230"
    private const val HALDEX = "https://www.haldex.com/en/europe/trailer-application-guide/cables/u-abs-cable---sov-socket-to-diagn/"
    private const val HALDEX_TOOLS = "https://www.haldex.com/sv/europe/trailer-application-guide/ebs/diagnostic/diag-tools/"
    private val entries = listOf(
        GuideEntry(ConnectionPlace.FRONT,
            "Розетка ISO 7638 находится спереди прицепа. Через неё некоторые EBS и ABS поддерживают обмен CAN ISO 11992. Наличие розетки само по себе не доказывает доступность диагностики.",
            setOf(ElectricalPath.ISO11992),
            "Пример: Haldex EB+ определённых версий; WABCO VCS II Premium / Separate ECU определённых версий.",
            "Не использовать контакт предупреждения ABS как K-line. Не подключать обычный CAN-трансивер к ISO 11992 без подтверждённого согласования.",
            listOf(WABCO,HALDEX_TOOLS)),
        GuideEntry(ConnectionPlace.SIDE,
            "Выносная диагностическая розетка сбоку или под рамой прицепа соединена с электронным блоком отдельным жгутом. У разных производителей интерфейс различается.",
            setOf(ElectricalPath.K_LINE,ElectricalPath.ISO11898),
            "Примеры: диагностические кабели WABCO K-line и Haldex SOV / DIAG.",
            "Одинаковая форма штекера не означает одинаковую распиновку. Не подавать 24 В на сигнальные выводы.",
            listOf(WABCO,HALDEX)),
        GuideEntry(ConnectionPlace.DIRECT,
            "Подключение через предусмотренный производителем диагностический порт самого ABS/EBS или специальный сервисный жгут. Это не подключение к произвольным контактам блока.",
            setOf(ElectricalPath.K_LINE,ElectricalPath.ISO11898,ElectricalPath.ISO11992),
            "Исследуем WABCO ABS/EBS, Knorr-Bremse, Haldex, VIE / ТСР SUBSYSTEM и SORL. Для каждой ревизии нужен свой подтверждённый кабель.",
            "Не отсоединять рабочие датчики и клапаны ради диагностики. Не соединять неизвестные контакты и не использовать универсальный pinout.",
            listOf(WABCO,HALDEX,"https://vbsauto.ru/literatura/","https://sorl.ru/manuals/rukovodstvo-dlya-diagnosticheskogo-oborudovaniya-sorl.pdf")),
        GuideEntry(ConnectionPlace.UNKNOWN,
            "Если маркировка не читается, интерфейс или распиновка неизвестны, остановите подключение. Установите точную модель и найдите документацию.",
            emptySet(),
            "Сфотографировать шильдик и штатный разъём без отключения проводки под напряжением.",
            "Не включать питание, не перебирать контакты и протоколы наугад.",
            emptyList())
    ).associateBy { it.place }
    fun entry(place:ConnectionPlace):GuideEntry = entries.getValue(place)
}
