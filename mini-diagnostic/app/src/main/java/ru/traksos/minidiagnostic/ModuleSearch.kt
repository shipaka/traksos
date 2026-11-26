package ru.traksos.minidiagnostic

import java.util.Locale

// Search aliases are convenience labels, never electronic ECU signatures or protocol permissions.
object ModuleSearch {
    private fun normalize(value:String):String = value.lowercase(Locale.ROOT)
        .replace('ё','е').filter { it.isLetterOrDigit() || it=='+' }
    private val makerAliases=mapOf(
        "zf-" to listOf("вабко","вабка","вапко","вапка","wabco","zf"),
        "kb-" to listOf("кнорр","кнор","кнорр бремзе","knorr","knorr bremse"),
        "haldex-" to listOf("халдекс","хальдекс","халдэкс"),
        "vie-" to listOf("виэ","вие","тср","tcp","vie"),
        "sorl-" to listOf("сорл","сор","сёрл","sorl"),
        "kormee-" to listOf("корми","кормее","руйли","ruili"),
        "ekran-" to listOf("экран","ekran","беларусь")
    )
    private val modelAliases=mapOf(
        "zf-tebs-c" to listOf("тебс с","тэпс с","tepsc","tebsс"),
        "zf-tebs-d" to listOf("тебс д","тэпс д","tepsd"),
        "zf-tebs-e" to listOf("тебс е","тэпс е","тэпсе","тэпсэ","tebs e","tepse","tepsye","tebsye"),
        "zf-vcs" to listOf("вцс","вкс","vcs1","vcs i"),
        "zf-vcs-ii" to listOf("вцс2","вкс2","vcs2","vcs ii"),
        "zf-iebs" to listOf("иебс","айебс"),
        "kb-g20" to listOf("g2","g2.0","г2","г2.0"),
        "kb-g21" to listOf("g2","g2.1","г2","г2.1"),
        "kb-g22" to listOf("g2","g2.2","г2","г2.2"),
        "haldex-eb1" to listOf("eb+1","ebs gen1","еб плюс 1"),
        "haldex-eb2" to listOf("eb+2","ebs gen2","еб плюс 2"),
        "haldex-eb3" to listOf("eb+3","ebs gen3","еб плюс 3"),
        "haldex-eb4" to listOf("eb+4","ebs gen4","еб плюс 4"),
        "haldex-uabs" to listOf("u abs","уабс"),
        "ekran-ebp" to listOf("эбп","ebp","абс п"),
        "ekran-ebpv" to listOf("эбп в","ebpv","адюи453633024")
    )
    private fun terms(row:ResearchTarget):Set<String> {
        val maker=listOf(row.maker)+makerAliases.entries.filter { row.id.startsWith(it.key) }.flatMap { it.value }
        val models=mutableListOf(row.model,row.id)
        models.addAll(modelAliases[row.id].orEmpty())
        val standard=normalize(row.model)
        if("tebs" in standard) models.addAll(listOf("tebs","тебс","тэпс","teps"))
        if("abs" in standard || row.id.startsWith("zf-vcs") || row.id=="zf-vario-c" || row.id.startsWith("ekran-")) models.addAll(listOf("abs","абс"))
        if("ebs" in standard || row.id.startsWith("haldex-eb")) models.addAll(listOf("ebs","ебс","эбс"))
        return (maker+models+maker.flatMap { m->models.map { s->"$m $s" } }).map(::normalize).filter { it.isNotEmpty() }.toSet()
    }
    private val index by lazy { CoverageRoadmap.targets.associateWith(::terms) }
    fun find(query:String):List<ResearchTarget> {
        if(query.length>120) return emptyList()
        if(query.isBlank()) return CoverageRoadmap.targets
        val q=normalize(query)
        if(q.isEmpty()) return emptyList()
        return index.mapNotNull { (row,t)->
            val rank=when {
                q in t -> 0
                t.any { it.startsWith(q) } -> 1
                t.any { q in it } -> 2
                else -> return@mapNotNull null
            }
            row to rank
        }.sortedBy { it.second }.map { it.first }
    }
}
