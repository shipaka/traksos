package ru.traksos.minidiagnostic

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Original perspective illustration. Geometry and lens emissions are independent.
// No black image masks or entire-image animation.
@Composable
fun TrailerScene(outputs:Set<Channel>) {
    @Composable fun level(ch:Channel):Float=animateFloatAsState(if(ch in outputs) 1f else 0f,
        tween(125),label=ch.name).value
    val left=level(Channel.LEFT); val right=level(Channel.RIGHT)
    val ls=level(Channel.LEFT_SIDE); val rs=level(Channel.RIGHT_SIDE)
    val stop=level(Channel.STOP); val fog=level(Channel.FOG); val reverse=level(Channel.REVERSE)
    val plate=maxOf(ls,rs)
    var rightView by remember { mutableStateOf(false) }
    val orange=Color(0xFFFF8B23); val muted=Color(0xFFB2BCC7)
    Column(Modifier.fillMaxWidth().background(Color(0xFF151D26),RoundedCornerShape(18.dp))
        .border(1.dp,Color(0xFF344352),RoundedCornerShape(18.dp)).padding(10.dp),
        verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            Text("СВЕТОТЕХНИКА",color=muted,fontSize=11.sp,fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f))
            Text(if(outputs.isEmpty()) "Выключено" else "Активно",color=if(outputs.isEmpty()) muted else orange,fontSize=12.sp)
        }
        Canvas(Modifier.fillMaxWidth().aspectRatio(1.38f)) {
            val w=size.width; val h=size.height
            fun c(hex:Long)=Color(hex)
            fun px(x:Float)=w*(if(rightView) 1f-x else x)
            fun pt(x:Float,y:Float)=Offset(px(x),h*y)
            fun path(vararg v:Float):Path=Path().apply {
                moveTo(px(v[0]),h*v[1])
                for(i in 2 until v.size step 2) lineTo(px(v[i]),h*v[i+1])
                close()
            }
            fun poly(color:Color,vararg v:Float)=drawPath(path(*v),color)
            fun gradient(top:Color,bottom:Color,vararg v:Float)=drawPath(path(*v),
                Brush.verticalGradient(listOf(top,bottom),startY=0f,endY=h*.85f))
            fun line(x1:Float,y1:Float,x2:Float,y2:Float,color:Color,width:Float=.003f) =
                drawLine(color,pt(x1,y1),pt(x2,y2),w*width,StrokeCap.Round)
            fun rect(x:Float,y:Float,rw:Float,rh:Float,color:Color,r:Float=.004f) {
                drawRoundRect(color,Offset(minOf(px(x),px(x+rw)),h*y),Size(w*rw,h*rh),CornerRadius(w*r))
            }
            fun lens(x:Float,y:Float,rw:Float,rh:Float,color:Color,amount:Float) {
                rect(x-.004f,y-.004f,rw+.008f,rh+.008f,c(0xFF111820))
                val base=lerp(c(0xFF18232C),color,.27f)
                rect(x,y,rw,rh,lerp(base,color,amount))
                line(x+.003f,y+.003f,x+rw-.003f,y+.003f,Color.White.copy(alpha=.28f),.0018f)
                if(amount>.001f) {
                    val center=pt(x+rw/2,y+rh/2); val radius=w*maxOf(rw*.9f,.024f)
                    drawCircle(Brush.radialGradient(listOf(color.copy(alpha=amount*.22f),Color.Transparent),center,radius),radius,center)
                    rect(x+.003f,y+.003f,rw-.006f,rh-.006f,Color.White.copy(alpha=amount*.19f),.003f)
                }
            }
            fun wheel(x:Float,y:Float,r:Float) {
                val p=pt(x,y); val ww=w*r; val hh=h*r*1.33f
                drawOval(c(0xFF090C10),p-Offset(ww,hh),Size(2*ww,2*hh))
                drawOval(Brush.radialGradient(listOf(c(0xFF84929F),c(0xFF2F3943),c(0xFF12191F)),p,ww),
                    p-Offset(ww*.8f,hh*.84f),Size(ww*1.6f,hh*1.68f))
                drawOval(c(0xFFABB4BC),p-Offset(ww*.42f,hh*.46f),Size(ww*.84f,hh*.92f))
                drawOval(c(0xFF35404B),p-Offset(ww*.22f,hh*.24f),Size(ww*.44f,hh*.48f))
                for(i in 0..5) {
                    val angle=i*Math.PI/3
                    drawCircle(c(0xFF1E2730),w*.004f,p+Offset((kotlin.math.cos(angle)*ww*.31).toFloat(),(kotlin.math.sin(angle)*hh*.34).toFloat()))
                }
            }
            // Studio asphalt, contact shadow, realistic three-axle chassis in perspective.
            drawRect(Brush.verticalGradient(listOf(c(0xFF192732),c(0xFF10171D),c(0xFF29333B))))
            drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha=.7f),Color.Transparent),Offset(w*.51f,h*.83f),w*.48f),
                Offset(w*.04f,h*.69f),Size(w*.94f,h*.28f))
            for(i in 0..2) wheel(.24f+i*.073f,.735f+i*.034f,.047f+i*.003f)
            poly(c(0xFF242D35),.10f,.63f,.46f,.77f,.91f,.76f,.85f,.84f,.45f,.85f,.10f,.68f)
            gradient(c(0xFFCAD0D3),c(0xFF6E7C87),.08f,.22f,.44f,.065f,.93f,.10f,.57f,.24f)
            // Long side with satin metallic ribs and lower underrun protection.
            gradient(c(0xFFB6C3CE),c(0xFF465764),.08f,.22f,.44f,.065f,.44f,.70f,.08f,.57f)
            for(i in 1..9) {
                val f=i/10f; val x=.08f+.36f*f
                line(x,.22f-.155f*f,x,.57f+.13f*f,c(0xFF50616D).copy(alpha=.45f),.0016f)
                line(x+.004f,.22f-.155f*f,x+.004f,.57f+.13f*f,Color.White.copy(alpha=.23f),.0012f)
            }
            poly(c(0xFFB1BAC0),.08f,.55f,.44f,.68f,.44f,.711f,.08f,.584f)
            line(.12f,.65f,.39f,.75f,c(0xFF87949D),.019f)
            line(.12f,.67f,.39f,.77f,c(0xFF36434D),.012f)
            line(.08f,.22f,.44f,.065f,c(0xFFF4F5F6),.003f)
            // Rear portal: separate door panels, beveled perimeter, lock bars, hinges.
            gradient(c(0xFFF0F2F3),c(0xFF7B8D9A),.44f,.065f,.93f,.10f,.93f,.704f,.44f,.70f)
            gradient(c(0xFFD7E0E5),c(0xFF84949F),.455f,.092f,.677f,.109f,.677f,.669f,.455f,.669f)
            gradient(c(0xFFD4DCE2),c(0xFF7B8B96),.692f,.11f,.914f,.125f,.914f,.669f,.692f,.669f)
            line(.684f,.107f,.684f,.67f,c(0xFF26343F),.006f)
            line(.451f,.085f,.451f,.68f,c(0xFF556774),.006f)
            line(.922f,.113f,.922f,.681f,c(0xFFF3F5F6),.004f)
            for(x in listOf(.479f,.645f,.716f,.884f)) {
                line(x,.14f,x,.642f,c(0xFF45545F),.012f)
                line(x-.003f,.14f,x-.003f,.642f,c(0xFFDCE4E9),.006f)
                for(y in listOf(.175f,.40f,.625f)) {
                    rect(x-.014f,y,.029f,.021f,c(0xFF51616C))
                    line(x-.01f,y+.004f,x+.01f,y+.004f,c(0xFFC0CED6),.002f)
                }
                rect(x-.012f,.525f,.047f,.018f,c(0xFFCED8DE))
            }
            for(y in listOf(.25f,.49f,.61f)) {
                line(.465f,y,.492f,y,c(0xFF354651),.007f)
                line(.9f,y,.919f,y,c(0xFF354651),.007f)
            }
            // Clearance and flank markers. Both flanks available by changing view.
            val rearLeft=if(rightView) rs else ls; val rearRight=if(rightView) ls else rs
            val amber=c(0xFFFFA326); val red=c(0xFFFF3848); val white=c(0xFFFFF0CE)
            lens(.454f,.082f,.031f,.016f,red,rearLeft)
            lens(.889f,.111f,.031f,.016f,red,rearRight)
            for(i in 0..4) {
                val f=i/4f
                lens(.10f+f*.308f,.563f+f*.108f,.023f,.017f,amber,rearLeft)
            }
            // Reflective contour tape is not switched.
            for(x in listOf(.475f,.54f,.605f,.72f,.785f,.85f)) rect(x,.649f,.047f,.012f,c(0xFFBA5548))
            // Stainless bumper, separate left/right lamp assemblies, fog and reverse.
            gradient(c(0xFF586675),c(0xFF1D2933),.425f,.705f,.942f,.705f,.942f,.85f,.425f,.85f)
            line(.429f,.715f,.937f,.715f,c(0xFFBFC9D0),.006f)
            val lturn=if(rightView) right else left; val rturn=if(rightView) left else right
            for(x in listOf(.442f,.797f)) {
                rect(x,.727f,.13f,.103f,c(0xFF11171D),.009f)
                rect(x+.003f,.731f,.124f,.095f,c(0xFF26333D),.006f)
            }
            lens(.45f,.738f,.114f,.022f,amber,lturn)
            lens(.805f,.738f,.114f,.022f,amber,rturn)
            lens(.45f,.767f,.114f,.018f,red,rearLeft)
            lens(.805f,.767f,.114f,.018f,red,rearRight)
            lens(.45f,.793f,.114f,.024f,red,stop)
            lens(.805f,.793f,.114f,.024f,red,stop)
            lens(.581f,.795f,.034f,.025f,if(rightView) white else red,if(rightView) reverse else fog)
            lens(.751f,.795f,.034f,.025f,if(rightView) red else white,if(rightView) fog else reverse)
            // Plate illumination is a downwards light wash, retaining black characters.
            val plateX=.622f; val plateY=.777f
            rect(plateX-.005f,plateY-.005f,.12f,.05f,c(0xFF141B23))
            rect(plateX,plateY,.11f,.04f,lerp(c(0xFF89929A),c(0xFFF8EED6),plate))
            if(plate>.001f) {
                val center=pt(plateX+.055f,plateY-.002f)
                drawCircle(Brush.radialGradient(listOf(white.copy(alpha=.22f*plate),Color.Transparent),center,w*.075f),w*.075f,center)
            }
            lens(plateX+.035f,plateY-.013f,.04f,.009f,white,plate)
            val textPaint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                color=android.graphics.Color.rgb(31,37,41); textAlign=android.graphics.Paint.Align.CENTER
                typeface=android.graphics.Typeface.create("sans-serif-condensed",android.graphics.Typeface.BOLD)
                textSize=w*.024f
            }
            drawContext.canvas.nativeCanvas.drawText("DEMO",px(plateX+.055f),h*(plateY+.029f),textPaint)
            line(.43f,.849f,.94f,.849f,c(0xFFB2BEC7),.003f)
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(selected=!rightView,onClick={ rightView=false },label={ Text("Левый ракурс") },modifier=Modifier.weight(1f))
            FilterChip(selected=rightView,onClick={ rightView=true },label={ Text("Правый ракурс") },modifier=Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
            Text("Левый борт",color=if(ls>0f) orange else muted,fontSize=11.sp)
            Text("Номер",color=if(plate>0f) orange else muted,fontSize=11.sp)
            Text("Правый борт",color=if(rs>0f) orange else muted,fontSize=11.sp)
        }
    }
}
