package ru.traksos.minidiagnostic

import java.net.URLEncoder
import java.net.URLDecoder
import kotlin.random.Random

data class DemoReportFault(val code:String,val component:String,val description:String,val active:Boolean,val reference:Boolean)
data class DemoReport(val id:String,val dateMs:Long,val targetId:String,val maker:String,val model:String,
    val examplePart:String?,val serial:String,val automatic:Boolean,val canErrors:Int?,
    val supplyMv:Int?,val minimumMv:Int?,val faults:List<DemoReportFault>)

// All identity and status observations are simulated. Reference codes are display examples only.
object DemoReports {
    private data class Example(val edition:DisplayReferenceEdition,val code:String)
    private val examples=mapOf(
        "zf-tebs-e" to listOf(Example(DisplayReferenceEdition.WABCO_E_OEM_EXACT,"002/05"),
            Example(DisplayReferenceEdition.WABCO_E_HUMBAUR,"251/05")),
        // G2 examples do not establish exact G2.2 software compatibility.
        "kb-tebs4" to listOf(Example(DisplayReferenceEdition.KNORR_TEBS4,"25"),Example(DisplayReferenceEdition.KNORR_TEBS4,"35"),
            Example(DisplayReferenceEdition.KNORR_TEBS4,"24")),
        "haldex-eb1" to listOf(Example(DisplayReferenceEdition.HALDEX_GEN1_2005,"S1A CONT"),
            Example(DisplayReferenceEdition.HALDEX_GEN1_2005,"S2B SIGNAL"),Example(DisplayReferenceEdition.HALDEX_GEN1_2005,"EPRV 21 HOLD OC")),
        "haldex-uabs" to listOf(Example(DisplayReferenceEdition.HALDEX_UABS_INFO2,"Wheel sensor 1A or 1B continuity"),
            Example(DisplayReferenceEdition.HALDEX_UABS_INFO2,"EPRV 21 or 22 hold solenoid open circuit"),
            Example(DisplayReferenceEdition.HALDEX_UABS_INFO2,"Wheel sensor 2A or 2B signal integrity")),
        "sorl-trailer-abs" to listOf(Example(DisplayReferenceEdition.SORL_ABS_TESTER_36302900020,"3.1 Нет Д №1"),
            Example(DisplayReferenceEdition.SORL_ABS_TESTER_36302900020,"4.2 Зазор Д №2"),
            Example(DisplayReferenceEdition.SORL_ABS_TESTER_36302900020,"2.1 КЗ КМ")),
        "haldex-eb4" to listOf(Example(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE,"0x01"),
            Example(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE,"0x0C"),
            Example(DisplayReferenceEdition.HALDEX_EB4_DIAG_EXAMPLE,"EPRV 21 master hold electric failure")),
        "haldex-eb3" to listOf(Example(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"S1A CONT"),
            Example(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"EPRV 21 HOLD OC"),
            Example(DisplayReferenceEdition.HALDEX_GEN3_INFO1,"RESR SC")),
        "vie-tebs" to listOf(Example(DisplayReferenceEdition.VIE_101,"5/5"),Example(DisplayReferenceEdition.VIE_101,"62/5"),
            Example(DisplayReferenceEdition.VIE_101,"254/12"),Example(DisplayReferenceEdition.VIE_101,"6/1"))
    )
    private val autoTargets=listOf("zf-tebs-e","zf-iebs","kb-g22","kb-itebs-x","haldex-eb3","haldex-eb4","vie-tebs","sorl-trailer-abs")
    private val sampleParts=mapOf("zf-tebs-e" to "4801020300","kb-g22" to "K055369","vie-tebs" to "4801020630")
    private val synthetic=listOf(
        DemoReportFault("DEMO-ABS-01","Колёсный датчик ABS","Обрыв цепи: проверить датчик, жгут и разъём.",true,false),
        DemoReportFault("DEMO-ABS-02","Колёсный датчик ABS","Слабый сигнал: проверить зазор и импульсное кольцо.",false,false),
        DemoReportFault("DEMO-EBS-01","Модулятор","Пример внутренней электрической неисправности. Требуется проверка специалистом.",true,false),
        DemoReportFault("DEMO-P-01","Датчик давления","Недостоверный сигнал. Уточнить расположение датчика и проверить давление.",false,false)
    )
    fun make(id:String,dateMs:Long,targetId:String?,electrical:ElectricalPreview,random:Random=Random.Default):DemoReport {
        require(electrical.canRunDemo)
        val target=CoverageRoadmap.byId(targetId ?: autoTargets.random(random))
            ?: error("Unknown demo model")
        val candidates=examples[target.id].orEmpty().filter { it.edition in ReferenceSelection.forTarget(target.id) }.mapNotNull { e ->
            val d=DisplayReferenceLookup.find(e.edition,e.code)
            if(d?.exactPair!=true || d.component==null || d.condition==null) null
            else DemoReportFault(e.code,d.component,d.condition,false,true)
        }.ifEmpty { synthetic }
        val faults=candidates.shuffled(random).take(random.nextInt(minOf(2,candidates.size),minOf(3,candidates.size)+1))
            .mapIndexed { i,f -> f.copy(active=i==0 || random.nextBoolean()) }
        return DemoReport(id,dateMs,target.id,target.maker,target.model,sampleParts[target.id],
            "DEMO-"+target.id.uppercase(java.util.Locale.ROOT),targetId==null,electrical.canErrors,electrical.supplyMv,electrical.minimumMv,faults)
    }
}

// Bounded, versioned line records, URL-escaped fields. Snapshot descriptions persist as read;
// do not reconstruct old records from the current dictionary or current selected model.
object DemoReportCodec {
    private fun enc(s:String)=URLEncoder.encode(s,"UTF-8")
    private fun dec(s:String)=URLDecoder.decode(s,"UTF-8")
    private fun fields(xs:List<String>)=xs.joinToString("\t"){enc(it)}
    fun encode(reports:List<DemoReport>):String = reports.take(50).joinToString("\n"){r ->
        fields(listOf("1",r.id,r.dateMs.toString(),r.targetId,r.maker,r.model,r.examplePart.orEmpty(),r.serial,
            if(r.automatic)"1" else "0",r.canErrors?.toString().orEmpty(),r.supplyMv?.toString().orEmpty(),
            r.minimumMv?.toString().orEmpty(),r.faults.size.toString())+
            r.faults.flatMap { listOf(it.code,it.component,it.description,if(it.active)"1" else "0",if(it.reference)"1" else "0") })
    }
    fun decode(raw:String):List<DemoReport> = raw.lineSequence().take(100).mapNotNull { line ->
        if(line.length>64_000) null else runCatching {
            val f=line.split('\t').map(::dec)
            require(f.size>=13 && f[0]=="1")
            val n=f[12].toInt(); require(n in 1..20 && f.size==13+n*5)
            fun flag(s:String):Boolean { require(s=="0" || s=="1"); return s=="1" }
            fun num(s:String):Int? = if(s.isEmpty()) null else s.toInt().also { require(it>=0) }
            val faults=(0 until n).map { i -> val j=13+i*5
                DemoReportFault(f[j],f[j+1],f[j+2],flag(f[j+3]),flag(f[j+4])) }
            DemoReport(f[1],f[2].toLong(),f[3],f[4],f[5],f[6].ifEmpty{null},f[7],flag(f[8]),
                num(f[9]),num(f[10]),num(f[11]),faults)
        }.getOrNull()
    }.distinctBy { it.id }.take(50).toList()
}
